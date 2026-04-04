import type { KeepaProduct } from "@/lib/keepa/product";

/** Barcodes from Keepa product (EAN/UPC list). */
export function keepaEansFromProduct(p: KeepaProduct): string[] {
  const raw = p.eanList;
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x).replace(/\D/g, ""))
      .filter((d) => d.length >= 8 && d.length <= 14);
  }
  if (typeof p.ean === "string") {
    const d = p.ean.replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 14) {
      return [d];
    }
  }
  return [];
}

export function normalizeAsin(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(t) ? t : null;
}
