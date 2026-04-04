import type { KeepaCatalogBrowseRow } from "@/lib/sync/qogita-keepa";

export function KeepaCatalogTable({
  rows,
}: {
  rows: KeepaCatalogBrowseRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">
          No Keepa rows yet
        </p>
        <p className="mt-2">
          Run <strong>Sync</strong> from the dashboard (or{" "}
          <code className="text-xs">npm run sync:pipeline</code>) with{" "}
          <code className="text-xs">KEEPA_API_KEY</code> and{" "}
          <code className="text-xs">KEEPA_BESTSELLER_CATEGORY_IDS</code> set.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              ASIN
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Browse node
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              BS rank
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Title
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              EAN (Keepa)
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Buy box £
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              BSR
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Drops 30d
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Qogita
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              30d series
            </th>
            <th className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-300">
              Captured
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr
              key={m.matchId}
              className="border-b border-zinc-100 dark:border-zinc-800"
            >
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                <a
                  href={`https://www.amazon.co.uk/dp/${m.asin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                >
                  {m.asin}
                </a>
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                {m.browseNodeId ?? "—"}
              </td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                {m.bestsellerRank ?? "—"}
              </td>
              <td className="max-w-[280px] px-3 py-2">
                <div
                  className="line-clamp-2 text-zinc-800 dark:text-zinc-200"
                  title={m.amazonTitle ?? ""}
                >
                  {m.amazonTitle ?? "—"}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                {m.keepaPrimaryEan ?? "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-800 dark:text-zinc-200">
                {m.amazonBuyBoxGbp ? `£${m.amazonBuyBoxGbp}` : "—"}
              </td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                {m.salesRank?.toLocaleString() ?? "—"}
              </td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                {m.salesRankDrops30?.toLocaleString() ?? "—"}
              </td>
              <td className="max-w-[200px] px-3 py-2 text-xs">
                {m.qogitaId ? (
                  <span className="text-emerald-800 dark:text-emerald-300">
                    Linked · {m.qogitaTitle?.slice(0, 40)}
                    {(m.qogitaTitle?.length ?? 0) > 40 ? "…" : ""}
                  </span>
                ) : (
                  <span className="text-zinc-500">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                {m.hasKeepaTimeseries ? (
                  <span
                    className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
                    title="Stored in metrics.keepaTimeseries (Keepa csv / salesRanks, etc.)"
                  >
                    Yes
                  </span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-500">
                {m.capturedAt.toISOString().slice(0, 19).replace("T", " ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
