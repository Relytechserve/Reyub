/**
 * Rough net margin after a flat Amazon referral+FBA-style fee assumption.
 * For dashboard hints only — not tax or accounting advice.
 */
export function estimateAmazonNetMarginPct(input: {
  amazonBuyBoxGbp: number;
  buyUnitEur: number;
  /** Multiply EUR unit cost by this to get GBP (e.g. 0.85). */
  eurToGbp: number;
  /** Combined selling fee + buffer, e.g. 0.15 = 15%. */
  amazonFeePct?: number;
}): number | null {
  const fee = input.amazonFeePct ?? 0.15;
  const buyGbp = input.buyUnitEur * input.eurToGbp;
  const netSell = input.amazonBuyBoxGbp * (1 - fee);
  if (!Number.isFinite(netSell) || netSell <= 0) {
    return null;
  }
  return ((netSell - buyGbp) / netSell) * 100;
}

export function parseGbpToNumber(gbp: string | null | undefined): number | null {
  if (!gbp) {
    return null;
  }
  const n = Number.parseFloat(gbp.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseEurPrice(
  raw: string | null | undefined
): number | null {
  if (!raw) {
    return null;
  }
  const n = Number.parseFloat(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Default when user has not set FX in settings (approximate). */
export const DEFAULT_EUR_TO_GBP = 0.85;
