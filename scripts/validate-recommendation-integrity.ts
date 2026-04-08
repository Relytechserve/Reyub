import { config } from "dotenv";
import { resolve } from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";

import { getDb } from "@/db";
import { keepaCatalogItems, productMatches, qogitaProducts } from "@/db/schema";
import { KEEPA_DOMAIN_UK } from "@/lib/keepa/product";
import { EXCEL_CATALOG_QOGITA_ID_PREFIX } from "@/lib/matching/amazon-qogita-sync";
import { normalizeTitleForMatch, titleTokens, tokenSetJaccard } from "@/lib/matching/title-similarity";
import { buildQogitaProductUrl, isValidQogitaUrl } from "@/lib/sourcing/qogita-link";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

type Args = {
  asin: string | null;
  limit: number | null;
};

function parseArgs(argv: string[]): Args {
  let asin: string | null = null;
  let limit: number | null = null;
  for (const a of argv) {
    if (a.startsWith("--asin=")) {
      asin = a.slice("--asin=".length).trim().toUpperCase() || null;
    } else if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length));
      limit = Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
    }
  }
  return { asin, limit };
}

function keepaEanCandidates(row: { primaryEan: string | null; metrics: unknown }): Set<string> {
  const out = new Set<string>();
  const metrics = row.metrics as Record<string, unknown>;
  if (row.primaryEan) {
    const d = row.primaryEan.replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 14) {
      out.add(d);
    }
  }
  const cand = metrics.eanCandidates;
  if (Array.isArray(cand)) {
    for (const raw of cand) {
      const d = String(raw ?? "").replace(/\D/g, "");
      if (d.length >= 8 && d.length <= 14) {
        out.add(d);
      }
    }
  }
  return out;
}

function titleSimilarity(a: string, b: string): number {
  const aTok = titleTokens(normalizeTitleForMatch(a));
  const bTok = titleTokens(normalizeTitleForMatch(b));
  return tokenSetJaccard(aTok, bTok);
}

