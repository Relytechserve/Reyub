/** Persisted on `sync_runs.stats` for dashboard diagnostics. */
export type SyncRunDiagnosticsStats = {
  offersFetched: number;
  qogitaRowsUpserted: number;
  offersWithEanInBatch: number;
  uniqueEansSentToKeepa: number;
  keepaKeyConfigured: boolean;
  keepaApiCalled: boolean;
  keepaProductsReturned: number;
  keepaRowsSaved: number;
  keepaSkippedNoAsin: number;
  matchesWithQogitaEan: number;
  qogitaOffersPath: string;
  categoryFilterApplied: boolean;
  categoryNote: string;
};
