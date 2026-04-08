import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { productMatchDecisions, userSettings } from "@/db/schema";
import {
  DEFAULT_EUR_TO_GBP,
  buyUnitCostGbp,
  estimateAmazonNetMarginPctFromBuyGbp,
  estimateNetProfitGbpPerUnitFromBuyGbp,
  parseGbpToNumber,
} from "@/lib/margin/estimate";
import {
  SOURCING_OPPORTUNITIES_MAX_LIMIT,
  countJoinableSourcingOpportunities,
  listSourcingOpportunities,
} from "@/lib/sourcing/opportunities";
import { upsertMatchDecisionAction } from "@/app/actions/match-decisions";
import {
  nextSortKeyForColumn,
  type SourcingSortColumn,
} from "@/lib/sourcing/sourcing-table-sort";
import { allowReadyToBuyByReviewGate } from "@/lib/sourcing/match-decision-gating";

import { SourcingTable } from "./sourcing-table";

type SearchParams = {
  q?: string;
  min?: string;
  highOnly?: string;
  maxCapital?: string;
  minLineProfit?: string;
  showRejected?: string;
  minMovMargin?: string;
  highPotential?: string;
  sort?: string;
  limit?: string;
  page?: string;
  pageSize?: string;
  queue?: string;
  reviewedReadyOnly?: string;
  decision?: string;
  reviewStatus?: string;
};

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstQueryValue(
  v: string | string[] | undefined
): string | undefined {
  if (v == null) {
    return undefined;
  }
  if (Array.isArray(v)) {
    return v[0];
  }
  return v;
}

/** Next.js may pass `string[]` for repeated keys — normalize before reading filters. */
function normalizeSourcingSearchParams(raw: RawSearchParams): SearchParams {
  const pick = (key: keyof SearchParams): string | undefined => {
    const v = firstQueryValue(raw[key]);
    return v != null && v.trim() !== "" ? v : undefined;
  };
  return {
    q: pick("q"),
    min: pick("min"),
    highOnly: pick("highOnly"),
    maxCapital: pick("maxCapital"),
    minLineProfit: pick("minLineProfit"),
    showRejected: pick("showRejected"),
    minMovMargin: pick("minMovMargin"),
    highPotential: pick("highPotential"),
    sort: pick("sort"),
    limit: pick("limit"),
    page: pick("page"),
    pageSize: pick("pageSize"),
    queue: pick("queue"),
    reviewedReadyOnly: pick("reviewedReadyOnly"),
    decision: pick("decision"),
    reviewStatus: pick("reviewStatus"),
  };
}

function paramEmpty(v: string | undefined): boolean {
  return v == null || v.trim() === "";
}

/**
 * Buying-mode chips use preset URLs (not merged with prior filters) so e.g. Scale
 * does not keep Sniper’s `highOnly` / `highPotential` flags.
 */
function buildBuyingModeHref(
  sp: SearchParams,
  mode: "sniper" | "scale" | "cashLight"
): string {
  const params = new URLSearchParams();
  if (sp.q != null && sp.q.trim() !== "") {
    params.set("q", sp.q);
  }
  if (sp.limit != null && sp.limit.trim() !== "") {
    params.set("limit", sp.limit);
  }
  if (sp.pageSize != null && sp.pageSize.trim() !== "") {
    params.set("pageSize", sp.pageSize);
  }
  if (sp.showRejected === "1" || sp.showRejected === "true") {
    params.set("showRejected", "1");
  }
  if (sp.decision != null && sp.decision.trim() !== "") {
    params.set("decision", sp.decision);
  }
  if (sp.reviewStatus != null && sp.reviewStatus.trim() !== "") {
    params.set("reviewStatus", sp.reviewStatus);
  }
  if (mode === "sniper") {
    params.set("highPotential", "1");
    params.set("highOnly", "1");
    params.set("sort", "potential_desc");
    params.set("min", "10");
    params.set("minLineProfit", "5");
  } else if (mode === "scale") {
    params.set("minMovMargin", "3");
    params.set("sort", "mov_margin_desc");
    params.set("minLineProfit", "3");
  } else {
    params.set("maxCapital", "35");
    params.set("minLineProfit", "2");
    params.set("sort", "capital_asc");
  }
  return `/dashboard/sourcing?${params.toString()}`;
}

