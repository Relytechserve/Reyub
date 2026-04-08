import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  keepaCatalogItems,
  productMatchDecisions,
  productMatches,
  qogitaProducts,
} from "@/db/schema";
import { KEEPA_DOMAIN_UK } from "@/lib/keepa/product";
import { shouldHideRejectedByDefault } from "@/lib/sourcing/match-decision-gating";
import { buildQogitaProductUrl } from "@/lib/sourcing/qogita-link";
import {
  isSuspiciousMatch,
  scoreBreakdownLabel,
} from "@/lib/sourcing/review-queue";

/** Max rows the sourcing page may load in one request (UI + query cap). */
export const SOURCING_OPPORTUNITIES_MAX_LIMIT = 5000;

export type SourcingOpportunityRow = {
  productMatchId: string;
  matchConfidence: "high" | "medium";
  matchReasonTags: string[];
  matchScore: string | null;
  asin: string;
  amazonTitle: string | null;
  amazonBuyBoxGbp: string | null;
  avg30BuyBoxGbp: string | null;
  salesRank: number | null;
  salesRankDrops30: number | null;
  keepaCapturedAt: Date;
  qogitaId: string;
  qogitaTitle: string;
  qogitaProductUrl: string | null;
  qogitaEan: string | null;
  buyUnitPrice: string | null;
  currency: string;
  stockUnits: number | null;
  unitsPerPack: number | null;
  minOrderValueOverride: string | null;
  /** Excel catalog: GBP list price includes shipping — margin is not ex-shipping landed cost. */
  priceIncShipping: boolean;
  decision: "approve" | "reject" | null;
  decisionNotes: string | null;
  suspicious: boolean;
  scoreBreakdown: string;
};

/**
 * Rows that can render on the sourcing table: same inner joins as
 * {@link listSourcingOpportunities} (excludes orphaned matches with no UK Keepa row).
 */
export async function countJoinableSourcingOpportunities(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(productMatches)
    .innerJoin(
      keepaCatalogItems,
      and(
        eq(keepaCatalogItems.asin, productMatches.externalId),
        eq(keepaCatalogItems.domainId, KEEPA_DOMAIN_UK)
      )
    )
    .innerJoin(
      qogitaProducts,
      eq(qogitaProducts.id, productMatches.qogitaProductId)
    )
    .where(
      and(
        eq(productMatches.channel, "amazon_uk"),
        isNotNull(productMatches.qogitaProductId)
      )
    );
  return row?.c ?? 0;
}

/**
 * Sourcing portal: persisted Amazon ↔ Qogita links with Keepa demand metrics.
 */