function isLikelyUrlBroken(url: string | null): boolean {
  if (!url) {
    return true;
  }
  try {
    const parsed = new URL(url);
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
      return true;
    }
    if (!parsed.hostname.includes("qogita.com")) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function readProductLink(flags: unknown): string | null {
  if (!flags || typeof flags !== "object") {
    return null;
  }
  const maybe = (flags as Record<string, unknown>).productLink;
  if (typeof maybe !== "string") {
    return null;
  }
  const trimmed = maybe.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLikelyStaleProductLink(rawLink: string): boolean {
  try {
    const parsed = new URL(rawLink);
    const host = parsed.hostname.trim().toLowerCase();
    const isQogita = host === "qogita.com" || host.endsWith(".qogita.com");
    if (!isQogita) {
      return true;
    }
    const path = parsed.pathname.trim().toLowerCase();
    const looksLikeKnownPath =
      path === "/" ||
      path.startsWith("/search/") ||
      path.startsWith("/search") ||
      path.startsWith("/products/") ||
      path.startsWith("/product/") ||
      path.startsWith("/p/");
    return !looksLikeKnownPath;
  } catch {
    return true;
  }
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is not set (.env.local).");
  }
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  const joined = await db
    .select({
      matchId: productMatches.id,
      confidence: productMatches.confidence,
      reasonTags: productMatches.reasonTags,
      asin: keepaCatalogItems.asin,
      amazonTitle: keepaCatalogItems.title,
      primaryEan: keepaCatalogItems.primaryEan,
      keepaMetrics: keepaCatalogItems.metrics,
      qogitaId: qogitaProducts.qogitaId,
      qogitaTitle: qogitaProducts.title,
      qogitaEan: qogitaProducts.ean,
      qogitaFlags: qogitaProducts.flags,
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
    .where(and(eq(productMatches.channel, "amazon_uk"), isNotNull(productMatches.qogitaProductId)));

  const filtered = joined
    .filter((r) => (args.asin ? r.asin === args.asin : true))
    .slice(0, args.limit ?? Number.MAX_SAFE_INTEGER);

  const findings: string[] = [];
  let malformedUrlCount = 0;
  let syntheticIdSearchCount = 0;
  let staleProductLinkCount = 0;
  let suspiciousMatchCount = 0;
  let imageCoverageCount = 0;
  let imageLowConflictCount = 0;
  let imageInfluencedConfidenceCount = 0;
  const sampleUrls: string[] = [];

  for (const row of filtered) {
    const url = buildQogitaProductUrl({
      qogitaId: row.qogitaId,
      ean: row.qogitaEan,
      flags: row.qogitaFlags,
    });
    if (sampleUrls.length < 10 && url) {
      sampleUrls.push(url);
    }
    if (isLikelyUrlBroken(url) || !isValidQogitaUrl(url)) {
      malformedUrlCount += 1;
      findings.push(`[LINK] ${row.asin} -> ${row.qogitaId} malformed url=${url ?? "null"}`);
    }
    if ((url ?? "").includes("/search/?q=excel-gtin-")) {
      syntheticIdSearchCount += 1;
      findings.push(`[LINK] ${row.asin} -> ${row.qogitaId} synthetic-id query url=${url ?? "null"}`);
    }

    const rawProductLink = readProductLink(row.qogitaFlags);
    if (rawProductLink && isLikelyStaleProductLink(rawProductLink)) {
      staleProductLinkCount += 1;
      findings.push(`[LINK] ${row.asin} -> ${row.qogitaId} stale productLink=${rawProductLink}`);
    }

    const keepaEans = keepaEanCandidates({
      primaryEan: row.primaryEan,
      metrics: row.keepaMetrics,
    });
    const qEan = row.qogitaEan?.replace(/\D/g, "") ?? "";
    const eanAgrees = qEan.length > 0 && keepaEans.has(qEan);
    const sim = titleSimilarity(row.amazonTitle, row.qogitaTitle);
    const tags = Array.isArray(row.reasonTags) ? row.reasonTags : [];
    if (tags.some((t) => typeof t === "string" && t.startsWith("sig_image:"))) {
      imageCoverageCount += 1;
    }
    if (tags.includes("conflict_image")) {
      imageLowConflictCount += 1;
      imageInfluencedConfidenceCount += 1;
    }
    if (tags.includes("image_conflict_low")) {
      imageInfluencedConfidenceCount += 1;
    }
    const isTitleOnly = tags.some((t) => typeof t === "string" && t.startsWith("title_token"));

    const suspicious =
      (row.confidence === "high" && !eanAgrees && sim < 0.2) ||
      (row.confidence === "high" && eanAgrees && sim < 0.2) ||
      (row.confidence === "medium" && sim < 0.2) ||
      (isTitleOnly && sim < 0.25);

    if (suspicious) {
      suspiciousMatchCount += 1;
      findings.push(
        `[MATCH] ${row.asin} -> ${row.qogitaId} confidence=${row.confidence} ean_match=${eanAgrees} sim=${sim.toFixed(
          3
        )} keepa_eans=${[...keepaEans].slice(0, 3).join("|") || "none"} qogita_ean=${qEan || "none"}`
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        checkedRows: filtered.length,
        malformedUrlCount,
        syntheticIdSearchCount,
        staleProductLinkCount,
        suspiciousMatchCount,
        imageCoveragePct:
          filtered.length > 0 ? Number(((imageCoverageCount / filtered.length) * 100).toFixed(2)) : 0,
        imageLowConflictCount,
        imageInfluencedConfidenceCount,
        sampleUrls,
      },
      null,
      2
    )
  );
  if (findings.length > 0) {
    console.log("---- Findings ----");
    for (const line of findings.slice(0, 200)) {
      console.log(line);
    }
    if (findings.length > 200) {
      console.log(`... truncated ${findings.length - 200} additional findings`);
    }
  } else {
    console.log("No integrity findings.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
