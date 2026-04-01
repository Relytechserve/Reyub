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

  const statsSnippet: Record<string, unknown> = {
    buyBoxPrice: stats.buyBoxPrice,
    current: stats.current,
    avg30: stats.avg30,
    avg90: stats.avg90,
    outOfStockPercentage30: stats.outOfStockPercentage30,
    salesRankDrops30: stats.salesRankDrops30,
    currentSalesRank: stats.currentSalesRank,
  };

  return { asin, title, buyBoxMinor, salesRank, statsSnippet };
}

/** Convert Keepa minor units to display GBP (approximate; Keepa uses integer minor). */
export function formatGbpFromKeepaMinor(minor: number | undefined): string | null {
  if (minor === undefined || minor <= 0) {
    return null;
  }
  return (minor / 100).toFixed(2);
}
