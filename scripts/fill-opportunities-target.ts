/**
 * Repeatedly expand sourcing opportunities until target is hit (or max rounds).
 *
 * Strategy per round:
 * 1) Run full pipeline sync with broad Keepa roots (low-token mode).
 * 2) Seed Keepa by Qogita EAN lookups.
 * 3) Recount matched opportunities.
 *
 * Usage:
 *   TARGET_MATCHES=2000 npm run fill:target
 */
import { config } from "dotenv";
import { resolve } from "path";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { productMatches } from "@/db/schema";
import { runFullPipelineSync } from "@/lib/sync/pipeline";
import { runSeedKeepaFromQogitaEans } from "@/scripts/seed-keepa-from-qogita-eans";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getMatchedCount(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(productMatches)
    .where(
      and(
        eq(productMatches.channel, "amazon_uk"),
        isNotNull(productMatches.qogitaProductId)
      )
    );
  return row?.c ?? 0;
}

function setBroadKeepaEnv(): void {
  process.env.KEEPA_BESTSELLER_CATEGORY_IDS =
    process.env.KEEPA_BESTSELLER_CATEGORY_IDS ??
    "118457031,117332031,65801031,340831031,468292,560798,1025612,266239";
  process.env.KEEPA_BESTSELLER_EXPAND_CHILDREN =
    process.env.KEEPA_BESTSELLER_EXPAND_CHILDREN ?? "0";
  process.env.KEEPA_BESTSELLER_MAX_CATEGORIES =
    process.env.KEEPA_BESTSELLER_MAX_CATEGORIES ?? "80";
  process.env.KEEPA_BESTSELLER_TARGET_ASINS =
    process.env.KEEPA_BESTSELLER_TARGET_ASINS ?? "8000";
  process.env.KEEPA_BESTSELLERS_PER_CATEGORY =
    process.env.KEEPA_BESTSELLERS_PER_CATEGORY ?? "100";
  process.env.KEEPA_BESTSELLER_RANGE =
    process.env.KEEPA_BESTSELLER_RANGE ?? "30";
  process.env.KEEPA_PRODUCT_INCLUDE_HISTORY =
    process.env.KEEPA_PRODUCT_INCLUDE_HISTORY ?? "0";

  // Slightly looser fuzzy gate for growth mode.
  process.env.MATCH_FUZZY_TITLES = process.env.MATCH_FUZZY_TITLES ?? "1";
  process.env.MATCH_FUZZY_MIN_JACCARD =
    process.env.MATCH_FUZZY_MIN_JACCARD ?? "0.30";
  process.env.MATCH_FUZZY_MIN_MARGIN =
    process.env.MATCH_FUZZY_MIN_MARGIN ?? "0.04";
}

async function main() {
  setBroadKeepaEnv();

  const target = Math.max(
    100,
    Number(process.env.TARGET_MATCHES ?? "2000") || 2000
  );
  const maxRounds = Math.max(1, Number(process.env.FILL_MAX_ROUNDS ?? "12") || 12);
  const roundPauseMs = Math.max(
    0,
    Number(process.env.FILL_ROUND_PAUSE_MS ?? "1500") || 1500
  );
  const seedStart = Math.max(
    2000,
    Number(process.env.KEEPA_EAN_SEED_LIMIT_START ?? "12000") || 12000
  );
  const seedStep = Math.max(
    500,
    Number(process.env.KEEPA_EAN_SEED_LIMIT_STEP ?? "4000") || 4000
  );
  const seedCap = Math.max(
    seedStart,
    Number(process.env.KEEPA_EAN_SEED_LIMIT_CAP ?? "50000") || 50000
  );

  let matched = await getMatchedCount();
  console.log(
    JSON.stringify(
      {
        phase: "start",
        target,
        maxRounds,
        matched,
      },
      null,
      2
    )
  );

  for (let round = 1; round <= maxRounds; round += 1) {
    if (matched >= target) {
      break;
    }

    const seedLimit = Math.min(seedCap, seedStart + (round - 1) * seedStep);
    const pipeline = await runFullPipelineSync();
    const seeded = await runSeedKeepaFromQogitaEans({ seedLimit });
    matched = await getMatchedCount();

    console.log(
      JSON.stringify(
        {
          phase: "round",
          round,
          seedLimit,
          matched,
          pipeline: {
            keepaBestsellerAsinsDiscovered: pipeline.keepaBestsellerAsinsDiscovered,
            keepaProductsFetched: pipeline.keepaProductsFetched,
            keepaCatalogRowsUpserted: pipeline.keepaCatalogRowsUpserted,
            matchesLinked: pipeline.matchesLinked,
            errors: pipeline.errors.length,
          },
          seeded: {
            qogitaEansConsidered: seeded.qogitaEansConsidered,
            keepaProductsReturned: seeded.keepaProductsReturned,
            keepaRowsUpserted: seeded.keepaRowsUpserted,
            matchesLinked: seeded.matchesLinked,
            errors: seeded.errors.length,
          },
        },
        null,
        2
      )
    );

    if (matched >= target) {
      break;
    }
    if (roundPauseMs > 0) {
      await sleep(roundPauseMs);
    }
  }

  const finalMatched = await getMatchedCount();
  console.log(
    JSON.stringify(
      {
        phase: "done",
        target,
        finalMatched,
        hitTarget: finalMatched >= target,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

