/**
 * Amazon (Keepa catalog) ↔ Qogita matching — Stage A (GTIN ladder) + Stage B (title fuzzy).
 * @see docs/SOURCING_INSIGHTS_PRD.md
 */

import { and, eq, isNotNull } from "drizzle-orm";

import type { getDb } from "@/db";
import {
  keepaCatalogItems,
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
import { collectGtinKeysFromBarcode } from "@/lib/matching/gtin";
import {
  buildTokenIndex,
  pickBestFuzzyQogitaMatch,
  prepareQogitaRow,
  type FuzzyMatchConfig,
} from "@/lib/matching/title-similarity";
import { evaluateMatchCandidate } from "@/lib/matching/match-scoring";
import { ImageSimilarityService } from "@/lib/matching/image-similarity";

type Db = ReturnType<typeof getDb>;

async function getExistingMatch(
  db: Db,
  channel: string,
  externalId: string
): Promise<{
  matchId: string | null;
}> {
  const rows = await db
    .select({
      matchId: productMatches.id,
    })
    .from(productMatches)
    .where(
      and(eq(productMatches.channel, channel), eq(productMatches.externalId, externalId))
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { matchId: null };
  }
  return { matchId: row.matchId };
}

function envFuzzyEnabled(): boolean {
  const v = process.env.MATCH_FUZZY_TITLES?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") {
    return false;
  }
  return true;
}

function fuzzyConfigFromEnv(): FuzzyMatchConfig {
  const minJ = Number(process.env.MATCH_FUZZY_MIN_JACCARD ?? "");
  const minG = Number(process.env.MATCH_FUZZY_MIN_MARGIN ?? "");
  return {
    minJaccard: Number.isFinite(minJ) && minJ > 0 && minJ < 1 ? minJ : 0.38,
    minTop2Gap: Number.isFinite(minG) && minG > 0 && minG < 0.5 ? minG : 0.08,
    minTokenLen: 4,
  };
}

function parseBuyPrice(raw: string | null | undefined): number {
  if (!raw) {
    return Number.POSITIVE_INFINITY;
  }
  const n = Number.parseFloat(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/** Synthetic `qogita_id` for Excel catalog imports — see docs/QOGITA_EXCEL_CATALOG_MAPPING.md */
export const EXCEL_CATALOG_QOGITA_ID_PREFIX = "excel-gtin-";

function isExcelCatalogRow(qogitaId: string): boolean {
  return qogitaId.startsWith(EXCEL_CATALOG_QOGITA_ID_PREFIX);
}

type GtinTierBest = {
  api: { id: string; price: number } | null;
  excel: { id: string; price: number } | null;
};

function pickBetter(
  cur: { id: string; price: number } | null,
  id: string,
  price: number
): { id: string; price: number } {
  if (!cur || price < cur.price) {
    return { id, price };
  }
  return cur;
}

/**
 * Map normalized GTIN lookup key → `qogita_products.id` (UUID).
 * Precedence: **live API row** (any `qogita_id` not from Excel import) wins over
 * **Excel catalog** row (`excel-gtin-{ean}`) for the same key; within each tier,
 * lowest parsed `buyUnitPrice` wins (missing price → ∞).
 */
export function buildGtinToQogitaIdMap(
  rows: {
    id: string;
    qogitaId: string;
    ean: string | null;
    buyUnitPrice: string | null;
    primaryImageUrl?: string | null;
  }[]
): Map<string, string> {
  const byKey = new Map<string, GtinTierBest>();
  for (const r of rows) {
    if (!r.ean) {
      continue;
    }
    const keys = collectGtinKeysFromBarcode(r.ean);
    const price = parseBuyPrice(r.buyUnitPrice);
    const tier: "api" | "excel" = isExcelCatalogRow(r.qogitaId)
      ? "excel"
      : "api";
    for (const k of keys) {
      const slot = byKey.get(k) ?? { api: null, excel: null };
      if (tier === "api") {
        slot.api = pickBetter(slot.api, r.id, price);
      } else {
        slot.excel = pickBetter(slot.excel, r.id, price);
      }
      byKey.set(k, slot);
    }
  }
  const out = new Map<string, string>();
  for (const [k, v] of byKey) {
    const chosen = v.api ?? v.excel;
    if (chosen) {
      out.set(k, chosen.id);
    }
  }
  return out;
}

function eanCandidatesFromKeepaRow(item: {
  primaryEan: string | null;
  metrics: unknown;
}): string[] {
  const met = item.metrics as Record<string, unknown>;
  const raw = met.eanCandidates;
  const fromMetrics =
    Array.isArray(raw) &&
    raw.every((x) => typeof x === "string" || typeof x === "number")
      ? raw.map((x) => String(x))
      : [];
  const set = new Set<string>();
  for (const x of fromMetrics) {
    const d = x.replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 14) {
      set.add(d);
    }
  }
  if (item.primaryEan) {
    const d = item.primaryEan.replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 14) {
      set.add(d);
    }
  }
  return [...set];
}

