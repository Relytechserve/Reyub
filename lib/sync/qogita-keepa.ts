import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  priceSnapshots,
  productMatches,
  qogitaProducts,
  syncRuns,
} from "@/db/schema";
import {
  ensureAmazonExternalRef,
  ensureCanonicalForAmazonListing,
  ensureCanonicalForQogitaProductId,
  KEEPA_DOMAIN_UK,
} from "@/lib/catalog/ensure-canonical";
import {
  extractListingSummary,
  fetchKeepaProductsByProductCodes,
  formatGbpFromKeepaMinor,
  type KeepaProduct,
} from "@/lib/keepa/product";
import {
  fetchOffersUpTo,
  mapOfferToRow,
  qogitaOffersEntryPath,
} from "@/lib/qogita/offers";

export type QogitaKeepaSyncResult = {
  offersFetched: number;
  qogitaRowsUpserted: number;
  withEan: number;
  keepaProductsReturned: number;
  keepaRowsSaved: number;
  matchesUpserted: number;
  errors: string[];
};

export type SyncRunDiagnosticsStats = {
  offersFetched: number;
  qogitaRowsUpserted: number;
  offersWithEanInBatch: number;
  uniqueEansSentToKeepa: number;
  keepaKeyConfigured: boolean;
  keepaApiCalled: boolean;
  keepaProductsReturned: number;
  keepaRowsSaved: number;
  keepaSkippedNoAsin: number;
  matchesWithQogitaEan: number;
  qogitaOffersPath: string;
  categoryFilterApplied: boolean;
  categoryNote: string;
};

function keepaEansFromProduct(p: KeepaProduct): string[] {
  const raw = p.eanList;
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x).replace(/\D/g, ""))
      .filter((d) => d.length >= 8 && d.length <= 14);
  }
  if (typeof p.ean === "string") {
    const d = p.ean.replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 14) {
      return [d];
    }
  }
  return [];
}