export async function listSourcingOpportunities(
  limit = 200,
  options: { showRejected?: boolean; userId: string }
): Promise<SourcingOpportunityRow[]> {
  const db = getDb();
  const showRejected = options?.showRejected === true;
  const userId = options.userId;
  const baseSelect = {
    pm: {
      id: productMatches.id,
      confidence: productMatches.confidence,
      reasonTags: productMatches.reasonTags,
      matchScore: productMatches.matchScore,
    },
    k: {
      asin: keepaCatalogItems.asin,
      title: keepaCatalogItems.title,
      metrics: keepaCatalogItems.metrics,
      capturedAt: keepaCatalogItems.capturedAt,
    },
    q: {
      qogitaId: qogitaProducts.qogitaId,
      ean: qogitaProducts.ean,
      title: qogitaProducts.title,
      buyUnitPrice: qogitaProducts.buyUnitPrice,
      currency: qogitaProducts.currency,
      stockUnits: qogitaProducts.stockUnits,
      unitsPerPack: qogitaProducts.unitsPerPack,
      minOrderValueOverride: qogitaProducts.minOrderValueOverride,
      flags: qogitaProducts.flags,
    },
  };
  let rows: Array<{
    pm: {
      id: string;
      confidence: "high" | "medium";
      reasonTags: string[];
      matchScore: string | null;
    };
    k: {
      asin: string;
      title: string;
      metrics: unknown;
      capturedAt: Date;
    };
    q: {
      qogitaId: string;
      ean: string | null;
      title: string;
      buyUnitPrice: string | null;
      currency: string;
      stockUnits: number | null;
      unitsPerPack: number | null;
      minOrderValueOverride: string | null;
      flags: unknown;
    };
    d: { decision: "approve" | "reject"; notes: string | null } | null;
  }> = [];

  try {
    const primaryRows = await db
      .select({
        ...baseSelect,
        d: productMatchDecisions,
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
      .leftJoin(
        productMatchDecisions,
        and(
          eq(productMatchDecisions.productMatchId, productMatches.id),
          eq(productMatchDecisions.userId, userId)
        )
      )
      .where(
        and(
          eq(productMatches.channel, "amazon_uk"),
          isNotNull(productMatches.qogitaProductId)
        )
      )
      .orderBy(desc(keepaCatalogItems.capturedAt))
      .limit(
        Math.min(SOURCING_OPPORTUNITIES_MAX_LIMIT, Math.max(1, limit))
      );
    rows = primaryRows;
  } catch (e) {
    // Temporary compatibility fallback when DB migration for product_match_decisions is missing.
    const msg = e instanceof Error ? e.message : String(e);
    const missingDecisionSchema =
      msg.includes("product_match_decisions") || msg.includes("user_id");
    if (!missingDecisionSchema) {
      throw e;
    }
    const fallbackRows = await db
      .select({
        ...baseSelect,
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
      .limit(
        Math.min(SOURCING_OPPORTUNITIES_MAX_LIMIT, Math.max(1, limit))
      );
    rows = fallbackRows.map((r) => ({ ...r, d: null }));
  }

  return rows
    .filter(({ d }) => !shouldHideRejectedByDefault(d?.decision ?? null, showRejected))
    .map(({ pm, k, q, d }) => {
      const met = k.metrics as Record<string, unknown>;
      const tags = pm.reasonTags;
      const matchReasonTags = Array.isArray(tags)
        ? tags.filter((t): t is string => typeof t === "string")
        : [];
      const qFlags = q.flags as Record<string, unknown> | null | undefined;
      const priceIncShipping = qFlags?.priceIncShipping === true;
      const qogitaProductUrl = buildQogitaProductUrl({
        qogitaId: q.qogitaId,
        ean: q.ean,
        flags: qFlags,
      });
      return {
        productMatchId: pm.id,
        matchConfidence: pm.confidence,
        matchReasonTags,
        matchScore: pm.matchScore ?? null,
        asin: k.asin,
        amazonTitle:
          typeof met.amazonTitle === "string" ? met.amazonTitle : k.title,
        amazonBuyBoxGbp:
          typeof met.amazonBuyBoxGbp === "string" ? met.amazonBuyBoxGbp : null,
        avg30BuyBoxGbp:
          typeof met.avg30BuyBoxGbp === "string" ? met.avg30BuyBoxGbp : null,
        salesRank: typeof met.salesRank === "number" ? met.salesRank : null,
        salesRankDrops30:
          typeof met.salesRankDrops30 === "number"
            ? met.salesRankDrops30
            : null,
        keepaCapturedAt: k.capturedAt,
        qogitaId: q.qogitaId,
        qogitaTitle: q.title,
        qogitaProductUrl,
        qogitaEan: q.ean,
        buyUnitPrice: q.buyUnitPrice,
        currency: q.currency,
        stockUnits: q.stockUnits,
        unitsPerPack: q.unitsPerPack,
        minOrderValueOverride: q.minOrderValueOverride,
        priceIncShipping,
        decision: d?.decision ?? null,
        decisionNotes: d?.notes ?? null,
        suspicious: isSuspiciousMatch({
          confidence: pm.confidence,
          matchScore: pm.matchScore == null ? null : Number(pm.matchScore),
          reasonTags: matchReasonTags,
        }),
        scoreBreakdown: scoreBreakdownLabel({
          confidence: pm.confidence,
          matchScore: pm.matchScore == null ? null : Number(pm.matchScore),
          reasonTags: matchReasonTags,
        }),
      };
    });
}
