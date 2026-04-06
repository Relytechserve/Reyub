import type { SyncRunDiagnosticsStats } from "@/lib/sync/types";

type SyncRunRow = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  stats: unknown;
  error: string | null;
};

type QogitaSample = {
  qogitaId: string;
  title: string;
  ean: string | null;
  categorySlug: string | null;
  updatedAt: Date;
};

type Props = {
  latestRun: SyncRunRow | null;
  qogitaSamples: QogitaSample[];
  envHints: {
    keepaKeyPresent: boolean;
    qogitaAuthPresent: boolean;
  };
  breakdown: {
    excelCatalogRows: number;
    apiCatalogRows: number;
    matchHigh: number;
    matchMedium: number;
  };
};

function isStats(s: unknown): s is SyncRunDiagnosticsStats {
  return (
    !!s &&
    typeof s === "object" &&
    "offersFetched" in s &&
    "keepaKeyConfigured" in s
  );
}

export function ExtractionDiagnostics({
  latestRun,
  qogitaSamples,
  envHints,
  breakdown,
}: Props) {
  const stats = latestRun && isStats(latestRun.stats) ? latestRun.stats : null;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Pipeline diagnostics (what was extracted)
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Reyub does <strong>not</strong> run your Qogita or Keepa calls from this
        chat — only your app (local <code className="text-xs">npm run dev</code>
        , Vercel, or cron) does. This panel reads{" "}
        <strong>your database</strong> after you click Sync.
      </p>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
        <p className="font-medium text-zinc-800 dark:text-zinc-200">
          Server environment (not the browser)
        </p>
        <ul className="mt-2 list-inside list-disc text-zinc-700 dark:text-zinc-300">
          <li>
            Qogita auth configured:{" "}
            <span className="font-mono">
              {envHints.qogitaAuthPresent ? "yes" : "no"}
            </span>{" "}
            (email/password or <code className="text-xs">QOGITA_API_TOKEN</code>
            )
          </li>
          <li>
            <code className="text-xs">KEEPA_API_KEY</code> present on server:{" "}
            <span className="font-mono">
              {envHints.keepaKeyPresent ? "yes" : "no"}
            </span>
          </li>
        </ul>
        <p className="mt-2 text-xs text-zinc-500">
          If Keepa is &quot;yes&quot; here but sync says it is missing, restart
          the dev server after editing <code className="text-xs">.env.local</code>
          .
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          <strong>~100 Keepa rows?</strong> Matching prefers **all barcodes** from the
          Keepa product, then optional **title similarity** (
          <code className="text-xs">MATCH_FUZZY_TITLES=0</code> to disable) — pull
          enough Qogita + Keepa data. Subcategory expansion is{" "}
          <strong>on by default</strong> (disable with{" "}
          <code className="text-xs">KEEPA_BESTSELLER_EXPAND_CHILDREN=0</code>
          ). If the count stays low, set{" "}
          <code className="text-xs">KEEPA_BESTSELLER_EXPAND_DEPTH=2</code> on the
          server and run sync again.
        </p>
      </div>

      {latestRun ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Last sync run
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Started {latestRun.startedAt.toISOString()}
            {latestRun.finishedAt
              ? ` · Finished ${latestRun.finishedAt.toISOString()}`
              : ""}{" "}
            · Status <span className="font-mono">{latestRun.status}</span>
          </p>
          {stats ? (
            <ul className="mt-3 grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 sm:grid-cols-2">
              <li>Qogita offers pulled: {stats.offersFetched}</li>
              <li>Rows upserted to DB: {stats.qogitaRowsUpserted}</li>
              <li>Qogita rows (Excel import): {breakdown.excelCatalogRows}</li>
              <li>Qogita rows (non-Excel/API-like): {breakdown.apiCatalogRows}</li>
              <li>Offers with EAN after mapping: {stats.offersWithEanInBatch}</li>
              <li>Unique EANs sent to Keepa: {stats.uniqueEansSentToKeepa}</li>
              <li>Keepa key configured: {String(stats.keepaKeyConfigured)}</li>
              <li>Keepa API called: {String(stats.keepaApiCalled)}</li>
              <li>Keepa product objects returned: {stats.keepaProductsReturned}</li>
              <li>ASIN rows saved + snapshot: {stats.keepaRowsSaved}</li>
              <li>Keepa rows skipped (no ASIN): {stats.keepaSkippedNoAsin}</li>
              <li>
                With Qogita link (GTIN + optional title):{" "}
                {stats.matchesWithQogitaEan}
              </li>
              <li>Matched ASINs (high confidence): {breakdown.matchHigh}</li>
              <li>Matched ASINs (medium confidence): {breakdown.matchMedium}</li>
              {"matchEanStage" in stats &&
              typeof stats.matchEanStage === "number" ? (
                <li>… of which GTIN stage: {stats.matchEanStage}</li>
              ) : null}
              {"matchFuzzyStage" in stats &&
              typeof stats.matchFuzzyStage === "number" ? (
                <li>… of which title-similarity stage: {stats.matchFuzzyStage}</li>
              ) : null}
              {"qogitaFullCatalog" in stats && stats.qogitaFullCatalog ? (
                <li className="sm:col-span-2">
                  Qogita full-catalog mode: yes · pages fetched:{" "}
                  {"qogitaPagesFetched" in stats
                    ? stats.qogitaPagesFetched
                    : "—"}{" "}
                  · row safety cap:{" "}
                  {"qogitaMaxRowsSafety" in stats
                    ? stats.qogitaMaxRowsSafety
                    : "—"}
                </li>
              ) : (
                <li className="sm:col-span-2">
                  Qogita full-catalog mode: no (set{" "}
                  <code className="text-xs">QOGITA_SYNC_FULL_CATALOG=1</code> to
                  paginate until the API ends or a safety cap)
                </li>
              )}
              <li className="sm:col-span-2">
                Qogita path:{" "}
                <code className="text-xs">{stats.qogitaOffersPath}</code>
              </li>
              <li className="sm:col-span-2 text-zinc-600 dark:text-zinc-400">
                Categories: {stats.categoryNote}
              </li>
              {"keepaCategorySliceNote" in stats &&
              stats.keepaCategorySliceNote ? (
                <li className="sm:col-span-2 text-zinc-600 dark:text-zinc-400">
                  {stats.keepaCategorySliceNote}
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">No structured stats on this run.</p>
          )}
          {latestRun.error ? (
            <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
              {latestRun.error}
            </pre>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          No sync has been recorded yet. Run <strong>Sync Qogita + Keepa</strong>{" "}
          once to populate this section.
        </p>
      )}

      <div className="mt-8">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Latest Qogita rows in database (sample)
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          Proves offers were stored. If EAN is blank for all rows, Keepa is never
          called — that is the usual reason for an empty Top 20 table.
        </p>
        {qogitaSamples.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No Qogita rows in DB yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <th className="px-2 py-2 font-medium">Qogita ID</th>
                  <th className="px-2 py-2 font-medium">EAN</th>
                  <th className="px-2 py-2 font-medium">Category (raw)</th>
                  <th className="px-2 py-2 font-medium">Title</th>
                </tr>
              </thead>
              <tbody>
                {qogitaSamples.map((r) => (
                  <tr
                    key={r.qogitaId}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-2 py-2 font-mono text-zinc-700 dark:text-zinc-300">
                      {r.qogitaId}
                    </td>
                    <td className="px-2 py-2 font-mono text-zinc-800 dark:text-zinc-200">
                      {r.ean ?? (
                        <span className="text-amber-700 dark:text-amber-300">
                          missing
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-zinc-600 dark:text-zinc-400">
                      {r.categorySlug ?? "—"}
                    </td>
                    <td className="max-w-[280px] px-2 py-2 text-zinc-700 dark:text-zinc-300">
                      <span className="line-clamp-2" title={r.title}>
                        {r.title}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
