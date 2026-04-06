import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { userSettings } from "@/db/schema";
import {
  DEFAULT_EUR_TO_GBP,
  buyUnitCostGbp,
  estimateAmazonNetMarginPctFromBuyGbp,
  estimateNetProfitGbpPerUnitFromBuyGbp,
  parseGbpToNumber,
} from "@/lib/margin/estimate";
import { listSourcingOpportunities } from "@/lib/sourcing/opportunities";
import { upsertMatchDecisionAction } from "@/app/actions/match-decisions";

import { SourcingTable } from "./sourcing-table";

type SearchParams = {
  min?: string;
  highOnly?: string;
  maxCapital?: string;
  minLineProfit?: string;
  showRejected?: string;
  minMovMargin?: string;
  highPotential?: string;
  sort?: string;
};

function salesPotential(
  salesRankDrops30: number | null,
  salesRank: number | null
): "High" | "Medium" | "Low" {
  const drops = salesRankDrops30 ?? 0;
  const rank = salesRank ?? 9_999_999;
  if (drops >= 80 && rank <= 30_000) {
    return "High";
  }
  if (drops >= 30 && rank <= 100_000) {
    return "Medium";
  }
  return "Low";
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

function buildQuickHref(
  base: SearchParams,
  patch: Partial<SearchParams>
): string {
  const params = new URLSearchParams();
  const merged: SearchParams = { ...base, ...patch };
  const entries = Object.entries(merged) as Array<[keyof SearchParams, string | undefined]>;
  for (const [k, v] of entries) {
    if (v != null && String(v).trim() !== "") {
      params.set(k, String(v));
    }
  }
  const q = params.toString();
  return q.length > 0 ? `/dashboard/sourcing?${q}` : "/dashboard/sourcing";
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

export default async function SourcingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard/sourcing");
  }

  const sp = await searchParams;
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
  const showRejected = sp.showRejected === "1" || sp.showRejected === "true";
  const highPotentialOnly =
    sp.highPotential === "1" || sp.highPotential === "true";
  const minMovMarginRaw = Number.parseFloat(sp.minMovMargin ?? "");
  const minMovMarginPct =
    Number.isFinite(minMovMarginRaw) && minMovMarginRaw > 0
      ? minMovMarginRaw
      : 0;
  const sortBy = sp.sort ?? "profit_line_desc";

  const db = getDb();
  const [settings] = await db
    .select({ fxManual: userSettings.fxManual })
    .from(userSettings)
    .where(eq(userSettings.userId, session.user.id))
    .limit(1);

  const eurToGbp = parseFxEurToGbp(settings?.fxManual);

  const raw = await listSourcingOpportunities(250, {
    showRejected,
    userId: session.user.id,
  });
  const enriched = raw.map((row) => {
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
    const potential = salesPotential(row.salesRankDrops30, row.salesRank);
    return {
      ...row,
      estimatedMarginPct,
      estimatedProfitGbpPerUnit,
      capitalRequiredGbp,
      estimatedProfitPerLineGbp,
      movMarginPct,
      potential,
    };
  });

  const filtered = enriched.filter((r) => {
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
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case "margin_desc": {
        return (b.estimatedMarginPct ?? -1e9) - (a.estimatedMarginPct ?? -1e9);
      }
      case "mov_margin_desc": {
        return (b.movMarginPct ?? -1e9) - (a.movMarginPct ?? -1e9);
      }
      case "potential_desc": {
        const pd = potentialScore(b.potential) - potentialScore(a.potential);
        if (pd !== 0) {
          return pd;
        }
        return (b.salesRankDrops30 ?? -1e9) - (a.salesRankDrops30 ?? -1e9);
      }
      case "capital_asc": {
        return (a.capitalRequiredGbp ?? 1e9) - (b.capitalRequiredGbp ?? 1e9);
      }
      case "profit_unit_desc": {
        return (
          (b.estimatedProfitGbpPerUnit ?? -1e9) -
          (a.estimatedProfitGbpPerUnit ?? -1e9)
        );
      }
      case "profit_line_desc":
      default: {
        return (
          (b.estimatedProfitPerLineGbp ?? -1e9) -
          (a.estimatedProfitPerLineGbp ?? -1e9)
        );
      }
    }
  });

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
      </header>

      <section className="flex flex-wrap items-center gap-4 text-sm">
        <form className="flex flex-wrap items-center gap-2" method="get">
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
            Max capital per SKU (£)
            <input
              type="number"
              name="maxCapital"
              step="0.01"
              min="0"
              defaultValue={maxCapitalPerSku != null ? String(maxCapitalPerSku) : ""}
              placeholder="No cap"
              className="ml-2 w-28 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="text-zinc-600 dark:text-zinc-400">
            Min profit £ per line
            <input
              type="number"
              name="minLineProfit"
              step="0.01"
              min="0"
              defaultValue={minProfitPerLine > 0 ? String(minProfitPerLine) : ""}
              placeholder="0"
              className="ml-2 w-24 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="text-zinc-600 dark:text-zinc-400">
            Min MoV margin %
            <input
              type="number"
              name="minMovMargin"
              step="0.1"
              min="0"
              defaultValue={minMovMarginPct > 0 ? String(minMovMarginPct) : ""}
              placeholder="0"
              className="ml-2 w-24 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="text-zinc-600 dark:text-zinc-400">
            Sort
            <select
              name="sort"
              defaultValue={sortBy}
              className="ml-2 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950"
            >
              <option value="profit_line_desc">Profit / line (desc)</option>
              <option value="profit_unit_desc">Profit / unit (desc)</option>
              <option value="margin_desc">Margin % (desc)</option>
              <option value="mov_margin_desc">MoV margin % (desc)</option>
              <option value="potential_desc">Potential (desc)</option>
              <option value="capital_asc">Capital required (asc)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" name="highOnly" value="1" defaultChecked={highOnly} />
            GTIN matches only (hide title similarity)
          </label>
          <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              name="highPotential"
              value="1"
              defaultChecked={highPotentialOnly}
            />
            High potential only
          </label>
          <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              name="showRejected"
              value="1"
              defaultChecked={showRejected}
            />
            Show rejected matches
          </label>
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Apply
          </button>
        </form>
      </section>
      <section className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500">Quick chips:</span>
        <Link
          href={buildQuickHref(sp, {
            highPotential: "1",
            sort: "potential_desc",
          })}
          className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          High potential
        </Link>
        <Link
          href={buildQuickHref(sp, {
            minMovMargin: "3",
            sort: "mov_margin_desc",
          })}
          className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          MoV margin ≥ 3%
        </Link>
        <Link
          href={buildQuickHref(sp, {
            minLineProfit: "5",
            sort: "profit_line_desc",
          })}
          className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Profit/line ≥ £5
        </Link>
        <Link
          href={buildQuickHref(sp, {
            maxCapital: "50",
            sort: "capital_asc",
          })}
          className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Low capital (≤ £50)
        </Link>
      </section>

      <section>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Showing {sorted.length} of {raw.length} linked SKUs (sorted by
          estimated £ profit / line, desc).
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Profit per line = estimated profit/unit × units per pack. MoV margin uses
          profit per line against configured min order value (when available).
        </p>
        <SourcingTable
          rows={sorted}
          upsertMatchDecisionAction={upsertMatchDecisionAction}
          sortBy={sortBy}
          searchState={cleanSearchParams(sp)}
        />
      </section>
    </div>
  );
}