function buildResetFiltersHref(sp: SearchParams): string {
  const params = new URLSearchParams();
  if (sp.q != null && sp.q.trim() !== "") {
    params.set("q", sp.q);
  }
  if (sp.limit != null && sp.limit.trim() !== "") {
    params.set("limit", sp.limit);
  }
  if (sp.pageSize != null && sp.pageSize.trim() !== "") {
    params.set("pageSize", sp.pageSize);
  }
  if (sp.showRejected === "1" || sp.showRejected === "true") {
    params.set("showRejected", "1");
  }
  if (sp.decision != null && sp.decision.trim() !== "") {
    params.set("decision", sp.decision);
  }
  if (sp.reviewStatus != null && sp.reviewStatus.trim() !== "") {
    params.set("reviewStatus", sp.reviewStatus);
  }
  const q = params.toString();
  return q.length > 0 ? `/dashboard/sourcing?${q}` : "/dashboard/sourcing";
}

function activeBuyingMode(
  sp: SearchParams
): "sniper" | "scale" | "cashLight" | null {
  const hp = sp.highPotential === "1" || sp.highPotential === "true";
  const ho = sp.highOnly === "1" || sp.highOnly === "true";
  const min = Number.parseFloat(sp.min ?? "");
  const line = Number.parseFloat(sp.minLineProfit ?? "");
  const mov = Number.parseFloat(sp.minMovMargin ?? "");
  const cap = Number.parseFloat(sp.maxCapital ?? "");

  const sniper =
    hp &&
    ho &&
    sp.sort === "potential_desc" &&
    Number.isFinite(min) &&
    min === 10 &&
    Number.isFinite(line) &&
    line === 5 &&
    paramEmpty(sp.minMovMargin) &&
    paramEmpty(sp.maxCapital);
  if (sniper) {
    return "sniper";
  }

  const scale =
    !hp &&
    !ho &&
    sp.sort === "mov_margin_desc" &&
    Number.isFinite(mov) &&
    mov === 3 &&
    Number.isFinite(line) &&
    line === 3 &&
    paramEmpty(sp.min) &&
    paramEmpty(sp.maxCapital);
  if (scale) {
    return "scale";
  }

  const cashLight =
    !hp &&
    !ho &&
    sp.sort === "capital_asc" &&
    Number.isFinite(cap) &&
    cap === 35 &&
    Number.isFinite(line) &&
    line === 2 &&
    paramEmpty(sp.min) &&
    paramEmpty(sp.minMovMargin);
  if (cashLight) {
    return "cashLight";
  }

  return null;
}

function buyingModeChipClass(
  modeId: "sniper" | "scale" | "cashLight",
  active: boolean
): string {
  const base =
    "rounded-full border px-3 py-1 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  if (!active) {
    return `${base} border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800`;
  }
  switch (modeId) {
    case "sniper":
      return `${base} border-2 border-emerald-600 bg-emerald-50 font-semibold text-emerald-900 dark:border-emerald-500 dark:bg-emerald-900/35 dark:text-emerald-100`;
    case "scale":
      return `${base} border-2 border-sky-600 bg-sky-50 font-semibold text-sky-900 dark:border-sky-500 dark:bg-sky-900/35 dark:text-sky-100`;
    case "cashLight":
      return `${base} border-2 border-amber-600 bg-amber-50 font-semibold text-amber-950 dark:border-amber-500 dark:bg-amber-900/35 dark:text-amber-100`;
    default:
      return `${base} border-zinc-300 text-zinc-700`;
  }
}

function potentialScore(v: "High" | "Medium" | "Low"): number {
  if (v === "High") {
    return 3;
  }
  if (v === "Medium") {
    return 2;
  }
  return 1;
}

