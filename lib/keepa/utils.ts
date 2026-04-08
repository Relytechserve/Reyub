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

const AMAZON_IMAGE_BASE = "https://images-na.ssl-images-amazon.com/images/I/";

function toImageUrlFromKeepaKey(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const key = raw.trim();
  if (!key) {
    return null;
  }
  if (key.startsWith("http://") || key.startsWith("https://")) {
    return key;
  }
  return `${AMAZON_IMAGE_BASE}${key}`;
}

/** Primary image URL + normalized image list from Keepa payload. */
export function keepaImageUrlsFromProduct(p: KeepaProduct): {
  primaryImageUrl: string | null;
  imageUrls: string[];
} {
  const out: string[] = [];
  const push = (v: unknown) => {
    const url = toImageUrlFromKeepaKey(v);
    if (!url || out.includes(url)) {
      return;
    }
    out.push(url);
  };

  if (typeof p.imagesCSV === "string") {
    for (const key of p.imagesCSV.split(",")) {
      push(key);
    }
  }
  if (Array.isArray(p.imagesCSV)) {
    for (const key of p.imagesCSV) {
      push(key);
    }
  }
  if (Array.isArray(p.images)) {
    for (const x of p.images) {
      push(x);
    }
  }

  return {
    primaryImageUrl: out[0] ?? null,
    imageUrls: out,
  };
}
