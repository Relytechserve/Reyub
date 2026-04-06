import type { KeepaDashboardRow } from "@/lib/sync/qogita-keepa";

type Row = KeepaDashboardRow & { estimatedMarginPct: number | null };

function showGbpIncShippingNote(
  priceIncShipping: boolean,
  currency: string | null | undefined
): boolean {
  return (
    priceIncShipping &&
    (currency ?? "").trim().toUpperCase() === "GBP"
  );
}

export function KeepaTopTable({
  rows,
  showMargin,
}: {
  rows: Row[];
  showMargin: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-4 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">
          No Keepa-backed rows in the Top 20 ranking yet.
        </p>
        <p>
          Open <strong>Pipeline diagnostics</strong> above: it shows whether Qogita
          offers were saved, how many had EANs, whether the Keepa API ran, and how
          many ASINs were stored. A valid <code className="text-xs">KEEPA_API_KEY</code>{" "}
          only helps if at least one EAN was sent to Keepa.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full min-w-[960px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              #
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Amazon (Keepa)
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Buy box £
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              30d avg £
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              BSR
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Rank drops (30d)
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Qogita (sourcing)
            </th>
            {showMargin ? (
              <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
                Est. net margin
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr
              key={m.matchId}
              className="border-b border-zinc-100 dark:border-zinc-800"
            >
              <td className="px-3 py-2 text-zinc-500 dark:text-zinc-500">
                {i + 1}
              </td>
              <td className="max-w-[260px] px-3 py-2">
                <div className="font-mono text-xs">
                  <a
                    href={`https://www.amazon.co.uk/dp/${m.asin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                  >
                    {m.asin}
                  </a>
                  {!m.qogitaId ? (
                    <span
                      className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                      title="No Qogita offer linked for this ASIN"
                    >
                      Amazon only
                    </span>
                  ) : m.matchReasonTags?.some((t) =>
                      t.startsWith("title_token")
                    ) ? (
                    <span
                      className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-violet-900 dark:bg-violet-900/40 dark:text-violet-100"
                      title="Matched by title similarity — verify before buying"
                    >
                      Title match
                    </span>
                  ) : null}
                </div>
                <div
                  className="mt-1 line-clamp-2 text-zinc-800 dark:text-zinc-200"
                  title={m.amazonTitle ?? ""}
                >
                  {m.amazonTitle ?? "—"}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-800 dark:text-zinc-200">
                {m.amazonBuyBoxGbp ? `£${m.amazonBuyBoxGbp}` : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                {m.avg30BuyBoxGbp ? `£${m.avg30BuyBoxGbp}` : "—"}
              </td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                {m.salesRank?.toLocaleString() ?? "—"}
              </td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                {m.salesRankDrops30?.toLocaleString() ?? "—"}
              </td>
              <td className="max-w-[240px] px-3 py-2">
                {m.qogitaId ? (
                  <>
                    <div
                      className="line-clamp-2 text-zinc-800 dark:text-zinc-200"
                      title={m.qogitaTitle ?? ""}
                    >
                      {m.qogitaTitle ?? "—"}
                    </div>
                    <div className="mt-1 font-mono text-xs text-zinc-500">
                      EAN {m.ean ?? "—"}
                    </div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">
                      Buy {m.buyUnitPrice ?? "—"} {m.currency ?? ""} · Stock{" "}
                      {m.stockUnits ?? "—"}
                    </div>
                    {showGbpIncShippingNote(
                      m.priceIncShipping,
                      m.currency
                    ) ? (
                      <p
                        className="mt-1 text-[10px] text-amber-800 dark:text-amber-200/90"
                        title="Catalog price includes shipping; estimated margin is not net ex-shipping landed cost."
                      >
                        Inc. shipping — margin ≠ ex-shipping buy
                      </p>
                    ) : null}
                  </>
                ) : (
                  <span className="text-zinc-500 dark:text-zinc-500">
                    No matching Qogita offer (same GTIN)
                  </span>
                )}
              </td>
              {showMargin ? (
                <td className="whitespace-nowrap px-3 py-2 text-zinc-800 dark:text-zinc-200">
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
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
