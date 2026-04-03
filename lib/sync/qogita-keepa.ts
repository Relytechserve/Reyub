import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  priceSnapshots,
  productMatches,
  qogitaProducts,
} from "@/db/schema";
import {
  ensureAmazonExternalRef,
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
      errors.push(
        `Keepa: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  } else if (!keepaKey && eans.length > 0) {
    errors.push("KEEPA_API_KEY not set — Qogita offers saved; Amazon matching skipped.");
  }

  let matchesUpserted = 0;
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
    if (!qogitaProductId) {
      continue;
    }

    const qpRow = dbRows.find((r) => r.id === qogitaProductId);
    if (!qpRow) {
      continue;
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
    const canonicalId = qpRow.canonicalProductId;

    if (existing[0]) {
      matchId = existing[0].id;
      await db
        .update(productMatches)
        .set({
          qogitaProductId,
          canonicalProductId: canonicalId,
          confidence: "high",
          reasonTags: ["ean_exact"],
          updatedAt: now,
        })
        .where(eq(productMatches.id, matchId));
    } else {
      const inserted = await db
        .insert(productMatches)
        .values({
          qogitaProductId,
          canonicalProductId: canonicalId,
          channel: "amazon_uk",
          externalId: summary.asin,
          confidence: "high",
          reasonTags: ["ean_exact"],
        })
        .returning({ id: productMatches.id });
      const ins = inserted[0];
      if (!ins) {
        continue;
      }
      matchId = ins.id;
    }

    if (canonicalId) {
      await ensureAmazonExternalRef(db, canonicalId, KEEPA_DOMAIN_UK, summary.asin, {
        asin: summary.asin,
        title: summary.title,
      });
    }

    const amazonGbp = formatGbpFromKeepaMinor(summary.buyBoxMinor);

    await db.insert(priceSnapshots).values({
      productMatchId: matchId,
      source: "keepa",
      capturedAt: now,
      metrics: {
        amazonAsin: summary.asin,
        amazonTitle: summary.title,
        amazonBuyBoxGbp: amazonGbp,
        buyBoxMinor: summary.buyBoxMinor,
        salesRank: summary.salesRank,
        keepaStats: summary.statsSnippet,
        qogita: {
          qogitaId: qpRow.qogitaId,
          title: qpRow.title,
          ean: qpRow.ean,
          buyUnitPrice: qpRow.buyUnitPrice,
          currency: qpRow.currency,
          stockUnits: qpRow.stockUnits,
        },
      },
    });

    matchesUpserted += 1;
  }

  return {
    offersFetched: offers.length,
    qogitaRowsUpserted,
    withEan: eans.length,
    keepaProductsReturned: keepaProducts.length,
    matchesUpserted,
    errors,
  };
}

export type MatchedRow = {
  qogitaId: string;
  title: string;
  ean: string | null;
  buyUnitPrice: string | null;
  currency: string;
  stockUnits: number | null;
  asin: string;
  amazonTitle: string | null;
  amazonBuyBoxGbp: string | null;
  salesRank: number | null;
  capturedAt: Date;
};

export async function listQogitaKeepaMatches(
  limit = 50
): Promise<MatchedRow[]> {
  const db = getDb();

  const matches = await db
    .select({
      matchId: productMatches.id,
      asin: productMatches.externalId,
      qogitaQid: qogitaProducts.qogitaId,
      title: qogitaProducts.title,
      ean: qogitaProducts.ean,
      buyUnitPrice: qogitaProducts.buyUnitPrice,
      currency: qogitaProducts.currency,
      stockUnits: qogitaProducts.stockUnits,
      qpUpdatedAt: qogitaProducts.updatedAt,
    })
    .from(productMatches)
    .innerJoin(
      qogitaProducts,
      eq(productMatches.qogitaProductId, qogitaProducts.id)
    )
    .where(eq(productMatches.channel, "amazon_uk"))
    .orderBy(desc(productMatches.updatedAt))
    .limit(limit);

  if (matches.length === 0) {
    return [];
  }

  const matchIds = matches.map((m) => m.matchId);
  const snaps = await db
    .select()
    .from(priceSnapshots)
    .where(inArray(priceSnapshots.productMatchId, matchIds))
    .orderBy(desc(priceSnapshots.capturedAt));

  const latestByMatch = new Map<string, (typeof snaps)[0]>();
  for (const s of snaps) {
    if (!latestByMatch.has(s.productMatchId)) {
      latestByMatch.set(s.productMatchId, s);
    }
  }

  return matches.map((m) => {
    const snap = latestByMatch.get(m.matchId);
    const met = (snap?.metrics ?? {}) as Record<string, unknown>;
    return {
      qogitaId: m.qogitaQid,
      title: m.title,
      ean: m.ean,
      buyUnitPrice: m.buyUnitPrice,
      currency: m.currency,
      stockUnits: m.stockUnits,
      asin: m.asin,
      amazonTitle:
        typeof met.amazonTitle === "string" ? met.amazonTitle : null,
      amazonBuyBoxGbp:
        typeof met.amazonBuyBoxGbp === "string" ? met.amazonBuyBoxGbp : null,
      salesRank: typeof met.salesRank === "number" ? met.salesRank : null,
      capturedAt: snap?.capturedAt ?? m.qpUpdatedAt,
    };
  });
}