function decisionSignal(
  row: {
    matchConfidence: "high" | "medium";
    potential: "High" | "Medium" | "Low";
    estimatedMarginPct: number | null;
    estimatedProfitPerLineGbp: number | null;
  }
): "strong_buy" | "watch" | "avoid" {
  const margin = row.estimatedMarginPct ?? -999;
  const line = row.estimatedProfitPerLineGbp ?? -999;
  if (
    row.matchConfidence === "high" &&
    row.potential === "High" &&
    margin >= 10 &&
    line >= 5
  ) {
    return "strong_buy";
  }
  if (row.matchConfidence === "high" && row.potential !== "Low" && margin >= 5) {
    return "watch";
  }
  return "avoid";
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor((sortedAsc.length - 1) * p))
  );
  return sortedAsc[idx] ?? 0;
}

function velocityPotentialNumeric(
  salesRankDrops30: number | null,
  salesRank: number | null
): { score: number; dropsNorm: number; rankNorm: number } {
  // Keepa proxies:
  // - salesRankDrops30: more drops => faster movement
  // - salesRank (BSR): lower rank => stronger demand
  const drops = Math.max(0, salesRankDrops30 ?? 0);
  const rank = Math.max(1, salesRank ?? 1_000_000);

  // Compress extremes to keep score stable.
  const dropsNorm = Math.min(1, Math.log1p(drops) / Math.log1p(200));
  const rankNorm = Math.max(0, 1 - Math.log10(rank) / 6); // 1 @ rank~1, 0 @ rank~1,000,000

  // Combined demand score (0..1)
  return {
    score: 0.62 * dropsNorm + 0.38 * rankNorm,
    dropsNorm,
    rankNorm,
  };
}

function cleanSearchParams(
  sp: SearchParams
): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = Object.entries(sp) as Array<[keyof SearchParams, string | undefined]>;
  for (const [k, v] of entries) {
    if (v != null && String(v).trim() !== "") {
      out[k] = String(v);
    }
  }
  return out;
}

function avg(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function parseFxEurToGbp(raw: unknown): number {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_EUR_TO_GBP;
  }
  const o = raw as Record<string, unknown>;
  const v = o.EUR ?? o.eur;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return v;
  }
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return DEFAULT_EUR_TO_GBP;
}

function pageHref(
  base: Record<string, string>,
  nextPage: number
): string {
  const params = new URLSearchParams(base);
  params.set("page", String(Math.max(1, nextPage)));
  return `/dashboard/sourcing?${params.toString()}`;
}