function findQogitaIdByGtinKeys(
  keys: Iterable<string>,
  index: Map<string, string>
): { qogitaId: string; matchedKey: string; variant: boolean } | null {
  for (const raw of keys) {
    const expanded = collectGtinKeysFromBarcode(raw);
    for (const k of expanded) {
      const id = index.get(k);
      if (id) {
        const variant = raw.replace(/\D/g, "") !== k;
        return { qogitaId: id, matchedKey: k, variant };
      }
    }
  }
  return null;
}

function tagsForGtinMatch(variant: boolean, multiNote: boolean): string[] {
  const t = [variant ? "gtin_variant" : "ean_exact"];
  if (multiNote) {
    t.push("ean_multi_supplier_pick");
  }
  return t;
}

export type AmazonQogitaMatchResult = {
  eanMatches: number;
  fuzzyMatches: number;
  imageCoveragePct: number;
  imageCompared: number;
  imageInfluenced: number;
};

export async function runAmazonQogitaMatching(
  db: Db,
  options: { now: Date; domain?: number; errors: string[] }
): Promise<AmazonQogitaMatchResult> {
  const domain = options.domain ?? KEEPA_DOMAIN_UK;
  const now = options.now;
  let eanMatches = 0;
  let fuzzyMatches = 0;
  const imageSimilarity = new ImageSimilarityService(db);
  let imageCoverageTotal = 0;
  let imageComparedTotal = 0;
  let imageInfluencedConfidence = 0;
  const imageDist = { lt20: 0, from20to50: 0, from50to80: 0, gte80: 0 };

  const qogitaRows = await db
    .select({
      id: qogitaProducts.id,
      qogitaId: qogitaProducts.qogitaId,
      ean: qogitaProducts.ean,
      buyUnitPrice: qogitaProducts.buyUnitPrice,
      primaryImageUrl: qogitaProducts.primaryImageUrl,
      title: qogitaProducts.title,
      brand: qogitaProducts.brand,
      unitsPerPack: qogitaProducts.unitsPerPack,
      packDescription: qogitaProducts.packDescription,
      currency: qogitaProducts.currency,
      stockUnits: qogitaProducts.stockUnits,
    })
    .from(qogitaProducts);

  const gtinIndex = buildGtinToQogitaIdMap(qogitaRows);

  const catalog = await db.select().from(keepaCatalogItems);

  const qogitaById = new Map(qogitaRows.map((row) => [row.id, row]));

  const addImageDistribution = (score: number) => {
    if (score < 0.2) {
      imageDist.lt20 += 1;
    } else if (score < 0.5) {
      imageDist.from20to50 += 1;
    } else if (score < 0.8) {
      imageDist.from50to80 += 1;
    } else {
      imageDist.gte80 += 1;
    }
  };

  const pickTieBrokenGtinHit = async (
    keepaEanCandidates: string[],
    keepaImageUrl: string | null
  ): Promise<{ qogitaId: string; variant: boolean } | null> => {
    const hit = findQogitaIdByGtinKeys(keepaEanCandidates, gtinIndex);
    if (!hit) {
      return null;
    }
    if (!keepaImageUrl) {
      return { qogitaId: hit.qogitaId, variant: hit.variant };
    }
    const candidateIds = new Set<string>();
    for (const raw of keepaEanCandidates) {
      const keys = collectGtinKeysFromBarcode(raw);
      for (const key of keys) {
        for (const row of qogitaRows) {
          if (row.ean && collectGtinKeysFromBarcode(row.ean).includes(key)) {
            candidateIds.add(row.id);
          }
        }
      }
    }
    if (candidateIds.size <= 1) {
      return { qogitaId: hit.qogitaId, variant: hit.variant };
    }
    const top = [...candidateIds]
      .map((id) => qogitaById.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => parseBuyPrice(a.buyUnitPrice) - parseBuyPrice(b.buyUnitPrice))
      .slice(0, 2);
    if (top.length < 2) {
      return { qogitaId: hit.qogitaId, variant: hit.variant };
    }
    const aScore = await imageSimilarity.compare(keepaImageUrl, top[0].primaryImageUrl);
    const bScore = await imageSimilarity.compare(keepaImageUrl, top[1].primaryImageUrl);
    if (aScore.score != null) {
      imageComparedTotal += 1;
      addImageDistribution(aScore.score);
    }
    if (bScore.score != null) {
      imageComparedTotal += 1;
      addImageDistribution(bScore.score);
    }
    if (aScore.score != null && bScore.score != null) {
      return {
        qogitaId: aScore.score >= bScore.score ? top[0].id : top[1].id,
        variant: hit.variant,
      };
    }
    return { qogitaId: hit.qogitaId, variant: hit.variant };
  };

  async function upsertScoredMatch(
    item: (typeof catalog)[0],
    qpId: string,
    candidateTags: string[],
    confidence: "high" | "medium",
    weightedScore: number
  ): Promise<void> {
    await ensureCanonicalForQogitaProductId(db, qpId);
    const [refreshed] = await db.select().from(qogitaProducts).where(eq(qogitaProducts.id, qpId)).limit(1);
    const canonicalId = refreshed?.canonicalProductId ?? null;
    const qp = refreshed ?? qogitaById.get(qpId);
    if (!qp) {
      return;
    }

    const met = item.metrics as Record<string, unknown>;

    // Global sync policy: per-user decisions do not block match refreshes.
    const existing = await getExistingMatch(db, "amazon_uk", item.asin);

    let matchId: string;
    if (existing.matchId) {
      matchId = existing.matchId;
      await db
        .update(productMatches)
        .set({
          qogitaProductId: qp.id,
          canonicalProductId: canonicalId,
          confidence,
          reasonTags: candidateTags,
          matchScore: weightedScore.toFixed(4),
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
          confidence,
          reasonTags: candidateTags,
          matchScore: weightedScore.toFixed(4),
        })
        .returning({ id: productMatches.id });
      const ins = inserted[0];
      if (!ins) {
        return;
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
          brand: qp.brand,
          unitsPerPack: qp.unitsPerPack,
          packDescription: qp.packDescription,
        },
        matchProvenance: candidateTags,
      },
    });
  }

  // —— Stage A: GTIN / EAN ladder ——
  for (const item of catalog) {
    const candidates = eanCandidatesFromKeepaRow(item);
    if (candidates.length === 0) {
      continue;
    }
    if (item.primaryImageUrl) {
      imageCoverageTotal += 1;
    }
    const hit = await pickTieBrokenGtinHit(candidates, item.primaryImageUrl);
    if (!hit) {
      continue;
    }
    const multiNote = false;
    const tags = tagsForGtinMatch(hit.variant, multiNote);
    try {
      const qp = qogitaById.get(hit.qogitaId);
      if (!qp) {
        continue;
      }
      const imageResult = await imageSimilarity.compare(
        item.primaryImageUrl,
        qp.primaryImageUrl
      );
      const imageSignal = imageResult.score;
      if (imageSignal != null) {
        imageComparedTotal += 1;
        addImageDistribution(imageSignal);
      }
      const score = evaluateMatchCandidate({
        amazonTitle: item.title,
        qogitaTitle: qp.title,
        qogitaBrand: qp.brand,
        eanMatch: true,
        fromEanStage: true,
        qogitaUnitsPerPack: qp.unitsPerPack,
        qogitaPackDescription: qp.packDescription,
        imageSignal,
      });
      const reasonTags = [...tags, ...score.reasonTags];
      if (score.decision === "reject_candidate") {
        continue;
      }
      const confidence: "high" | "medium" =
        score.decision === "high" ? "high" : "medium";
      await upsertScoredMatch(
        item,
        hit.qogitaId,
        reasonTags,
        confidence,
        score.weightedScore
      );
      if (score.reasonTags.includes("conflict_image")) {
        imageInfluencedConfidence += 1;
      }
      eanMatches += 1;
    } catch (e) {
      options.errors.push(
        `EAN match ${item.asin}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // —— Stage B: Title fuzzy (unmatched ASINs only) ——
  if (!envFuzzyEnabled() || qogitaRows.length === 0) {
    return {
      eanMatches,
      fuzzyMatches,
      imageCoveragePct: 0,
      imageCompared: imageComparedTotal,
      imageInfluenced: imageInfluencedConfidence,
    };
  }

  const matchedAsins = new Set(
    (
      await db
        .select({ ext: productMatches.externalId })
        .from(productMatches)
        .where(
          and(
            eq(productMatches.channel, "amazon_uk"),
            isNotNull(productMatches.qogitaProductId)
          )
        )
    ).map((r) => r.ext)
  );

  const prepared = qogitaRows.map((r) =>
    prepareQogitaRow({
      id: r.id,
      title: r.title,
      brand: r.brand,
    })
  );
  const tokenIndex = buildTokenIndex(prepared, 4);
  const fuzzyCfg = fuzzyConfigFromEnv();

  for (const item of catalog) {
    if (matchedAsins.has(item.asin)) {
      continue;
    }
    const amazonTitle =
      (() => {
        const m = item.metrics as Record<string, unknown>;
        return typeof m.amazonTitle === "string" ? m.amazonTitle : item.title;
      })() ?? item.title;

    const best = pickBestFuzzyQogitaMatch(
      amazonTitle,
      prepared,
      tokenIndex,
      fuzzyCfg
    );
    if (!best) {
      continue;
    }

    try {
      await ensureCanonicalForQogitaProductId(db, best.id);
      const [refreshed] = await db
        .select()
        .from(qogitaProducts)
        .where(eq(qogitaProducts.id, best.id))
        .limit(1);
      const qp = refreshed;
      if (!qp) {
        continue;
      }
      const canonicalId = qp.canonicalProductId ?? null;
      const met = item.metrics as Record<string, unknown>;
      if (item.primaryImageUrl) {
        imageCoverageTotal += 1;
      }
      const imageResult = await imageSimilarity.compare(
        item.primaryImageUrl,
        qp.primaryImageUrl
      );
      const imageSignal = imageResult.score;
      if (imageSignal != null) {
        imageComparedTotal += 1;
        addImageDistribution(imageSignal);
      }
      const score = evaluateMatchCandidate({
        amazonTitle,
        qogitaTitle: qp.title,
        qogitaBrand: qp.brand,
        eanMatch: false,
        fromEanStage: false,
        qogitaUnitsPerPack: qp.unitsPerPack,
        qogitaPackDescription: qp.packDescription,
        imageSignal,
      });
      const reasonTags = [
        "title_token_jaccard",
        `jaccard:${best.score.toFixed(3)}`,
        ...score.reasonTags,
      ];
      if (score.decision === "reject_candidate") {
        continue;
      }
      const confidence: "high" | "medium" =
        score.decision === "high" ? "high" : "medium";
      if (score.reasonTags.includes("conflict_image")) {
        imageInfluencedConfidence += 1;
      }

      const existingFuzzy = await getExistingMatch(
        db,
        "amazon_uk",
        item.asin
      );

      let matchId: string;
      if (existingFuzzy.matchId) {
        matchId = existingFuzzy.matchId;
        await db
          .update(productMatches)
          .set({
            qogitaProductId: qp.id,
            canonicalProductId: canonicalId,
            confidence,
            reasonTags,
            matchScore: score.weightedScore.toFixed(4),
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
            confidence,
            reasonTags,
            matchScore: score.weightedScore.toFixed(4),
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
          matchProvenance: reasonTags,
        },
      });

      matchedAsins.add(item.asin);
      fuzzyMatches += 1;
    } catch (e) {
      options.errors.push(
        `Fuzzy match ${item.asin}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const imageCoveragePct = catalog.length > 0 ? (imageCoverageTotal / catalog.length) * 100 : 0;
  console.info(
    `[matching:image] coverage_pct=${imageCoveragePct.toFixed(1)} compared=${imageComparedTotal} influenced=${imageInfluencedConfidence} dist_lt20=${imageDist.lt20} dist_20_50=${imageDist.from20to50} dist_50_80=${imageDist.from50to80} dist_gte80=${imageDist.gte80}`
  );
  return {
    eanMatches,
    fuzzyMatches,
    imageCoveragePct,
    imageCompared: imageComparedTotal,
    imageInfluenced: imageInfluencedConfidence,
  };
}
