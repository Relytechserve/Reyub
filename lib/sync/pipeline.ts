/**
 * Data pipeline: Keepa bestseller discovery → DB, Qogita catalog → DB, then EAN match.
 * Order is intentional: Amazon demand first, wholesale supply second, join in app DB.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  keepaCatalogItems,
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
import { fetchBestsellerAsins } from "@/lib/keepa/bestsellers";
import {
  extractListingSummary,
  fetchKeepaProductsByAsins,
  formatGbpFromKeepaMinor,
} from "@/lib/keepa/product";
import { keepaEansFromProduct } from "@/lib/keepa/utils";
import {
  fetchOffersUpTo,
  mapOfferToRow,
  qogitaOffersEntryPath,
} from "@/lib/qogita/offers";

import type { SyncRunDiagnosticsStats } from "@/lib/sync/types";

export type FullPipelineResult = {
  offersFetched: number;
  qogitaRowsUpserted: number;
  withEan: number;
  keepaBestsellerAsinsDiscovered: number;
  keepaProductsFetched: number;
  keepaCatalogRowsUpserted: number;
  matchesLinked: number;
  errors: string[];
};

/** Maps to dashboard / legacy sync form fields. */
export type QogitaKeepaSyncResult = {
  offersFetched: number;
  qogitaRowsUpserted: number;
  withEan: number;
  keepaProductsReturned: number;
  keepaRowsSaved: number;
  matchesUpserted: number;
  errors: string[];
};

export function toLegacySyncResult(r: FullPipelineResult): QogitaKeepaSyncResult {
  return {
    offersFetched: r.offersFetched,
    qogitaRowsUpserted: r.qogitaRowsUpserted,
    withEan: r.withEan,
    keepaProductsReturned: r.keepaProductsFetched,
    keepaRowsSaved: r.keepaCatalogRowsUpserted,
    matchesUpserted: r.matchesLinked,
    errors: r.errors,
  };
}

async function persistSyncRun(
  db: ReturnType<typeof getDb>,
  runId: string | null,
  errors: string[],
  stats: SyncRunDiagnosticsStats,
  qogitaRowsUpserted: number,
  keepaRowsSaved: number
): Promise<void> {
  if (!runId) {
    return;
  }
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
      error: errors.length > 0 ? errors.slice(0, 14).join(" | ") : null,
    })
    .where(eq(syncRuns.id, runId));
}

