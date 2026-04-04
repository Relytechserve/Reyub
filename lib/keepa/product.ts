/**
 * Keepa Product API — UK marketplace (domain 2 = amazon.co.uk).
 * @see https://keepa.com/#!discuss/t/request-products/110
 */

const KEEPA_BASE = "https://api.keepa.com";

/** Amazon UK */
export const KEEPA_DOMAIN_UK = 2;

export type KeepaProduct = Record<string, unknown>;

export type KeepaProductResponse = {
  products?: KeepaProduct[];
  error?: { message?: string; type?: string };
};

export type FetchKeepaProductsByAsinsOptions = {
  domain?: number;
  statsDays?: number;
  /**
   * Include Keepa `csv` / rank history (higher token use). Maps to `history=1`.
   * @see https://keepa.com/#!discuss/t/request-products/110
   */
  includeHistory?: boolean;
  /** Limit history to last N days (`days` query param). Only when includeHistory. */
  historyDays?: number;
};

/** Batch ASIN lookup (max 100 per request). ASINs are 10-char alphanumeric. */
export async function fetchKeepaProductsByAsins(
  asins: string[],
  apiKey: string,
  options: FetchKeepaProductsByAsinsOptions = {}
): Promise<KeepaProduct[]> {
  const domain = options.domain ?? KEEPA_DOMAIN_UK;
  const statsDays = options.statsDays ?? 30;
  const includeHistory = options.includeHistory ?? false;
  const historyDays = options.historyDays;
  const cleaned = [
    ...new Set(
      asins
        .map((a) => a.trim().toUpperCase())
        .filter((a) => /^[A-Z0-9]{10}$/.test(a))
    ),
  ];
  const out: KeepaProduct[] = [];

  for (let i = 0; i < cleaned.length; i += 100) {
    const chunk = cleaned.slice(i, i + 100);
    const batch = await fetchProductsChunkOrSingles(
      chunk,
      apiKey,
      domain,
      statsDays,
      includeHistory,
      historyDays
    );
    out.push(...batch);
  }

  return out;
}

/** One Keepa product request; on batch error, retry ASINs individually so one bad code does not fail the run. */
async function fetchProductsChunkOrSingles(
  chunk: string[],
  apiKey: string,
  domain: number,
  statsDays: number,
  includeHistory: boolean,
  historyDays: number | undefined
): Promise<KeepaProduct[]> {
  /** Keepa: use `asin` for ASINs; `code` is for UPC/EAN/ISBN only. */
  const tryOnce = async (asins: string[]): Promise<KeepaProduct[]> => {
    const params = new URLSearchParams({
      key: apiKey,
      domain: String(domain),
      asin: asins.join(","),
      history: includeHistory ? "1" : "0",
      stats: String(statsDays),
    });
    if (includeHistory && historyDays != null && historyDays > 0) {
      params.set("days", String(historyDays));
    }
    const res = await fetch(`${KEEPA_BASE}/product?${params}`);
    const json = (await res.json()) as KeepaProductResponse;
    if (json.error?.message) {
      throw new Error(
        `Keepa: ${json.error.message}${json.error.type ? ` (${json.error.type})` : ""}`
      );
    }
    if (!res.ok) {
      throw new Error(`Keepa HTTP ${res.status}`);
    }
    return json.products ?? [];
  };

  try {
    return await tryOnce(chunk);
  } catch {
    if (chunk.length <= 1) {
      return [];
    }
    const merged: KeepaProduct[] = [];
    for (const asin of chunk) {
      try {
        merged.push(
          ...(await tryOnce([asin]))
        );
      } catch {
        // skip invalid or unsupported ASIN for this domain
      }
    }
    return merged;
  }
}

/**
 * Raw Keepa time-series fields for ~30d charts (format is Keepa-compressed arrays).
 * Omit heavy keys from API responses when not needed to save DB size.
 */
export function pickKeepaTimeseriesFields(p: KeepaProduct): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.csv != null) {
    out.csv = p.csv;
  }
  if (p.salesRanks != null) {
    out.salesRanks = p.salesRanks;
  }
  if (p.salesRankReferenceHistory != null) {
    out.salesRankReferenceHistory = p.salesRankReferenceHistory;
  }
  if (p.monthlySoldHistory != null) {
    out.monthlySoldHistory = p.monthlySoldHistory;
  }
  if (p.buyBoxSellerIdHistory != null) {
    out.buyBoxSellerIdHistory = p.buyBoxSellerIdHistory;
  }
  return out;
}

