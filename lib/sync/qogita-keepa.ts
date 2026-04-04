import { desc, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  keepaCatalogItems,
  priceSnapshots,
  productMatches,
  qogitaProducts,
  syncRuns,
} from "@/db/schema";
import {
  runFullPipelineSync,
  toLegacySyncResult,
  type QogitaKeepaSyncResult,
} from "@/lib/sync/pipeline";

export type { QogitaKeepaSyncResult } from "@/lib/sync/pipeline";
export type { SyncRunDiagnosticsStats } from "@/lib/sync/types";

/** @deprecated name — runs Keepa-first pipeline + Qogita catalog + DB match. */
export async function runQogitaKeepaSync(): Promise<QogitaKeepaSyncResult> {
  return toLegacySyncResult(await runFullPipelineSync());
}

export type KeepaDashboardRow = {
  matchId: string;
  asin: string;
  amazonTitle: string | null;
  amazonBuyBoxGbp: string | null;
  avg30BuyBoxGbp: string | null;
  salesRank: number | null;
  salesRankDrops30: number | null;
  capturedAt: Date;
  confidence: "high" | "medium";
  qogitaId: string | null;
  qogitaTitle: string | null;
  ean: string | null;
  buyUnitPrice: string | null;
  currency: string | null;
  stockUnits: number | null;
};

/** Keepa catalog browse page: adds Amazon browse node + bestseller rank from DB. */
export type KeepaCatalogBrowseRow = KeepaDashboardRow & {
  browseNodeId: string | null;
  bestsellerRank: number | null;
  /** EAN stored on the Keepa row (before Qogita join). */
  keepaPrimaryEan: string | null;
  /** True when `metrics.keepaTimeseries` was stored (30d Keepa arrays). */
  hasKeepaTimeseries: boolean;
};

function metricsVelocity(m: Record<string, unknown>): number {
  if (typeof m.salesRankDrops30 === "number") {
    return m.salesRankDrops30;
  }
  const ks = m.keepaStats;
  if (ks && typeof ks === "object" && ks !== null) {
    const d = (ks as Record<string, unknown>).salesRankDrops30;
    if (typeof d === "number") {
      return d;
    }
  }
  return 0;
}

function metricsRank(m: Record<string, unknown>): number {
  if (typeof m.salesRank === "number" && m.salesRank > 0) {
    return m.salesRank;
  }
  return 99_999_999;
}

/**
 * Top Keepa-backed rows from `keepa_catalog_items` (demand), joined to Qogita when EAN matches.
 */
export async function listTopKeepaDashboardRows(
  limit = 20
): Promise<KeepaDashboardRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      k: keepaCatalogItems,
      qogitaQid: qogitaProducts.qogitaId,
      qogitaTitle: qogitaProducts.title,
      buyUnitPrice: qogitaProducts.buyUnitPrice,
      currency: qogitaProducts.currency,
      stockUnits: qogitaProducts.stockUnits,
      qpEan: qogitaProducts.ean,
    })
    .from(keepaCatalogItems)
    .leftJoin(
      qogitaProducts,
      eq(keepaCatalogItems.primaryEan, qogitaProducts.ean)
    )
    .orderBy(desc(keepaCatalogItems.capturedAt))
    .limit(500);

  const metById = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    metById.set(row.k.id, row.k.metrics as Record<string, unknown>);
  }

  const mapped = rows.map((row) => {
    const met = row.k.metrics as Record<string, unknown>;
    const hasQogita = Boolean(row.qogitaQid);
    return {
      matchId: row.k.id,
      asin: row.k.asin,
      amazonTitle:
        typeof met.amazonTitle === "string" ? met.amazonTitle : row.k.title,
      amazonBuyBoxGbp:
        typeof met.amazonBuyBoxGbp === "string" ? met.amazonBuyBoxGbp : null,
      avg30BuyBoxGbp:
        typeof met.avg30BuyBoxGbp === "string" ? met.avg30BuyBoxGbp : null,
      salesRank: typeof met.salesRank === "number" ? met.salesRank : null,
      salesRankDrops30:
        typeof met.salesRankDrops30 === "number"
          ? met.salesRankDrops30
          : null,
      capturedAt: row.k.capturedAt,
      confidence: hasQogita ? ("high" as const) : ("medium" as const),
      qogitaId: row.qogitaQid ?? null,
      qogitaTitle: row.qogitaTitle ?? null,
      ean: row.qpEan ?? row.k.primaryEan ?? null,
      buyUnitPrice: row.buyUnitPrice,
      currency: row.currency ?? "EUR",
      stockUnits: row.stockUnits,
    };
  });

  mapped.sort((a, b) => {
    const ma = metById.get(a.matchId) ?? {};
    const mb = metById.get(b.matchId) ?? {};
    const vd = metricsVelocity(mb) - metricsVelocity(ma);
    if (vd !== 0) {
      return vd;
    }
    return metricsRank(ma) - metricsRank(mb);
  });

  return mapped.slice(0, limit);
}