export async function runQogitaKeepaSync(): Promise<QogitaKeepaSyncResult> {
  const errors: string[] = [];
  const maxOffers = Number(process.env.QOGITA_SYNC_MAX_OFFERS ?? "100") || 100;
  const keepaKey = process.env.KEEPA_API_KEY?.trim();
  const db = getDb();
  const startedAt = new Date();
  const [runRow] = await db
    .insert(syncRuns)
    .values({ startedAt, status: "running" })
    .returning({ id: syncRuns.id });
  const runId = runRow?.id ?? null;

  let offersFetched = 0;
  let qogitaRowsUpserted = 0;
  let offersWithEanInBatch = 0;
  let withEan = 0;
  let keepaProductsReturned = 0;
  let keepaRowsSaved = 0;
  let matchesUpserted = 0;
  let keepaSkippedNoAsin = 0;
  let keepaApiCalled = false;

  const persistSyncRun = async () => {
    if (!runId) {
      return;
    }
    const stats: SyncRunDiagnosticsStats = {
      offersFetched,
      qogitaRowsUpserted,
      offersWithEanInBatch,
      uniqueEansSentToKeepa: withEan,
      keepaKeyConfigured: Boolean(keepaKey),
      keepaApiCalled,
      keepaProductsReturned,
      keepaRowsSaved,
      keepaSkippedNoAsin,
      matchesWithQogitaEan: matchesUpserted,
      qogitaOffersPath: qogitaOffersEntryPath(),
      categoryFilterApplied: false,
      categoryNote:
        "Dashboard category preferences (health & beauty, fragrance, household) do not filter Qogita GET offers unless you add query params via QOGITA_OFFERS_PATH.",
    };
    let status: "success" | "partial" | "failed" = "success";
    if (errors.length > 0) {
      status =
        qogitaRowsUpserted > 0 || keepaRowsSaved > 0 ? "partial" : "failed";
    }
    await db
      .update(syncRuns)
      .set({
        finishedAt: new Date(),
        status,
        stats,
        error: errors.length > 0 ? errors.slice(0, 12).join(" | ") : null,
      })
      .where(eq(syncRuns.id, runId));
  };

  let offers: unknown[] = [];
  try {
    offers = await fetchOffersUpTo(maxOffers);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Qogita fetch failed: ${msg}`);
    await persistSyncRun();
    return {
      offersFetched: 0,
      qogitaRowsUpserted: 0,
      withEan: 0,
      keepaProductsReturned: 0,
      keepaRowsSaved: 0,
      matchesUpserted: 0,
      errors,
    };
  }

  offersFetched = offers.length;
  const rows = offers
    .map(mapOfferToRow)
    .filter((r): r is NonNullable<typeof r> => r !== null);

  offersWithEanInBatch = rows.filter((r) => r.ean).length;

  try {
  for (const row of rows) {
    try {
      await db
        .insert(qogitaProducts)
        .values({
          qogitaId: row.qogitaId,
          ean: row.ean,
          title: row.title,
          brand: row.brand,
          categorySlug: row.categorySlug,
          currency: row.currency,
          buyUnitPrice: row.buyUnitPrice,
          stockUnits: row.stockUnits,
          rawPayload: row.rawPayload,
        })
        .onConflictDoUpdate({
          target: qogitaProducts.qogitaId,
          set: {
            ean: sql`excluded.ean`,
            title: sql`excluded.title`,
            brand: sql`excluded.brand`,
            categorySlug: sql`excluded.category_slug`,
            currency: sql`excluded.currency`,
            buyUnitPrice: sql`excluded.buy_unit_price`,
            stockUnits: sql`excluded.stock_units`,
            rawPayload: sql`excluded.raw_payload`,
            updatedAt: sql`now()`,
          },
        });
      qogitaRowsUpserted += 1;
    } catch (e) {
      errors.push(
        `Upsert qogita ${row.qogitaId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const qids = rows.map((r) => r.qogitaId);
  let dbRows =
    qids.length > 0
      ? await db
          .select()
          .from(qogitaProducts)
          .where(inArray(qogitaProducts.qogitaId, qids))
      : [];

  for (const r of dbRows) {
    await ensureCanonicalForQogitaProductId(db, r.id);
  }

  if (qids.length > 0) {
    dbRows = await db
      .select()
      .from(qogitaProducts)
      .where(inArray(qogitaProducts.qogitaId, qids));
  }

  const eanToQogitaId = new Map<string, string>();
  for (const r of dbRows) {
    if (r.ean) {
      eanToQogitaId.set(r.ean, r.id);
    }
  }

  const eans = [...eanToQogitaId.keys()];
  withEan = eans.length;
  let keepaProducts: KeepaProduct[] = [];
  if (keepaKey && eans.length > 0) {
    keepaApiCalled = true;
    try {
      keepaProducts = await fetchKeepaProductsByProductCodes(eans, keepaKey);
      keepaProductsReturned = keepaProducts.length;
    } catch (e) {
      errors.push(`Keepa: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!keepaKey && eans.length > 0) {
    errors.push(
      "KEEPA_API_KEY not set — Qogita offers saved; Amazon / Keepa data skipped."
    );
  } else if (eans.length === 0) {
    errors.push(
      "No EAN/GTIN on synced Qogita offers — add barcodes in Qogita or widen offer set so Keepa can return Amazon listings."
    );
  }

  const now = new Date();

  for (const kp of keepaProducts) {
    const summary = extractListingSummary(kp);
    if (!summary.asin) {
      keepaSkippedNoAsin += 1;
      continue;
    }

    const codeEans = keepaEansFromProduct(kp);
    let qogitaProductId: string | undefined;
    for (const e of codeEans) {
      const id = eanToQogitaId.get(e);
      if (id) {
        qogitaProductId = id;
        break;
      }
    }

    const qpRow = qogitaProductId
      ? dbRows.find((r) => r.id === qogitaProductId)
      : undefined;

    const primaryEan = codeEans[0] ?? null;

    let canonicalId: string | null = null;
    if (qpRow) {
      let cid = qpRow.canonicalProductId;
      if (!cid) {
        cid = await ensureCanonicalForQogitaProductId(db, qpRow.id);
      }
      if (!cid) {
        const refreshed = await db
          .select({ canonicalProductId: qogitaProducts.canonicalProductId })
          .from(qogitaProducts)
          .where(eq(qogitaProducts.id, qpRow.id))
          .limit(1);
        cid = refreshed[0]?.canonicalProductId ?? null;
      }
      canonicalId = cid;
      if (canonicalId) {
        await ensureAmazonExternalRef(db, canonicalId, KEEPA_DOMAIN_UK, summary.asin, {
          asin: summary.asin,
          title: summary.title,
        });
      }
    } else {
      canonicalId = await ensureCanonicalForAmazonListing(
        db,
        KEEPA_DOMAIN_UK,
        summary.asin,
        summary.title,
        primaryEan
      );
    }

    const existing = await db
      .select({ id: productMatches.id })
      .from(productMatches)
      .where(
        and(
          eq(productMatches.channel, "amazon_uk"),
          eq(productMatches.externalId, summary.asin)
        )
      )
      .limit(1);

    let matchId: string;
    const confidence = qpRow ? ("high" as const) : ("medium" as const);
    const reasonTags = qpRow ? (["ean_exact"] as string[]) : (["keepa_amazon_only"] as string[]);

    if (existing[0]) {
      matchId = existing[0].id;
      await db
        .update(productMatches)
        .set({
          qogitaProductId: qpRow ? qpRow.id : null,
          canonicalProductId: canonicalId,
          confidence,
          reasonTags,
          updatedAt: now,
        })
        .where(eq(productMatches.id, matchId));
    } else {
      const inserted = await db
        .insert(productMatches)
        .values({
          qogitaProductId: qpRow ? qpRow.id : null,
          canonicalProductId: canonicalId,
          channel: "amazon_uk",
          externalId: summary.asin,
          confidence,
          reasonTags,
        })
        .returning({ id: productMatches.id });
      const ins = inserted[0];
      if (!ins) {
        continue;
      }
      matchId = ins.id;
    }

    const amazonGbp = formatGbpFromKeepaMinor(summary.buyBoxMinor);
    const avg30Gbp = formatGbpFromKeepaMinor(summary.avg30BuyBoxMinor);

    await db.insert(priceSnapshots).values({
      productMatchId: matchId,
      source: "keepa",
      capturedAt: now,
      metrics: {
        amazonAsin: summary.asin,
        amazonTitle: summary.title,
        amazonBuyBoxGbp: amazonGbp,
        buyBoxMinor: summary.buyBoxMinor,
        avg30BuyBoxGbp: avg30Gbp,
        avg30BuyBoxMinor: summary.avg30BuyBoxMinor,
        salesRank: summary.salesRank,
        salesRankDrops30: summary.salesRankDrops30,
        keepaStats: summary.statsSnippet,
        qogita: qpRow
          ? {
              qogitaId: qpRow.qogitaId,
              title: qpRow.title,
              ean: qpRow.ean,
              buyUnitPrice: qpRow.buyUnitPrice,
              currency: qpRow.currency,
              stockUnits: qpRow.stockUnits,
            }
          : null,
      },
    });

    keepaRowsSaved += 1;
    if (qpRow) {
      matchesUpserted += 1;
    }
  }

  await persistSyncRun();

  return {
    offersFetched,
    qogitaRowsUpserted,
    withEan,
    keepaProductsReturned,
    keepaRowsSaved,
    matchesUpserted,
    errors,
  };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Sync failed: ${msg}`);
    await persistSyncRun();
    return {
      offersFetched,
      qogitaRowsUpserted,
      withEan,
      keepaProductsReturned,
      keepaRowsSaved,
      matchesUpserted,
      errors,
    };
  }
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
 * Latest Keepa snapshot per Amazon UK match, sorted by demand proxy (rank drops, then BSR).
 */
export async function listTopKeepaDashboardRows(
  limit = 20
): Promise<KeepaDashboardRow[]> {
  const db = getDb();

  const matches = await db
    .select({
      matchId: productMatches.id,
      asin: productMatches.externalId,
      confidence: productMatches.confidence,
      qogitaQid: qogitaProducts.qogitaId,
      qogitaTitle: qogitaProducts.title,
      ean: qogitaProducts.ean,
      buyUnitPrice: qogitaProducts.buyUnitPrice,
      currency: qogitaProducts.currency,
      stockUnits: qogitaProducts.stockUnits,
      qpUpdatedAt: qogitaProducts.updatedAt,
    })
    .from(productMatches)
    .leftJoin(
      qogitaProducts,
      eq(productMatches.qogitaProductId, qogitaProducts.id)
    )
    .where(eq(productMatches.channel, "amazon_uk"))
    .orderBy(desc(productMatches.updatedAt))
    .limit(500);

  if (matches.length === 0) {
    return [];
  }

  const matchIds = matches.map((m) => m.matchId);
  const snaps = await db
    .select()
    .from(priceSnapshots)
    .where(
      and(
        inArray(priceSnapshots.productMatchId, matchIds),
        eq(priceSnapshots.source, "keepa")
      )
    )
    .orderBy(desc(priceSnapshots.capturedAt));

  const latestByMatch = new Map<string, (typeof snaps)[0]>();
  for (const s of snaps) {
    if (!latestByMatch.has(s.productMatchId)) {
      latestByMatch.set(s.productMatchId, s);
    }
  }

  const withSnap = matches
    .map((m) => {
      const snap = latestByMatch.get(m.matchId);
      if (!snap) {
        return null;
      }
      const met = snap.metrics as Record<string, unknown>;
      const qogita = met.qogita as Record<string, unknown> | null | undefined;
      return {
        matchId: m.matchId,
        asin: m.asin,
        amazonTitle:
          typeof met.amazonTitle === "string" ? met.amazonTitle : null,
        amazonBuyBoxGbp:
          typeof met.amazonBuyBoxGbp === "string" ? met.amazonBuyBoxGbp : null,
        avg30BuyBoxGbp:
          typeof met.avg30BuyBoxGbp === "string" ? met.avg30BuyBoxGbp : null,
        salesRank: typeof met.salesRank === "number" ? met.salesRank : null,
        salesRankDrops30:
          typeof met.salesRankDrops30 === "number"
            ? met.salesRankDrops30
            : null,
        capturedAt: snap.capturedAt,
        confidence: m.confidence,
        qogitaId:
          typeof qogita?.qogitaId === "string"
            ? qogita.qogitaId
            : (m.qogitaQid ?? null),
        qogitaTitle:
          typeof qogita?.title === "string"
            ? qogita.title
            : (m.qogitaTitle ?? null),
        ean:
          typeof qogita?.ean === "string"
            ? qogita.ean
            : (m.ean ?? null),
        buyUnitPrice:
          typeof qogita?.buyUnitPrice === "string"
            ? qogita.buyUnitPrice
            : m.buyUnitPrice,
        currency:
          typeof qogita?.currency === "string"
            ? qogita.currency
            : (m.currency ?? "EUR"),
        stockUnits:
          typeof qogita?.stockUnits === "number"
            ? qogita.stockUnits
            : m.stockUnits,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  withSnap.sort((a, b) => {
    const ma = latestByMatch.get(a.matchId)?.metrics as Record<string, unknown>;
    const mb = latestByMatch.get(b.matchId)?.metrics as Record<string, unknown>;
    const vd = metricsVelocity(mb) - metricsVelocity(ma);
    if (vd !== 0) {
      return vd;
    }
    return metricsRank(ma) - metricsRank(mb);
  });

  return withSnap.slice(0, limit);
}

export type DashboardInventorySummary = {
  qogitaOffersInDb: number;
  withEan: number;
  amazonUkMatches: number;
  withKeepaSnapshot: number;
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

  return {
    qogitaOffersInDb: qogitaTotal?.c ?? 0,
    withEan: withEanRow?.c ?? 0,
    amazonUkMatches: amz?.c ?? 0,
    withKeepaSnapshot,
  };
}

/** Latest completed sync row (running or finished) for dashboard diagnostics. */
export async function getLatestSyncRun() {
  const db = getDb();
  const [row] = await db
    .select()
    .from(syncRuns)
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return row ?? null;
}

/** Recent rows from `qogita_products` to verify extraction (EAN/category). */
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
