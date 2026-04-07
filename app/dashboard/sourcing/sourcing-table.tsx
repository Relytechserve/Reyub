import Link from "next/link";
import type { SourcingOpportunityRow } from "@/lib/sourcing/opportunities";
import {
  isSortActiveForColumn,
  sortDirectionGlyph,
  type SourcingSortColumn,
} from "@/lib/sourcing/sourcing-table-sort";

type Row = SourcingOpportunityRow & {
  estimatedMarginPct: number | null;
  estimatedProfitGbpPerUnit: number | null;
  capitalRequiredGbp: number | null;
  estimatedProfitPerLineGbp: number | null;
  movMarginPct: number | null;
  potential: "High" | "Medium" | "Low";
  potentialBreakdown: {
    velocityPct: number;
    rankPct: number;
    compositePct: number;
  };
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

function rowDecisionSignal(row: Row): {
  label: string;
  tone: "buy" | "watch" | "avoid";
} {
  const margin = row.estimatedMarginPct ?? -999;
  const line = row.estimatedProfitPerLineGbp ?? -999;
  if (
    row.matchConfidence === "high" &&
    row.potential === "High" &&
    margin >= 10 &&
    line >= 5
  ) {
    return { label: "Strong buy signal", tone: "buy" };
  }
  if (row.matchConfidence === "high" && row.potential !== "Low" && margin >= 5) {
    return { label: "Watch", tone: "watch" };
  }
  return { label: "Avoid", tone: "avoid" };
}

export function SourcingTable({
  rows,
  upsertMatchDecisionAction,
  sortBy,
  sortHrefForColumn,
}: {
  rows: Row[];
  upsertMatchDecisionAction: (formData: FormData) => Promise<void>;
  sortBy: string;
  sortHrefForColumn: (column: SourcingSortColumn) => string;
}) {
  const helpHref = (anchor: string) => `/dashboard/docs#${anchor}`;

  const helpLink = (anchor: string, label: string) => (
    <Link
      href={helpHref(anchor)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
      title={label}
      aria-label={label}
    >
      ?
    </Link>
  );

  const headerWithHelp = (label: string, anchor: string, title: string) => (
    <span className="inline-flex items-center gap-1">
      <span>{label}</span>
      {helpLink(anchor, title)}
    </span>
  );

  const sortableHeader = (
    label: string,
    column: SourcingSortColumn,
    title: string
  ) => {
    const active = isSortActiveForColumn(sortBy, column);
    const glyph = sortDirectionGlyph(sortBy, column);
    return (
      <Link
        href={sortHrefForColumn(column)}
        title={`${title}. Click again to reverse order.`}
        className={
          active
            ? "inline-flex items-center gap-1 rounded bg-zinc-200 px-2 py-1 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50"
            : "inline-flex items-center gap-1 rounded px-2 py-1 text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }
      >
        <span>{label}</span>
        <span className="text-[10px] tabular-nums">{glyph}</span>
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
              {headerWithHelp(
                "Sell ref £",
                "sell-reference",
                "Open docs: sell reference price formula"
              )}
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              {headerWithHelp(
                "Demand",
                "demand-potential",
                "Open docs: BSR, drops, and potential model"
              )}
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              {headerWithHelp(
                "Units/Pack",
                "units-per-pack",
                "Open docs: units per pack explanation"
              )}
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              {headerWithHelp(
                "Qogita buy",
                "qogita-buy",
                "Open docs: Qogita buy-side parameters"
              )}
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              <span className="inline-flex items-center gap-1">
                {sortableHeader(
                  "Est. margin",
                  "margin",
                  "Sort by estimated margin percentage"
                )}
                {helpLink(
                  "estimated-margin",
                  "Open docs: estimated margin formula"
                )}
              </span>
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              <span className="inline-flex items-center gap-1">
                {sortableHeader(
                  "Est. profit / unit",
                  "profit_unit",
                  "Sort by profit per unit"
                )}
                {helpLink(
                  "profit-per-unit",
                  "Open docs: estimated profit per unit formula"
                )}
              </span>
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              <span className="inline-flex items-center gap-1">
                {sortableHeader(
                  "Capital required (£)",
                  "capital",
                  "Sort by capital required"
                )}
                {helpLink(
                  "capital-required",
                  "Open docs: capital required calculation"
                )}
              </span>
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              <span className="inline-flex items-center gap-1">
                {sortableHeader(
                  "Profit per line (£)",
                  "profit_line",
                  "Sort by profit per line"
                )}
                {helpLink(
                  "profit-per-line",
                  "Open docs: profit per line formula"
                )}
              </span>
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              <span className="inline-flex items-center gap-1">
                {sortableHeader(
                  "MoV margin",
                  "mov_margin",
                  "Sort by margin versus minimum order value"
                )}
                {helpLink(
                  "mov-margin",
                  "Open docs: MoV margin formula"
                )}
              </span>
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              <span className="inline-flex items-center gap-1">
                {sortableHeader(
                  "Match / Potential",
                  "potential",
                  "Sort by sales potential"
                )}
                {helpLink(
                  "match-confidence",
                  "Open docs: match confidence and potential explanation"
                )}
              </span>
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              {headerWithHelp(
                "Decision",
                "decision-signals",
                "Open docs: Strong buy/Watch/Avoid logic"
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
                  {(() => {
                    const b = m.potentialBreakdown;
                    const breakdownTitle = `Potential breakdown | Velocity: ${b.velocityPct}% | Rank: ${b.rankPct}% | Composite: ${b.compositePct}%`;
                    return (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <span
                            className={
                              m.potential === "High"
                                ? "inline-block rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                                : m.potential === "Medium"
                                  ? "inline-block rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                                  : "inline-block rounded bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                            }
                            title={breakdownTitle}
                          >
                            {m.potential} potential
                          </span>
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 text-[10px] text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
                            title={breakdownTitle}
                            aria-label="Potential breakdown"
                          >
                            i
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 text-[10px]">
                          <span
                            className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            title="Velocity signal from Keepa sales-rank drops over 30 days"
                          >
                            V {b.velocityPct}%
                          </span>
                          <span
                            className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            title="Rank strength signal from Keepa BSR (lower BSR = stronger)"
                          >
                            R {b.rankPct}%
                          </span>
                          <span
                            className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            title="Composite demand score used for potential tiering"
                          >
                            C {b.compositePct}%
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                {m.unitsPerPack != null ? m.unitsPerPack : 1}
              </td>
              <td className="max-w-[220px] px-3 py-2">
                <a
                  href={m.qogitaProductUrl ?? `https://www.qogita.com/search?q=${encodeURIComponent(m.qogitaId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-200"
                  title={m.qogitaTitle}
                >
                  {m.qogitaTitle}
                </a>
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
              <td className="px-3 py-2 align-top">
                {(() => {
                  const signal = rowDecisionSignal(m);
                  const cls =
                    signal.tone === "buy"
                      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                      : signal.tone === "watch"
                        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                        : "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";
                  return (
                    <span
                      className={`inline-block rounded px-2 py-1 text-[10px] font-semibold uppercase ${cls}`}
                      title="ReyubPM heuristic: confidence, potential, margin and profit/line."
                    >
                      {signal.label}
                    </span>
                  );
                })()}
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