/**
 * Paginated Keepa catalog for the “Keepa data” view.
 * Sorted by capture time (newest first). Total count for pagination.
 */
export async function listKeepaCatalogPage(
  limit: number,
  offset: number
): Promise<{ rows: KeepaCatalogBrowseRow[]; total: number }> {
  const db = getDb();

  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(keepaCatalogItems);
  const total = countRow?.c ?? 0;

  const rows = await db
    .select({
      k: keepaCatalogItems,
      qogitaQid: qogitaProducts.qogitaId,
      qogitaTitle: qogitaProducts.title,
      buyUnitPrice: qogitaProducts.buyUnitPrice,
      currency: qogitaProducts.currency,
      stockUnits: qogitaProducts.stockUnits,
      qpEan: qogitaProducts.ean,
    })
    .from(keepaCatalogItems)
    .leftJoin(
      qogitaProducts,
      eq(keepaCatalogItems.primaryEan, qogitaProducts.ean)
    )
    .orderBy(desc(keepaCatalogItems.capturedAt))
    .limit(limit)
    .offset(offset);

  const mapped: KeepaCatalogBrowseRow[] = rows.map((row) => {
    const met = row.k.metrics as Record<string, unknown>;
    const hasQogita = Boolean(row.qogitaQid);
    const hasKeepaTimeseries = Boolean(met?.keepaTimeseries);
    return {
      matchId: row.k.id,
      asin: row.k.asin,
      amazonTitle:
        typeof met.amazonTitle === "string" ? met.amazonTitle : row.k.title,
      amazonBuyBoxGbp:
        typeof met.amazonBuyBoxGbp === "string" ? met.amazonBuyBoxGbp : null,
      avg30BuyBoxGbp:
        typeof met.avg30BuyBoxGbp === "string" ? met.avg30BuyBoxGbp : null,
      salesRank: typeof met.salesRank === "number" ? met.salesRank : null,
      salesRankDrops30:
        typeof met.salesRankDrops30 === "number"
          ? met.salesRankDrops30
          : null,
      capturedAt: row.k.capturedAt,
      confidence: hasQogita ? ("high" as const) : ("medium" as const),
      qogitaId: row.qogitaQid ?? null,
      qogitaTitle: row.qogitaTitle ?? null,
      ean: row.qpEan ?? row.k.primaryEan ?? null,
      buyUnitPrice: row.buyUnitPrice,
      currency: row.currency ?? "EUR",
      stockUnits: row.stockUnits,
      browseNodeId: row.k.browseNodeId,
      bestsellerRank: row.k.bestsellerRank,
      keepaPrimaryEan: row.k.primaryEan,
      hasKeepaTimeseries,
    };
  });

  return { rows: mapped, total };
}

export type DashboardInventorySummary = {
  qogitaOffersInDb: number;
  withEan: number;
  amazonUkMatches: number;
  withKeepaSnapshot: number;
  keepaCatalogRows: number;
};

export async function getDashboardInventorySummary(): Promise<DashboardInventorySummary> {
  const db = getDb();
  const [qogitaTotal] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(qogitaProducts);
  const [withEanRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(qogitaProducts)
    .where(isNotNull(qogitaProducts.ean));
  const [amz] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(productMatches)
    .where(eq(productMatches.channel, "amazon_uk"));
  const snapRows = await db
    .select({ productMatchId: priceSnapshots.productMatchId })
    .from(priceSnapshots)
    .where(eq(priceSnapshots.source, "keepa"));
  const withKeepaSnapshot = new Set(snapRows.map((r) => r.productMatchId)).size;

  const [kc] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(keepaCatalogItems);

  return {
    qogitaOffersInDb: qogitaTotal?.c ?? 0,
    withEan: withEanRow?.c ?? 0,
    amazonUkMatches: amz?.c ?? 0,
    withKeepaSnapshot,
    keepaCatalogRows: kc?.c ?? 0,
  };
}

export async function getLatestSyncRun() {
  const db = getDb();
  const [row] = await db
    .select()
    .from(syncRuns)
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return row ?? null;
}

export async function listRecentQogitaExtractions(limit = 15) {
  const db = getDb();
  return db
    .select({
      qogitaId: qogitaProducts.qogitaId,
      title: qogitaProducts.title,
      ean: qogitaProducts.ean,
      categorySlug: qogitaProducts.categorySlug,
      updatedAt: qogitaProducts.updatedAt,
    })
    .from(qogitaProducts)
    .orderBy(desc(qogitaProducts.updatedAt))
    .limit(limit);
}
