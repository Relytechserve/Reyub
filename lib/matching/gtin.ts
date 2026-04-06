/** Digit-only GTIN / EAN / UPC variants for cross-feed lookup. */

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Expansion rules (conservative):
 * - 12-digit UPC-A ↔ try leading-zero EAN-13
 * - 13-digit with leading zero ↔ try 12-digit tail
 */
export function expandGtinLookupKeys(normalizedDigits: string): string[] {
  const s = normalizedDigits;
  if (!s || s.length < 8 || s.length > 14) {
    return [];
  }
  const out = new Set<string>([s]);
  if (s.length === 12) {
    out.add(`0${s}`);
  }
  if (s.length === 13 && s.startsWith("0")) {
    out.add(s.slice(1));
  }
  return [...out];
}

export function collectGtinKeysFromBarcode(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  const d = digitsOnly(raw);
  if (d.length < 8 || d.length > 14) {
    return [];
  }
  return expandGtinLookupKeys(d);
}