function paginationWindow(currentPage: number, totalPages: number): number[] {
  const pages = new Set<number>([1, totalPages, currentPage]);
  for (let i = currentPage - 2; i <= currentPage + 2; i += 1) {
    if (i >= 1 && i <= totalPages) {
      pages.add(i);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

export default async function SourcingPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard/sourcing");
  }

  const sp = normalizeSourcingSearchParams(await searchParams);
  const query = (sp.q ?? "").trim().toLowerCase();
  const minMarginPct = Number.parseFloat(sp.min ?? "0");
  const minM = Number.isFinite(minMarginPct) ? minMarginPct : 0;
  const maxCapitalRaw = Number.parseFloat(sp.maxCapital ?? "");
  const maxCapitalPerSku =
    Number.isFinite(maxCapitalRaw) && maxCapitalRaw > 0 ? maxCapitalRaw : null;
  const minLineProfitRaw = Number.parseFloat(sp.minLineProfit ?? "");
  const minProfitPerLine =
    Number.isFinite(minLineProfitRaw) && minLineProfitRaw > 0
      ? minLineProfitRaw
      : 0;
  const highOnly = sp.highOnly === "1" || sp.highOnly === "true";
  const decisionFilterRaw = (sp.decision ?? "all").toLowerCase();
  const decisionFilter: "all" | "strong_buy" | "watch" | "avoid" =
    decisionFilterRaw === "strong_buy" ||
    decisionFilterRaw === "watch" ||
    decisionFilterRaw === "avoid"
      ? decisionFilterRaw
      : "all";
  const showRejected =
    sp.showRejected === "1" ||
    sp.showRejected === "true";
  const reviewStatusRaw = (sp.reviewStatus ?? "all").toLowerCase();
  const reviewStatus: "all" | "approved" | "rejected" | "unreviewed" =
    reviewStatusRaw === "approved" ||
    reviewStatusRaw === "rejected" ||
    reviewStatusRaw === "unreviewed"
      ? reviewStatusRaw
      : "all";
  const highPotentialOnly =
    sp.highPotential === "1" || sp.highPotential === "true";
  const minMovMarginRaw = Number.parseFloat(sp.minMovMargin ?? "");
  const minMovMarginPct =
    Number.isFinite(minMovMarginRaw) && minMovMarginRaw > 0
      ? minMovMarginRaw
      : 0;
  const sortBy = sp.sort ?? "profit_line_desc";
  const suspiciousOnly = (sp.queue ?? "") === "suspicious";
  const reviewedReadyOnly =
    sp.reviewedReadyOnly === "1" || sp.reviewedReadyOnly === "true";
  const pageRaw = Number.parseInt(sp.page ?? "1", 10);
  const currentPage = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const pageSizeRaw = Number.parseInt(sp.pageSize ?? "30", 10);
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.min(100, Math.max(20, pageSizeRaw))
    : 30;
  const limitRaw = Number.parseInt(sp.limit ?? "2000", 10);
  const rowLimit = Number.isFinite(limitRaw)
    ? Math.min(SOURCING_OPPORTUNITIES_MAX_LIMIT, Math.max(100, limitRaw))
    : 2000;

  const db = getDb();
  const [settings] = await db
    .select({ fxManual: userSettings.fxManual })
    .from(userSettings)
    .where(eq(userSettings.userId, session.user.id))
    .limit(1);

  const eurToGbp = parseFxEurToGbp(settings?.fxManual);

  const [joinableTotal, raw, decisionSummary] = await Promise.all([
    countJoinableSourcingOpportunities(),
    listSourcingOpportunities(rowLimit, {
      showRejected,
      userId: session.user.id,
    }),
    (async () => {
      try {
        const rows = await db
          .select({ decision: productMatchDecisions.decision })
          .from(productMatchDecisions)
          .where(eq(productMatchDecisions.userId, session.user.id));
        let approved = 0;
        let rejected = 0;
        for (const r of rows) {
          if (r.decision === "approve") approved += 1;
          if (r.decision === "reject") rejected += 1;
        }
        return { approved, rejected };
      } catch {
        return { approved: 0, rejected: 0 };
      }
    })(),
  ]);
  const enrichedBase = raw.map((row) => {
    const sell =
      parseGbpToNumber(row.avg30BuyBoxGbp) ??
      parseGbpToNumber(row.amazonBuyBoxGbp);
    const buyGbp = buyUnitCostGbp({
      currency: row.currency,
      buyUnitPrice: row.buyUnitPrice,
      eurToGbp,
    });
    const unitsPerPack = Math.max(1, row.unitsPerPack ?? 1);
    const minOrderValueOverride = parseGbpToNumber(row.minOrderValueOverride);
    let estimatedMarginPct: number | null = null;
    let estimatedProfitGbpPerUnit: number | null = null;
    if (sell != null && buyGbp != null) {
      estimatedMarginPct = estimateAmazonNetMarginPctFromBuyGbp({
        amazonSellGbp: sell,
        buyCostGbp: buyGbp,
      });
      estimatedProfitGbpPerUnit = estimateNetProfitGbpPerUnitFromBuyGbp({
        amazonSellGbp: sell,
        buyCostGbp: buyGbp,
      });
    }
    let capitalRequiredGbp: number | null = null;
    if (buyGbp != null) {
      const baseCapitalRequired = unitsPerPack * buyGbp;
      capitalRequiredGbp =
        minOrderValueOverride != null &&
        minOrderValueOverride > baseCapitalRequired
          ? minOrderValueOverride
          : baseCapitalRequired;
    }
    const estimatedProfitPerLineGbp =
      estimatedProfitGbpPerUnit != null
        ? estimatedProfitGbpPerUnit * unitsPerPack
        : null;
    const movMarginPct =
      row.minOrderValueOverride && estimatedProfitPerLineGbp != null
        ? ((estimatedProfitPerLineGbp / Math.max(0.01, parseGbpToNumber(row.minOrderValueOverride) ?? 0.01)) * 100)
        : null;
    return {
      ...row,
      estimatedMarginPct,
      estimatedProfitGbpPerUnit,
      capitalRequiredGbp,
      estimatedProfitPerLineGbp,
      movMarginPct,
      ...(() => {
        const p = velocityPotentialNumeric(row.salesRankDrops30, row.salesRank);
        return {
          potentialNumeric: p.score,
          potentialDropsNorm: p.dropsNorm,
          potentialRankNorm: p.rankNorm,
        };
      })(),
    };
  });

  const potentialScores = enrichedBase
    .map((r) => r.potentialNumeric)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const highCut = percentile(potentialScores, 0.75);
  const mediumCut = percentile(potentialScores, 0.4);

  const enriched = enrichedBase.map((row) => {
    const drops = Math.max(0, row.salesRankDrops30 ?? 0);
    let potential: "High" | "Medium" | "Low" = "Low";
    // Guard rails to avoid labeling near-zero velocity rows as High.
    if (row.potentialNumeric >= highCut && drops >= 8) {
      potential = "High";
    } else if (row.potentialNumeric >= mediumCut && drops >= 3) {
      potential = "Medium";
    }
    return {
      ...row,
      potential,
      potentialBreakdown: {
        velocityPct: Math.round(row.potentialDropsNorm * 100),
        rankPct: Math.round(row.potentialRankNorm * 100),
        compositePct: Math.round(row.potentialNumeric * 100),
      },
    };
  });

  const filtered = enriched.filter((r) => {
    if (query.length > 0) {
      const hay = [
        r.asin,
        r.amazonTitle ?? "",
        r.qogitaId,
        r.qogitaTitle,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(query)) {
        return false;
      }
    }
    if (highOnly && r.matchConfidence !== "high") {
      return false;
    }
    if (minM > 0) {
      if (r.estimatedMarginPct == null || r.estimatedMarginPct < minM) {
        return false;
      }
    }
    if (
      maxCapitalPerSku != null &&
      (r.capitalRequiredGbp == null || r.capitalRequiredGbp > maxCapitalPerSku)
    ) {
      return false;
    }
    if (minProfitPerLine > 0) {
      if (
        r.estimatedProfitPerLineGbp == null ||
        r.estimatedProfitPerLineGbp < minProfitPerLine
      ) {
        return false;
      }
    }
    if (highPotentialOnly && r.potential !== "High") {
      return false;
    }
    if (minMovMarginPct > 0) {
      if (r.movMarginPct == null || r.movMarginPct < minMovMarginPct) {
        return false;
      }
    }
    if (suspiciousOnly && !r.suspicious) {
      return false;
    }
    if (decisionFilter !== "all" && decisionSignal(r) !== decisionFilter) {
      return false;
    }
    if (reviewStatus === "approved" && r.decision !== "approve") {
      return false;
    }
    if (reviewStatus === "rejected" && r.decision !== "reject") {
      return false;
    }
    if (reviewStatus === "unreviewed" && r.decision != null) {
      return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case "margin_desc": {
        return (b.estimatedMarginPct ?? -1e9) - (a.estimatedMarginPct ?? -1e9);
      }
      case "margin_asc": {
        return (a.estimatedMarginPct ?? -1e9) - (b.estimatedMarginPct ?? -1e9);
      }
      case "mov_margin_desc": {
        return (b.movMarginPct ?? -1e9) - (a.movMarginPct ?? -1e9);
      }
      case "mov_margin_asc": {
        return (a.movMarginPct ?? -1e9) - (b.movMarginPct ?? -1e9);
      }
      case "potential_desc": {
        const pd = potentialScore(b.potential) - potentialScore(a.potential);
        if (pd !== 0) {
          return pd;
        }
        return (b.salesRankDrops30 ?? -1e9) - (a.salesRankDrops30 ?? -1e9);
      }
      case "potential_asc": {
        const pd = potentialScore(a.potential) - potentialScore(b.potential);
        if (pd !== 0) {
          return pd;
        }
        return (a.salesRankDrops30 ?? -1e9) - (b.salesRankDrops30 ?? -1e9);
      }
      case "capital_asc": {
        return (a.capitalRequiredGbp ?? 1e9) - (b.capitalRequiredGbp ?? 1e9);
      }
      case "capital_desc": {
        return (b.capitalRequiredGbp ?? 1e9) - (a.capitalRequiredGbp ?? 1e9);
      }
      case "profit_unit_desc": {
        return (
          (b.estimatedProfitGbpPerUnit ?? -1e9) -
          (a.estimatedProfitGbpPerUnit ?? -1e9)
        );
      }
      case "profit_unit_asc": {
        return (
          (a.estimatedProfitGbpPerUnit ?? -1e9) -
          (b.estimatedProfitGbpPerUnit ?? -1e9)
        );
      }
      case "profit_line_desc": {
        return (
          (b.estimatedProfitPerLineGbp ?? -1e9) -
          (a.estimatedProfitPerLineGbp ?? -1e9)
        );
      }
      case "profit_line_asc": {
        return (
          (a.estimatedProfitPerLineGbp ?? -1e9) -
          (b.estimatedProfitPerLineGbp ?? -1e9)
        );
      }
      default: {
        return (
          (b.estimatedProfitPerLineGbp ?? -1e9) -
          (a.estimatedProfitPerLineGbp ?? -1e9)
        );
      }
    }
  });

  const sortHrefForColumn = (column: SourcingSortColumn) => {
    const next = nextSortKeyForColumn(sortBy, column);
    const params = new URLSearchParams(cleanSearchParams(sp));
    params.set("sort", next);
    params.delete("page");
    return `/dashboard/sourcing?${params.toString()}`;
  };

  const buyingMode = activeBuyingMode(sp);

  const readyNow = sorted.filter(
    (r) =>
      r.matchConfidence === "high" &&
      allowReadyToBuyByReviewGate(r.decision, reviewedReadyOnly) &&
      r.potential === "High" &&
      (r.estimatedMarginPct ?? -1) >= 10 &&
      (r.estimatedProfitPerLineGbp ?? -1) >= 5
  );
  const watchlist = sorted.filter(
    (r) =>
      r.matchConfidence === "high" &&
      r.potential !== "Low" &&
      (r.estimatedMarginPct ?? -1) >= 5 &&
      (r.estimatedProfitPerLineGbp ?? -1) >= 2
  );
  const avgCapital = avg(
    sorted
      .map((r) => r.capitalRequiredGbp)
      .filter((v): v is number => v != null && Number.isFinite(v))
  );
  const avgMargin = avg(
    sorted
      .map((r) => r.estimatedMarginPct)
      .filter((v): v is number => v != null && Number.isFinite(v))
  );
  const best = sorted[0] ?? null;
  const suspiciousQueueSize = enriched.filter((r) => r.suspicious).length;
  const approvedCount = decisionSummary.approved;
  const rejectedCount = decisionSummary.rejected;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);
  const fromRow = sorted.length === 0 ? 0 : pageStart + 1;
  const toRow = pageStart + pageRows.length;
  const baseQueryForPage = cleanSearchParams(sp);
  const pageNumbers = paginationWindow(safePage, totalPages);

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-7xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Reyub
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Sourcing opportunities
          </h1>
          <Link
            href="/dashboard/docs"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Reyub Docs
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Dashboard
          </Link>
        </div>
        <p className="max-w-3xl text-zinc-600 dark:text-zinc-400">
          Amazon listings matched to Qogita wholesale SKUs. Margin and profit use
          your FX settings, a <strong>flat ~15%</strong> Amazon fee assumption,
          and <strong>30d avg buy box</strong> when present (else current buy
          box). Product spec:{" "}
          <code className="text-xs">docs/SOURCING_INSIGHTS_PRD.md</code>.
        </p>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-500">
          New Qogita catalog (Excel): run{" "}
          <code className="text-xs">npm run import:qogita-excel</code>, then{" "}
          <strong>Sync Qogita + Keepa</strong> on the dashboard so matches refresh
          against updated EANs and prices.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Buying modes
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={buildBuyingModeHref(sp, "sniper")}
          className={buyingModeChipClass("sniper", buyingMode === "sniper")}
          aria-current={buyingMode === "sniper" ? "page" : undefined}
        >
          Sniper mode (high confidence + high potential)
        </Link>
        <Link
          href={buildBuyingModeHref(sp, "scale")}
          className={buyingModeChipClass("scale", buyingMode === "scale")}
          aria-current={buyingMode === "scale" ? "page" : undefined}
        >
          Scale mode (MoV-efficient)
        </Link>
        <Link
          href={buildBuyingModeHref(sp, "cashLight")}
          className={buyingModeChipClass("cashLight", buyingMode === "cashLight")}
          aria-current={buyingMode === "cashLight" ? "page" : undefined}
        >
          Cash-light mode (fast test buys)
        </Link>
        <Link
          href={buildResetFiltersHref(sp)}
          className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Reset filters
        </Link>
        </div>
      </section>

      <section>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500">Ready to buy now</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-700 dark:text-emerald-300">
              {readyNow.length}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500">Good watchlist</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {watchlist.length}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500">Avg capital required</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {avgCapital != null ? `£${avgCapital.toFixed(2)}` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500">Avg estimated margin</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {avgMargin != null ? `${avgMargin.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500">Suspicious queue size</p>
            <p className="mt-1 text-2xl font-semibold text-amber-700 dark:text-amber-300">
              {suspiciousQueueSize}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500">Review outcomes</p>
            <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {approvedCount} approved · {rejectedCount} rejected
            </p>
          </div>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Showing {fromRow.toLocaleString()}-{toRow.toLocaleString()} of{" "}
          {sorted.length.toLocaleString()} filtered opportunities, from{" "}
          {raw.length.toLocaleString()} loaded (max{" "}
          {rowLimit} per request).{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {joinableTotal.toLocaleString()} joinable matches
          </span>{" "}
          in the database (Amazon UK Keepa row + Qogita link). Increase{" "}
          <strong>Rows</strong> up to {SOURCING_OPPORTUNITIES_MAX_LIMIT.toLocaleString()}{" "}
          to load more.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Profit per line = estimated profit/unit × units per pack. MoV margin uses
          profit per line against configured min order value (when available).
        </p>
        {best ? (
          <p className="mt-1 text-xs text-zinc-500">
            Current best candidate: <span className="font-mono">{best.asin}</span>{" "}
            • {best.potential} potential •{" "}
            {best.estimatedProfitPerLineGbp != null
              ? `£${best.estimatedProfitPerLineGbp.toFixed(2)} / line`
              : "profit n/a"}
          </p>
        ) : null}
        <section className="sticky top-2 z-20 mb-3 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <form className="flex flex-wrap items-center gap-2" method="get">
            <input type="hidden" name="page" value="1" />
            <label className="text-zinc-600 dark:text-zinc-400">
              Search
              <input
                type="text"
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="ASIN, Amazon title, Qogita title or ID"
                className="ml-2 w-64 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
              />
            </label>
            <label className="text-zinc-600 dark:text-zinc-400">
              Min margin %
              <input
                type="number"
                name="min"
                step="0.5"
                min="0"
                defaultValue={minM > 0 ? String(minM) : ""}
                placeholder="0"
                className="ml-2 w-20 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
              />
            </label>
            <label className="text-zinc-600 dark:text-zinc-400">
              Max capital (£)
              <input
                type="number"
                name="maxCapital"
                step="0.01"
                min="0"
                defaultValue={maxCapitalPerSku != null ? String(maxCapitalPerSku) : ""}
                placeholder="No cap"
                className="ml-2 w-24 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
              />
            </label>
            <label className="text-zinc-600 dark:text-zinc-400">
              Min line £
              <input
                type="number"
                name="minLineProfit"
                step="0.01"
                min="0"
                defaultValue={minProfitPerLine > 0 ? String(minProfitPerLine) : ""}
                placeholder="0"
                className="ml-2 w-20 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
              />
            </label>
            <label className="text-zinc-600 dark:text-zinc-400">
              Min MoV %
              <input
                type="number"
                name="minMovMargin"
                step="0.1"
                min="0"
                defaultValue={minMovMarginPct > 0 ? String(minMovMarginPct) : ""}
                placeholder="0"
                className="ml-2 w-20 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
              />
            </label>
            <label className="text-zinc-600 dark:text-zinc-400">
              Decision signal
              <select
                name="decision"
                defaultValue={decisionFilter}
                className="ml-2 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
              >
                <option value="all">All</option>
                <option value="strong_buy">Strong buy signal</option>
                <option value="watch">Watch</option>
                <option value="avoid">Avoid</option>
              </select>
            </label>
            <label className="text-zinc-600 dark:text-zinc-400">
              Review status
              <select
                name="reviewStatus"
                defaultValue={reviewStatus}
                className="ml-2 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
              >
                <option value="all">All</option>
                <option value="approved">Approved only</option>
                <option value="rejected">Rejected only</option>
                <option value="unreviewed">Unreviewed only</option>
              </select>
            </label>
            <label className="text-zinc-600 dark:text-zinc-400">
              Sort
              <select
                name="sort"
                defaultValue={sortBy}
                className="ml-2 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
              >
                <option value="profit_line_desc">Profit/line ↓</option>
                <option value="profit_line_asc">Profit/line ↑</option>
                <option value="profit_unit_desc">Profit/unit ↓</option>
                <option value="profit_unit_asc">Profit/unit ↑</option>
                <option value="margin_desc">Margin ↓</option>
                <option value="margin_asc">Margin ↑</option>
                <option value="mov_margin_desc">MoV margin ↓</option>
                <option value="mov_margin_asc">MoV margin ↑</option>
                <option value="potential_desc">Potential ↓</option>
                <option value="potential_asc">Potential ↑</option>
                <option value="capital_asc">Capital ↑</option>
                <option value="capital_desc">Capital ↓</option>
              </select>
            </label>
            <label className="text-zinc-600 dark:text-zinc-400">
              Page size
              <select
                name="pageSize"
                defaultValue={String(pageSize)}
                className="ml-2 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
              >
                <option value="20">20</option>
                <option value="30">30</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>
            <label className="text-zinc-600 dark:text-zinc-400">
              Rows
              <input
                type="number"
                name="limit"
                step="100"
                min="100"
                max={String(SOURCING_OPPORTUNITIES_MAX_LIMIT)}
                defaultValue={String(rowLimit)}
                className="ml-2 w-20 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
              />
            </label>
            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" name="highOnly" value="1" defaultChecked={highOnly} />
              GTIN only
            </label>
            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                name="highPotential"
                value="1"
                defaultChecked={highPotentialOnly}
              />
              High potential
            </label>
            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                name="showRejected"
                value="1"
                defaultChecked={showRejected}
              />
              Show rejected
            </label>
            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                name="queue"
                value="suspicious"
                defaultChecked={suspiciousOnly}
              />
              Suspicious queue only
            </label>
            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                name="reviewedReadyOnly"
                value="1"
                defaultChecked={reviewedReadyOnly}
              />
              Ready-to-buy requires approved review
            </label>
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Apply filters
            </button>
          </form>
        </section>
        <SourcingTable
          rows={pageRows}
          upsertMatchDecisionAction={upsertMatchDecisionAction}
          sortBy={sortBy}
          sortHrefForColumn={sortHrefForColumn}
        />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-zinc-600 dark:text-zinc-400">
            Page {safePage} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            {safePage > 1 ? (
              <Link
                href={pageHref(baseQueryForPage, 1)}
                className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                First
              </Link>
            ) : null}
            {safePage > 1 ? (
              <Link
                href={pageHref(baseQueryForPage, safePage - 1)}
                className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Previous
              </Link>
            ) : null}
            {pageNumbers.map((p) => (
              <Link
                key={p}
                href={pageHref(baseQueryForPage, p)}
                className={
                  p === safePage
                    ? "rounded border border-zinc-900 bg-zinc-900 px-2 py-1 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                }
              >
                {p}
              </Link>
            ))}
            {safePage < totalPages ? (
              <Link
                href={pageHref(baseQueryForPage, safePage + 1)}
                className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Next
              </Link>
            ) : null}
            {safePage < totalPages ? (
              <Link
                href={pageHref(baseQueryForPage, totalPages)}
                className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Last
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
