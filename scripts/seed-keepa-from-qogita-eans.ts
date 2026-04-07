/**
 * Expand Keepa catalog from Qogita EANs (code lookup), then run matcher.
 *
 * Usage:
 *   npm run seed:keepa:eans
 *   KEEPA_EAN_SEED_LIMIT=5000 npm run seed:keepa:eans
 */
import { config } from "dotenv";
import { resolve } from "path";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { keepaCatalogItems, qogitaProducts } from "@/db/schema";
import { KEEPA_DOMAIN_UK, extractListingSummary, formatGbpFromKeepaMinor } from "@/lib/keepa/product";
import { keepaEansFromProduct } from "@/lib/keepa/utils";
import { runAmazonQogitaMatching } from "@/lib/matching/amazon-qogita-sync";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

type KeepaProduct = Record<string, unknown>;
type KeepaProductResponse = {
  products?: KeepaProduct[];
  error?: { message?: string; type?: string };
};

const KEEPA_BASE = "https://api.keepa.com";

async function fetchKeepaProductsByCodes(
  codes: string[],
  apiKey: string,
  domain = KEEPA_DOMAIN_UK
): Promise<KeepaProduct[]> {
  const cleaned = [...new Set(codes.map((c) => c.replace(/\D/g, "")).filter((c) => c.length >= 8 && c.length <= 14))];
  const out: KeepaProduct[] = [];
  for (let i = 0; i < cleaned.length; i += 100) {
    const chunk = cleaned.slice(i, i + 100);
    const params = new URLSearchParams({
      key: apiKey,
      domain: String(domain),
      code: chunk.join(","),
      history: "0",
      stats: "30",
    });
    const res = await fetch(`${KEEPA_BASE}/product?${params}`);
    const json = (await res.json()) as KeepaProductResponse;
    if (json.error?.message) {
      continue;
    }
    if (!res.ok) {
      continue;
    }
    out.push(...(json.products ?? []));
  }
  return out;
}

export async function runSeedKeepaFromQogitaEans(options?: {
  seedLimit?: number;
}): Promise<{
  seedLimit: number;
  qogitaEansConsidered: number;
  keepaProductsReturned: number;
  keepaRowsUpserted: number;
  matchesLinked: number;
  matchEanStage: number;
  matchFuzzyStage: number;
  errors: string[];
}> {
  const apiKey = process.env.KEEPA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("KEEPA_API_KEY is required.");
  }

  const envSeedRaw = Number(process.env.KEEPA_EAN_SEED_LIMIT ?? "5000");
  const envSeed = Number.isFinite(envSeedRaw) && envSeedRaw > 0 ? envSeedRaw : 5000;
  const seedLimit = Math.max(
    500,
    Math.min(100_000, options?.seedLimit ?? envSeed)
  );
  const db = getDb();

  const qRows = await db
    .select({
      ean: qogitaProducts.ean,
    })
    .from(qogitaProducts)
    .where(isNotNull(qogitaProducts.ean))
    .orderBy(desc(qogitaProducts.updatedAt))
    .limit(seedLimit);

  const eans = [...new Set(qRows.map((r) => (r.ean ?? "").replace(/\D/g, "")).filter((e) => e.length >= 8 && e.length <= 14))];
  const products = await fetchKeepaProductsByCodes(eans, apiKey, KEEPA_DOMAIN_UK);

  let upserts = 0;
  const now = new Date();
  for (const kp of products) {
    const summary = extractListingSummary(kp);
    if (!summary.asin) {
      continue;
    }
    const eanCandidates = keepaEansFromProduct(kp);
    const primaryEan = eanCandidates[0] ?? null;
    const metrics = {
      amazonAsin: summary.asin,
      amazonTitle: summary.title,
      eanCandidates,
      amazonBuyBoxGbp: formatGbpFromKeepaMinor(summary.buyBoxMinor),
      buyBoxMinor: summary.buyBoxMinor,
      avg30BuyBoxGbp: formatGbpFromKeepaMinor(summary.avg30BuyBoxMinor),
      avg30BuyBoxMinor: summary.avg30BuyBoxMinor,
      salesRank: summary.salesRank,
      salesRankDrops30: summary.salesRankDrops30,
      keepaStats: summary.statsSnippet,
    };

    await db
      .insert(keepaCatalogItems)
      .values({
        asin: summary.asin,
        domainId: KEEPA_DOMAIN_UK,
        browseNodeId: null,
        bestsellerRank: null,
        title: summary.title,
        primaryEan,
        metrics,
        capturedAt: now,
      })
      .onConflictDoUpdate({
        target: [keepaCatalogItems.asin, keepaCatalogItems.domainId],
        set: {
          title: sql`excluded.title`,
          primaryEan: sql`excluded.primary_ean`,
          metrics: sql`excluded.metrics`,
          capturedAt: sql`excluded.captured_at`,
          updatedAt: sql`now()`,
        },
      });
    upserts += 1;
  }

  const errors: string[] = [];
  const matchStats = await runAmazonQogitaMatching(db, {
    now: new Date(),
    domain: KEEPA_DOMAIN_UK,
    errors,
  });

  return {
    seedLimit,
    qogitaEansConsidered: eans.length,
    keepaProductsReturned: products.length,
    keepaRowsUpserted: upserts,
    matchesLinked: matchStats.eanMatches + matchStats.fuzzyMatches,
    matchEanStage: matchStats.eanMatches,
    matchFuzzyStage: matchStats.fuzzyMatches,
    errors,
  };
}

async function main() {
  const result = await runSeedKeepaFromQogitaEans();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