export async function runFullPipelineSync(): Promise<FullPipelineResult> {
  const errors: string[] = [];
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
  let keepaBestsellerAsinsDiscovered = 0;
  let keepaProductsFetched = 0;
  let keepaCatalogRowsUpserted = 0;
  let matchesLinked = 0;

  const maxOffers = Number(process.env.QOGITA_SYNC_MAX_OFFERS ?? "100") || 100;
  const keepaKey = process.env.KEEPA_API_KEY?.trim();
  const domain =
    Number(process.env.KEEPA_DOMAIN?.trim() ?? "") || KEEPA_DOMAIN_UK;
  const categoryIds =
    process.env.KEEPA_BESTSELLER_CATEGORY_IDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const perCategory = Math.min(
    100,
    Math.max(1, Number(process.env.KEEPA_BESTSELLERS_PER_CATEGORY ?? "50") || 50)
  );

  const finalizeStats = (): SyncRunDiagnosticsStats => ({
    offersFetched,
    qogitaRowsUpserted,
    offersWithEanInBatch,
    uniqueEansSentToKeepa: withEan,
    keepaKeyConfigured: Boolean(keepaKey),
    keepaApiCalled: keepaBestsellerAsinsDiscovered > 0 || keepaProductsFetched > 0,
    keepaProductsReturned: keepaProductsFetched,
    keepaRowsSaved: keepaCatalogRowsUpserted,
    keepaSkippedNoAsin: 0,
    matchesWithQogitaEan: matchesLinked,
    qogitaOffersPath: qogitaOffersEntryPath(),
    categoryFilterApplied: categoryIds.length > 0,
    categoryNote:
      categoryIds.length > 0
        ? `Keepa bestsellers pulled for browse nodes: ${categoryIds.join(", ")}. Qogita GET offers path is separate — match happens in DB by EAN.`
        : "Set KEEPA_BESTSELLER_CATEGORY_IDS to Amazon browse node IDs for bestseller discovery.",
  });

  try {
    // —— 1) Qogita wholesale catalog (independent ingest) ——
    let offers: unknown[] = [];
    try {
      offers = await fetchOffersUpTo(maxOffers);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Qogita fetch failed: ${msg}`);
      offersFetched = 0;
    }

    offersFetched = offers.length;
    const rows = offers
      .map(mapOfferToRow)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    offersWithEanInBatch = rows.filter((r) => r.ean).length;

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
    withEan = eanToQogitaId.size;

    // —— 2) Keepa: bestseller ASINs per category → product stats → keepa_catalog_items ——
    if (!keepaKey) {
      errors.push(
        "KEEPA_API_KEY not set — skipped Keepa bestseller discovery and product fetch."
      );
    } else if (categoryIds.length === 0) {
      errors.push(
        "KEEPA_BESTSELLER_CATEGORY_IDS is empty — set one or more Amazon browse node IDs (UK examples in README) to pull top sellers."
      );
    } else {
      const allAsins: { asin: string; browseNodeId: string; rank: number }[] =
        [];

      for (const catId of categoryIds) {
        try {
          const asins = await fetchBestsellerAsins(keepaKey, {
            domain,
            categoryId: catId,
            range: Number(process.env.KEEPA_BESTSELLER_RANGE ?? "30") || 30,
          });
          const slice = asins.slice(0, perCategory);
          keepaBestsellerAsinsDiscovered += slice.length;
          slice.forEach((asin, idx) => {
            allAsins.push({ asin, browseNodeId: catId, rank: idx + 1 });
          });
        } catch (e) {
          errors.push(
            `Keepa bestsellers category ${catId}: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }

      const uniqueKeys = new Map<string, { asin: string; browseNodeId: string; rank: number }>();
      for (const x of allAsins) {
        if (!uniqueKeys.has(x.asin)) {
          uniqueKeys.set(x.asin, x);
        }
      }
      const deduped = [...uniqueKeys.values()];
      const asinList = deduped.map((d) => d.asin);

      if (asinList.length > 0) {
        try {
          const products = await fetchKeepaProductsByAsins(asinList, keepaKey, {
            domain,
            statsDays: 30,
          });
          keepaProductsFetched = products.length;
          const now = new Date();
          const rankByAsin = new Map(deduped.map((d) => [d.asin, d]));

          for (const kp of products) {
            const summary = extractListingSummary(kp);
            if (!summary.asin) {
              continue;
            }
            const meta = rankByAsin.get(summary.asin);
            const primaryEan = keepaEansFromProduct(kp)[0] ?? null;

            const amazonGbp = formatGbpFromKeepaMinor(summary.buyBoxMinor);
            const avg30Gbp = formatGbpFromKeepaMinor(summary.avg30BuyBoxMinor);

            const metrics = {
              amazonAsin: summary.asin,
              amazonTitle: summary.title,
              amazonBuyBoxGbp: amazonGbp,
              buyBoxMinor: summary.buyBoxMinor,
              avg30BuyBoxGbp: avg30Gbp,
              avg30BuyBoxMinor: summary.avg30BuyBoxMinor,
              salesRank: summary.salesRank,
              salesRankDrops30: summary.salesRankDrops30,
              keepaStats: summary.statsSnippet,
            };

            await db
              .insert(keepaCatalogItems)
              .values({
                asin: summary.asin,
                domainId: domain,
                browseNodeId: meta?.browseNodeId ?? null,
                bestsellerRank: meta?.rank ?? null,
                title: summary.title,
                primaryEan,
                metrics,
                capturedAt: now,
              })
              .onConflictDoUpdate({
                target: [
                  keepaCatalogItems.asin,
                  keepaCatalogItems.domainId,
                ],
                set: {
                  browseNodeId: sql`excluded.browse_node_id`,
                  bestsellerRank: sql`excluded.bestseller_rank`,
                  title: sql`excluded.title`,
                  primaryEan: sql`excluded.primary_ean`,
                  metrics: sql`excluded.metrics`,
                  capturedAt: sql`excluded.captured_at`,
                  updatedAt: sql`now()`,
                },
              });
            keepaCatalogRowsUpserted += 1;

            const canonicalId = await ensureCanonicalForAmazonListing(
              db,
              domain,
              summary.asin,
              summary.title,
              primaryEan
            );
            await ensureAmazonExternalRef(db, canonicalId, domain, summary.asin, {
              asin: summary.asin,
              title: summary.title,
            });
          }
        } catch (e) {
          errors.push(
            `Keepa product batch: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }

    // —— 3) Match: keepa_catalog_items.primary_ean ↔ qogita_products.ean ——
    const catalog = await db.select().from(keepaCatalogItems);
    const now = new Date();

    for (const item of catalog) {
      if (!item.primaryEan) {
        continue;
      }
      const [qp] = await db
        .select()
        .from(qogitaProducts)
        .where(eq(qogitaProducts.ean, item.primaryEan))
        .limit(1);
      if (!qp) {
        continue;
      }

      await ensureCanonicalForQogitaProductId(db, qp.id);
      const [refreshed] = await db
        .select()
        .from(qogitaProducts)
        .where(eq(qogitaProducts.id, qp.id))
        .limit(1);
      const canonicalId = refreshed?.canonicalProductId ?? null;

      const met = item.metrics as Record<string, unknown>;

      const existing = await db
        .select({ id: productMatches.id })
        .from(productMatches)
        .where(
          and(
            eq(productMatches.channel, "amazon_uk"),
            eq(productMatches.externalId, item.asin)
          )
        )
        .limit(1);

      let matchId: string;
      if (existing[0]) {
        matchId = existing[0].id;
        await db
          .update(productMatches)
          .set({
            qogitaProductId: qp.id,
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
            qogitaProductId: qp.id,
            canonicalProductId: canonicalId,
            channel: "amazon_uk",
            externalId: item.asin,
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
        await ensureAmazonExternalRef(db, canonicalId, domain, item.asin, {
          asin: item.asin,
          title: item.title,
        });
      }

      await db.insert(priceSnapshots).values({
        productMatchId: matchId,
        source: "keepa",
        capturedAt: now,
        metrics: {
          ...met,
          qogita: {
            qogitaId: qp.qogitaId,
            title: qp.title,
            ean: qp.ean,
            buyUnitPrice: qp.buyUnitPrice,
            currency: qp.currency,
            stockUnits: qp.stockUnits,
          },
        },
      });

      matchesLinked += 1;
    }

    await persistSyncRun(
      db,
      runId,
      errors,
      finalizeStats(),
      qogitaRowsUpserted,
      keepaCatalogRowsUpserted
    );

    return {
      offersFetched,
      qogitaRowsUpserted,
      withEan,
      keepaBestsellerAsinsDiscovered,
      keepaProductsFetched,
      keepaCatalogRowsUpserted,
      matchesLinked,
      errors,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Pipeline failed: ${msg}`);
    await persistSyncRun(
      db,
      runId,
      errors,
      finalizeStats(),
      qogitaRowsUpserted,
      keepaCatalogRowsUpserted
    );
    return {
      offersFetched,
      qogitaRowsUpserted,
      withEan,
      keepaBestsellerAsinsDiscovered,
      keepaProductsFetched,
      keepaCatalogRowsUpserted,
      matchesLinked,
      errors,
    };
  }
}
