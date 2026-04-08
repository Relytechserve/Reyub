/**
 * Keepa Best Sellers API — returns ASINs for an Amazon browse node.
 * @see https://keepa.com/#!discuss/t/best-sellers/134
 */

const KEEPA_BASE = "https://api.keepa.com";

/** Normalize Keepa bestsellers response shapes into a list of ASIN-like strings. */
function normalizeBestsellerPayload(json: BestsellersResponse): unknown[] {
  if (Array.isArray(json.bestsellers)) {
    return json.bestsellers;
  }
  const bsl = json.bestSellersList;
  if (Array.isArray(bsl)) {
    return bsl;
  }
  if (bsl && typeof bsl === "object" && Array.isArray(bsl.asinList)) {
    return bsl.asinList;
  }
  if (Array.isArray(json.asinList)) {
    return json.asinList;
  }
  return [];
}

export type BestsellersResponse = {
  bestsellers?: string[];
  /** Keepa often returns `{ asinList: string[] }` rather than a bare array. */
  bestSellersList?: string[] | { asinList?: string[] };
  asinList?: string[];
  error?: { message?: string; type?: string };
};

/**
 * Top-selling ASINs for a category (browse node id), ordered by rank (best first).
 */
export async function fetchBestsellerAsins(
  apiKey: string,
  options: {
    domain: number;
    /** Amazon category / browse node id (string of digits). */
    categoryId: string;
    /** Averaging range for rank history (Keepa: 0, 1, 30, 90, 180). */
    range?: number;
    /** Max ASINs to request (Keepa caps at 100 per category). */
    count?: number;
  }
): Promise<string[]> {
  const countRaw =
    options.count != null
      ? Math.min(100, Math.max(1, Math.trunc(options.count)))
      : undefined;
  const params = new URLSearchParams({
    key: apiKey,
    domain: String(options.domain),
    category: options.categoryId.replace(/\D/g, "") || options.categoryId,
    range: String(options.range ?? 30),
  });
  if (countRaw != null) {
    params.set("count", String(countRaw));
  }

  const res = await fetch(`${KEEPA_BASE}/bestsellers?${params}`);
  const json = (await res.json()) as BestsellersResponse;

  if (json.error?.message) {
    throw new Error(
      `Keepa bestsellers: ${json.error.message}${json.error.type ? ` (${json.error.type})` : ""}`
    );
  }
  if (!res.ok) {
    throw new Error(`Keepa bestsellers HTTP ${res.status}`);
  }

  const raw = normalizeBestsellerPayload(json);
  if (!Array.isArray(raw)) {
    return [];
  }

  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") {
      continue;
    }
    const a = x.trim().toUpperCase();
    if (/^[A-Z0-9]{10}$/.test(a)) {
      out.push(a);
    }
  }
  return countRaw != null ? out.slice(0, countRaw) : out.slice(0, 100);
}