/** Batch EAN/UPC lookup (max 100 codes per request). */
export async function fetchKeepaProductsByProductCodes(
  codes: string[],
  apiKey: string,
  options: { domain?: number; statsDays?: number } = {}
): Promise<KeepaProduct[]> {
  const domain = options.domain ?? KEEPA_DOMAIN_UK;
  const statsDays = options.statsDays ?? 30;
  const cleaned = [...new Set(codes.map((c) => c.replace(/\D/g, "")))].filter(
    (c) => c.length >= 8 && c.length <= 14
  );
  const out: KeepaProduct[] = [];

  for (let i = 0; i < cleaned.length; i += 100) {
    const chunk = cleaned.slice(i, i + 100);
    const params = new URLSearchParams({
      key: apiKey,
      domain: String(domain),
      code: chunk.join(","),
      history: "0",
      stats: String(statsDays),
    });
    const res = await fetch(`${KEEPA_BASE}/product?${params}`);
    const json = (await res.json()) as KeepaProductResponse;
    if (json.error?.message) {
      throw new Error(
        `Keepa: ${json.error.message}${json.error.type ? ` (${json.error.type})` : ""}`
      );
    }
    if (!res.ok) {
      throw new Error(`Keepa HTTP ${res.status}`);
    }
    out.push(...(json.products ?? []));
  }

  return out;
}

/**
 * Keepa stores many prices as integer hundredths of the currency unit
 * (e.g. GBP → pence × 100 style). Prefer `stats` when present.
 */
export function extractListingSummary(p: KeepaProduct): {
  asin: string;
  title: string;
  buyBoxMinor?: number;
  salesRank?: number;
  salesRankDrops30?: number;
  avg30BuyBoxMinor?: number;
  statsSnippet: Record<string, unknown>;
} {
  const asin = typeof p.asin === "string" ? p.asin : "";
  const title = typeof p.title === "string" ? p.title : "";
  const stats = p.stats && typeof p.stats === "object" ? p.stats as Record<string, unknown> : {};

  let buyBoxMinor: number | undefined;
  if (typeof stats.buyBoxPrice === "number" && stats.buyBoxPrice > 0) {
    buyBoxMinor = stats.buyBoxPrice;
  } else if (typeof stats.current === "object" && stats.current !== null) {
    const cur = stats.current as unknown[];
    if (Array.isArray(cur) && typeof cur[0] === "number" && cur[0] > 0) {
      buyBoxMinor = cur[0];
    }
  }

  let salesRank: number | undefined;
  if (typeof stats.currentSalesRank === "number" && stats.currentSalesRank > 0) {
    salesRank = stats.currentSalesRank;
  }

  let salesRankDrops30: number | undefined;
  if (typeof stats.salesRankDrops30 === "number" && stats.salesRankDrops30 >= 0) {
    salesRankDrops30 = Math.floor(stats.salesRankDrops30);
  }

  let avg30BuyBoxMinor: number | undefined;
  if (Array.isArray(stats.avg30)) {
    const a = stats.avg30 as unknown[];
    if (typeof a[0] === "number" && a[0] > 0) {
      avg30BuyBoxMinor = a[0];
    }
  }

  const statsSnippet: Record<string, unknown> = {
    buyBoxPrice: stats.buyBoxPrice,
    current: stats.current,
    avg30: stats.avg30,
    avg90: stats.avg90,
    outOfStockPercentage30: stats.outOfStockPercentage30,
    salesRankDrops30: stats.salesRankDrops30,
    currentSalesRank: stats.currentSalesRank,
  };

  return {
    asin,
    title,
    buyBoxMinor,
    salesRank,
    salesRankDrops30,
    avg30BuyBoxMinor,
    statsSnippet,
  };
}

/** Convert Keepa minor units to display GBP (approximate; Keepa uses integer minor). */
export function formatGbpFromKeepaMinor(minor: number | undefined): string | null {
  if (minor === undefined || minor <= 0) {
    return null;
  }
  return (minor / 100).toFixed(2);
}
