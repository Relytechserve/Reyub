import Link from "next/link";
import type { SourcingOpportunityRow } from "@/lib/sourcing/opportunities";

type Row = SourcingOpportunityRow & {
  estimatedMarginPct: number | null;
  estimatedProfitGbpPerUnit: number | null;
  capitalRequiredGbp: number | null;
  estimatedProfitPerLineGbp: number | null;
  movMarginPct: number | null;
  potential: "High" | "Medium" | "Low";
};

function showGbpIncShippingNote(
  priceIncShipping: boolean,
  currency: string
): boolean {
  return priceIncShipping && currency.trim().toUpperCase() === "GBP";
}

function matchMethodLabel(tags: string[]): string {
  if (tags.some((t) => t.startsWith("title_token"))) {
    return "Title similarity";
  }
  if (tags.includes("gtin_variant")) {
    return "GTIN (variant)";
  }
  if (tags.includes("ean_exact")) {
    return "GTIN / EAN";
  }
  return tags[0] ?? "Linked";
}

export function SourcingTable({
  rows,
  upsertMatchDecisionAction,
  sortBy,
  searchState,
}: {
  rows: Row[];
  upsertMatchDecisionAction: (formData: FormData) => Promise<void>;
  sortBy: string;
  searchState: Record<string, string>;
}) {
  const sortHref = (nextSort: string) => {
    const params = new URLSearchParams(searchState);
    params.set("sort", nextSort);
    return `/dashboard/sourcing?${params.toString()}`;
  };

  const sortableHeader = (
    label: string,
    key: string,
    title: string
  ) => {
    const active = sortBy === key;
    return (
      <Link
        href={sortHref(key)}
        title={title}
        className={
          active
            ? "inline-flex items-center gap-1 rounded bg-zinc-200 px-2 py-1 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50"
            : "inline-flex items-center gap-1 rounded px-2 py-1 text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }
      >
        <span>{label}</span>
        <span className="text-[10px]">{active ? "▼" : "↕"}</span>
      </Link>
    );
  };

  if (rows.length === 0) {
    return (
      <div className="mt-4 space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">
          No sourcing opportunities yet.
        </p>
        <p>
          Run <strong>Sync Qogita + Keepa</strong> on the main dashboard after
          configuring <code className="text-xs">KEEPA_API_KEY</code> and Qogita
          credentials. Matches are built from{" "}
          <strong>all barcodes</strong> on the Keepa product when available,
          then optional <strong>title similarity</strong> for unmatched ASINs (
          <code className="text-xs">MATCH_FUZZY_TITLES=0</code> to disable).
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Amazon
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Sell ref £
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Demand
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Units/Pack
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Qogita buy
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              {sortableHeader(
                "Est. margin",
                "margin_desc",
                "Sort by estimated margin percentage (descending)"
              )}
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              {sortableHeader(
                "Est. profit / unit",
                "profit_unit_desc",
                "Sort by profit per unit (descending)"
              )}
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              {sortableHeader(
                "Capital required (£)",
                "capital_asc",
                "Sort by lowest capital required first"
              )}
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              {sortableHeader(
                "Profit per line (£)",
                "profit_line_desc",
                "Sort by profit per line (descending)"
              )}
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              {sortableHeader(
                "MoV margin",
                "mov_margin_desc",
                "Sort by margin versus minimum order value (descending)"
              )}
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              {sortableHeader(
                "Match / Potential",
                "potential_desc",
                "Sort by sales potential recommendation"
              )}
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Review
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr
              key={m.productMatchId}
              className="border-b border-zinc-100 dark:border-zinc-800"
            >
              <td className="max-w-[280px] px-3 py-2">
                <div className="font-mono text-xs">
                  <a
                    href={`https://www.amazon.co.uk/dp/${m.asin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                  >
                    {m.asin}
                  </a>
                </div>
                <div
                  className="mt-1 line-clamp-2 text-zinc-800 dark:text-zinc-200"
                  title={m.amazonTitle ?? ""}
                >
                  {m.amazonTitle ?? "—"}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-800 dark:text-zinc-200">
                <div>
                  BB{" "}
                  {m.amazonBuyBoxGbp ? `£${m.amazonBuyBoxGbp}` : "—"}
                </div>
                <div className="text-xs text-zinc-500">
                  30d{" "}
                  {m.avg30BuyBoxGbp ? `£${m.avg30BuyBoxGbp}` : "—"}
                </div>
              </td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                <div>BSR {m.salesRank?.toLocaleString() ?? "—"}</div>
                <div className="text-xs">
                  Drops 30d {m.salesRankDrops30?.toLocaleString() ?? "—"}
                </div>
                <div className="mt-1">
                  <span
                    className={
                      m.potential === "High"
                        ? "inline-block rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                        : m.potential === "Medium"
                          ? "inline-block rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                          : "inline-block rounded bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                    }
                    title="Potential is inferred from 30d sales-rank drops + current BSR."
                  >
                    {m.potential} potential
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                {m.unitsPerPack != null ? m.unitsPerPack : 1}
              </td>
              <td className="max-w-[220px] px-3 py-2">
                <div
                  className="line-clamp-2 text-zinc-800 dark:text-zinc-200"
                  title={m.qogitaTitle}
                >
                  {m.qogitaTitle}
                </div>
                <div className="mt-1 font-mono text-xs text-zinc-500">
                  EAN {m.qogitaEan ?? "—"}
                </div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  {m.buyUnitPrice ?? "—"} {m.currency} · Stock{" "}
                  {m.stockUnits ?? "—"}
                </div>
                {showGbpIncShippingNote(m.priceIncShipping, m.currency) ? (
                  <p
                    className="mt-1 text-[10px] text-amber-800 dark:text-amber-200/90"
                    title="Excel catalog column is £ lowest price including shipping; estimated margin is not net ex-shipping landed cost."
                  >
                    Inc. shipping — margin ≠ ex-shipping buy
                  </p>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {m.estimatedMarginPct != null ? (
                  <span
                    className={
                      m.estimatedMarginPct >= 15
                        ? "text-emerald-700 dark:text-emerald-400"
                        : m.estimatedMarginPct >= 0
                          ? "text-amber-800 dark:text-amber-200"
                          : "text-red-700 dark:text-red-300"
                    }
                  >
                    {m.estimatedMarginPct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-800 dark:text-zinc-200">
                {m.estimatedProfitGbpPerUnit != null ? (
                  <span
                    className={
                      m.estimatedProfitGbpPerUnit >= 0
                        ? "text-emerald-800 dark:text-emerald-300"
                        : "text-red-700 dark:text-red-300"
                    }
                  >
                    £{m.estimatedProfitGbpPerUnit.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-800 dark:text-zinc-200">
                {m.capitalRequiredGbp != null ? (
                  <span>£{m.capitalRequiredGbp.toFixed(2)}</span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-800 dark:text-zinc-200">
                {m.estimatedProfitPerLineGbp != null ? (
                  <div>
                    <span
                      className={
                        m.estimatedProfitPerLineGbp >= 0
                          ? "text-emerald-800 dark:text-emerald-300"
                          : "text-red-700 dark:text-red-300"
                      }
                    >
                      £{m.estimatedProfitPerLineGbp.toFixed(2)}
                    </span>
                    <p className="text-[10px] text-zinc-500">
                      £{(m.estimatedProfitGbpPerUnit ?? 0).toFixed(2)} × {m.unitsPerPack ?? 1}
                    </p>
                  </div>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-800 dark:text-zinc-200">
                {m.movMarginPct != null ? (
                  <span
                    className={
                      m.movMarginPct >= 5
                        ? "text-emerald-800 dark:text-emerald-300"
                        : m.movMarginPct >= 0
                          ? "text-amber-800 dark:text-amber-200"
                          : "text-red-700 dark:text-red-300"
                    }
                    title="Profit per line as a % of min order value override (MoV), when provided."
                  >
                    {m.movMarginPct.toFixed(2)}%
                  </span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 align-top">
                <span
                  className={
                    m.matchConfidence === "high"
                      ? "inline-block rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                      : "inline-block rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-950 dark:bg-amber-900/40 dark:text-amber-100"
                  }
                >
                  {m.matchConfidence}
                </span>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {matchMethodLabel(m.matchReasonTags)}
                </div>
                {m.decision === "approve" ? (
                  <p className="mt-1 inline-block rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-900 dark:bg-blue-900/40 dark:text-blue-100">
                    Reviewed
                  </p>
                ) : null}
                {m.decision === "reject" ? (
                  <p className="mt-1 inline-block rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-900 dark:bg-rose-900/40 dark:text-rose-100">
                    Rejected
                  </p>
                ) : null}
                {m.matchConfidence === "medium" ? (
                  <p className="mt-1 text-[10px] text-amber-800 dark:text-amber-200/90">
                    Review before ordering — not GTIN-verified.
                  </p>
                ) : null}
              </td>
              <td className="min-w-[220px] px-3 py-2 align-top">
                <form action={upsertMatchDecisionAction} className="space-y-1">
                  <input type="hidden" name="productMatchId" value={m.productMatchId} />
                  <input
                    type="text"
                    name="notes"
                    defaultValue={m.decisionNotes ?? ""}
                    placeholder="Optional note"
                    className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-950"
                  />
                  <div className="flex gap-1">
                    <button
                      type="submit"
                      name="decision"
                      value="approve"
                      className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600"
                    >
                      Approve
                    </button>
                    <button
                      type="submit"
                      name="decision"
                      value="reject"
                      className="rounded bg-rose-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-600"
                    >
                      Reject
                    </button>
                  </div>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
