/**
 * Verify end-to-end sourcing data health:
 * 1) qogita_products source split (excel vs API-like rows)
 * 2) product_matches confidence split (high vs medium)
 * 3) top sourcing rows can compute expected margin/profit fields
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { and, desc, eq, isNotNull, like, notLike, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { keepaCatalogItems, productMatches, qogitaProducts } from "@/db/schema";
import { KEEPA_DOMAIN_UK } from "@/lib/keepa/product";
import {
  DEFAULT_EUR_TO_GBP,
  buyUnitCostGbp,
  estimateAmazonNetMarginPctFromBuyGbp,
  estimateNetProfitGbpPerUnitFromBuyGbp,
  parseGbpToNumber,
} from "@/lib/margin/estimate";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

type CheckResult = { ok: boolean; detail: string };

const DEFAULT_MIN_COMPUTED_COVERAGE = 0.7;

function parseMinComputedCoverage(argv: string[]): number {
  const argPrefix = "--min-computed-coverage=";
  const arg = argv.find((a) => a.startsWith(argPrefix));
  const raw =
    (arg ? arg.slice(argPrefix.length) : undefined) ??
    process.env.MIN_COMPUTED_COVERAGE ??
    process.env.VERIFY_SOURCING_MIN_COMPUTED_COVERAGE;
  if (raw == null || raw.trim() === "") {
    return DEFAULT_MIN_COMPUTED_COVERAGE;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(
      `Invalid min computed coverage: "${raw}". Expected a number between 0 and 1.`
    );
  }
  return parsed;
}

async function checkQogitaSourceSplit(): Promise<CheckResult> {
  const db = getDb();
  const [totalRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(qogitaProducts);
  const [excelRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(qogitaProducts)
    .where(like(qogitaProducts.qogitaId, "excel-gtin-%"));
  const [apiRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(qogitaProducts)
    .where(notLike(qogitaProducts.qogitaId, "excel-gtin-%"));

  const total = totalRow?.c ?? 0;
  const excel = excelRow?.c ?? 0;
  const api = apiRow?.c ?? 0;
  const ok = total > 0 && excel + api === total;
  return {
    ok,
    detail: `qogita_products: total=${total}, excel=${excel}, api_like=${api}`,
  };
}

async function checkMatchConfidenceSplit(): Promise<CheckResult> {
  const db = getDb();
  const [highRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(productMatches)
    .where(
      and(
        eq(productMatches.channel, "amazon_uk"),
        isNotNull(productMatches.qogitaProductId),
        eq(productMatches.confidence, "high")
      )
    );
  const [mediumRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(productMatches)
    .where(
      and(
        eq(productMatches.channel, "amazon_uk"),
        isNotNull(productMatches.qogitaProductId),
        eq(productMatches.confidence, "medium")
      )
    );

  const high = highRow?.c ?? 0;
  const medium = mediumRow?.c ?? 0;
  const total = high + medium;
  return {
    ok: total > 0,
    detail: `product_matches amazon_uk linked: high=${high}, medium=${medium}, total=${total}`,
  };
}

async function checkTopSourcingComputedFields(
  limit = 20,
  minComputedCoverage = DEFAULT_MIN_COMPUTED_COVERAGE
): Promise<CheckResult> {
  const db = getDb();
  const raw = await db
    .select({
      productMatchId: productMatches.id,
      matchConfidence: productMatches.confidence,
      asin: keepaCatalogItems.asin,
      keepaMetrics: keepaCatalogItems.metrics,
      qogitaId: qogitaProducts.qogitaId,
      buyUnitPrice: qogitaProducts.buyUnitPrice,
      currency: qogitaProducts.currency,
    })
    .from(productMatches)
    .innerJoin(
      keepaCatalogItems,
      and(
        eq(keepaCatalogItems.asin, productMatches.externalId),
        eq(keepaCatalogItems.domainId, KEEPA_DOMAIN_UK)
      )
    )
    .innerJoin(qogitaProducts, eq(qogitaProducts.id, productMatches.qogitaProductId))
    .where(
      and(
        eq(productMatches.channel, "amazon_uk"),
        isNotNull(productMatches.qogitaProductId)
      )
    )
    .orderBy(desc(keepaCatalogItems.capturedAt))
    .limit(250);

  const enriched = raw.map((row) => {
    const m = row.keepaMetrics as Record<string, unknown>;
    const sell =
      (typeof m.avg30BuyBoxGbp === "string"
        ? parseGbpToNumber(m.avg30BuyBoxGbp)
        : null) ??
      (typeof m.amazonBuyBoxGbp === "string"
        ? parseGbpToNumber(m.amazonBuyBoxGbp)
        : null);
    const buyGbp = buyUnitCostGbp({
      currency: row.currency,
      buyUnitPrice: row.buyUnitPrice,
      eurToGbp: DEFAULT_EUR_TO_GBP,
    });
    const estimatedMarginPct =
      sell != null && buyGbp != null
        ? estimateAmazonNetMarginPctFromBuyGbp({
            amazonSellGbp: sell,
            buyCostGbp: buyGbp,
          })
        : null;
    const estimatedProfitGbp =
      sell != null && buyGbp != null
        ? estimateNetProfitGbpPerUnitFromBuyGbp({
            amazonSellGbp: sell,
            buyCostGbp: buyGbp,
          })
        : null;
    return { ...row, sell, buyGbp, estimatedMarginPct, estimatedProfitGbp };
  });

  const sorted = [...enriched].sort((a, b) => {
    const pa = a.estimatedProfitGbp ?? -1e9;
    const pb = b.estimatedProfitGbp ?? -1e9;
    return pb - pa;
  });
  const top = sorted.slice(0, limit);

  const structuralFailures: string[] = [];
  let computedCovered = 0;
  const missingComputedAsins: string[] = [];
  top.forEach((row, idx) => {
    const pos = idx + 1;
    if (!row.productMatchId) structuralFailures.push(`#${pos} missing productMatchId`);
    if (!row.asin) structuralFailures.push(`#${pos} missing asin`);
    if (!row.qogitaId) structuralFailures.push(`#${pos} missing qogitaId`);
    if (row.matchConfidence !== "high" && row.matchConfidence !== "medium") {
      structuralFailures.push(`#${pos} invalid matchConfidence=${String(row.matchConfidence)}`);
    }
    const hasFiniteComputed =
      row.estimatedMarginPct == null ||
      !Number.isFinite(row.estimatedMarginPct) ||
      row.estimatedProfitGbp == null ||
      !Number.isFinite(row.estimatedProfitGbp)
        ? false
        : true;
    if (hasFiniteComputed) {
      computedCovered += 1;
    } else {
      missingComputedAsins.push(row.asin ?? "unknown");
    }
  });

  if (top.length === 0) {
    structuralFailures.push("No sourcing rows found.");
  }

  const rowsChecked = top.length;
  const coverage = rowsChecked > 0 ? computedCovered / rowsChecked : 0;
  const coveragePct = (coverage * 100).toFixed(1);
  const thresholdPct = (minComputedCoverage * 100).toFixed(1);
  const coveragePass = rowsChecked > 0 && coverage >= minComputedCoverage;
  const structuralPass = structuralFailures.length === 0;
  const ok = structuralPass && coveragePass;

  if (top.length === 0) {
    missingComputedAsins.length = 0;
  }

  const missingComputedSample = missingComputedAsins.slice(0, 5).join(", ");
  const coverageDetail = `computed_coverage=${computedCovered}/${rowsChecked} (${coveragePct}%), threshold=${thresholdPct}%`;
  const missingComputedDetail =
    missingComputedAsins.length > 0
      ? `missing_computed_rows=${missingComputedAsins.length}` +
        (missingComputedSample ? ` (sample_asins=${missingComputedSample})` : "")
      : "missing_computed_rows=0";

  return {
    ok,
    detail: structuralPass
      ? coveragePass
        ? `top_sourcing_rows: structural_ok, ${coverageDetail}, ${missingComputedDetail}`
        : `top_sourcing_rows coverage_below_threshold: ${coverageDetail}, ${missingComputedDetail}`
      : `top_sourcing_rows structural_failures (${structuralFailures.length}): ${structuralFailures.join(
          "; "
        )}; ${coverageDetail}, ${missingComputedDetail}`,
  };
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is not set (.env.local).");
    process.exit(1);
  }

  const minComputedCoverage = parseMinComputedCoverage(process.argv.slice(2));
  const checks = await Promise.all([
    checkQogitaSourceSplit(),
    checkMatchConfidenceSplit(),
    checkTopSourcingComputedFields(20, minComputedCoverage),
  ]);

  checks.forEach((c, i) => {
    const label = i + 1;
    console.log(`${c.ok ? "PASS" : "FAIL"} [${label}] ${c.detail}`);
  });

  const failed = checks.some((c) => !c.ok);
  if (failed) {
    console.error("Verification failed.");
    process.exit(1);
  }
  console.log("Verification passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
