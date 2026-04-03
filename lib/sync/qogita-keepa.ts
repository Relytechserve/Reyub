import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  priceSnapshots,
  productMatches,
  qogitaProducts,
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
import { fetchOffersUpTo, mapOfferToRow } from "@/lib/qogita/offers";

export type QogitaKeepaSyncResult = {
  offersFetched: number;
  qogitaRowsUpserted: number;
  withEan: number;
  keepaProductsReturned: number;
  keepaRowsSaved: number;
  matchesUpserted: number;
  errors: string[];
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

  const offers = await fetchOffersUpTo(maxOffers);
  const rows = offers
    .map(mapOfferToRow)
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const db = getDb();
  let qogitaRowsUpserted = 0;

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
  let keepaProducts: KeepaProduct[] = [];
  if (keepaKey && eans.length > 0) {
    try {
      keepaProducts = await fetchKeepaProductsByProductCodes(eans, keepaKey);
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

  let matchesUpserted = 0;
  let keepaRowsSaved = 0;
  const now = new Date();

  for (const kp of keepaProducts) {
    const summary = extractListingSummary(kp);
    if (!summary.asin) {
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

  return {
    offersFetched: offers.length,
    qogitaRowsUpserted,
    withEan: eans.length,
    keepaProductsReturned: keepaProducts.length,
    keepaRowsSaved,
    matchesUpserted,
    errors,
  };
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
