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
  /** Breakdown when multi-stage matcher runs (GTIN + fuzzy). */
  matchEanStage?: number;
  matchFuzzyStage?: number;
  qogitaOffersPath: string;
  categoryFilterApplied: boolean;
  categoryNote: string;
  /** When set, Qogita was synced in full-catalog mode (paginate until end or safety cap). */
  qogitaFullCatalog?: boolean;
  qogitaPagesFetched?: number;
  qogitaMaxRowsSafety?: number;
  /** Keepa category batching (offset/length over expanded browse nodes). */
  keepaCategorySliceNote?: string;
};
