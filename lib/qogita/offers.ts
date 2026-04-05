import { qogitaFetch } from "@/lib/qogita/client";

const BASE = "https://api.qogita.com";

/** First path segment for offers (override e.g. `/offers/?category=…` if API supports it). */
export function qogitaOffersEntryPath(): string {
  const raw = process.env.QOGITA_OFFERS_PATH?.trim();
  if (!raw) {
    return "/offers/";
  }
  const p = raw.startsWith("/") ? raw : `/${raw}`;
  return p.includes("?") ? p : p.endsWith("/") ? p : `${p}/`;
}

/** Pull offers (paginated when API provides next / page). */
export async function fetchOffersUpTo(maxOffers: number): Promise<unknown[]> {
  const collected: unknown[] = [];
  let path = qogitaOffersEntryPath();
  let page = 1;
  /** Enough pages for large syncs (e.g. 2000 offers at ~20/page ≈ 100 requests). */
  const maxPages = Math.min(
    500,
    Math.max(25, Math.ceil(maxOffers / 20))
  );

  for (let i = 0; i < maxPages && collected.length < maxOffers; i++) {
    const res = await qogitaFetch(path);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Qogita GET ${path} failed (${res.status}): ${text.slice(0, 400)}`
      );
    }
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Qogita offers: invalid JSON from ${path}`);
    }

    const batch = extractItems(data);
    collected.push(...batch);

    const nextPath = resolveNextPath(data, res.headers.get("link"), path, page);
    if (!nextPath || batch.length === 0) {
      break;
    }
    path = nextPath;
    page += 1;
  }

  return collected.slice(0, maxOffers);
}

function extractItems(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of ["results", "data", "offers", "items"]) {
      const arr = o[k];
      if (Array.isArray(arr)) {
        return arr;
      }
    }
  }
  return [];
}

function resolveNextPath(
  data: unknown,
  linkHeader: string | null,
  currentPath: string,
  page: number
): string | null {
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (o.next === null || o.next === false) {
      return null;
    }
    if (typeof o.next === "string") {
      if (o.next.startsWith("http")) {
        return o.next.startsWith(BASE)
          ? o.next.slice(BASE.length)
          : o.next;
      }
      return o.next.startsWith("/") ? o.next : `/${o.next}`;
    }
  }

  if (linkHeader) {
    const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
    if (m?.[1]) {
      const href = m[1];
      return href.startsWith(BASE) ? href.slice(BASE.length) : href;
    }
  }

  if (currentPath.includes("page=")) {
    return currentPath.replace(/page=\d+/, `page=${page + 1}`);
  }
  const sep = currentPath.includes("?") ? "&" : "?";
  return `${currentPath}${sep}page=${page + 1}`;
}

export function normalizeGtin(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length >= 8 && d.length <= 14) {
    return d;
  }
  return null;
}

/** Map one API offer object into DB row fields (best-effort; Qogita payload may vary). */
export function mapOfferToRow(offer: unknown): {
  qogitaId: string;
  ean: string | null;
  title: string;
  brand: string | null;
  categorySlug: string | null;
  currency: string;
  buyUnitPrice: string | null;
  stockUnits: number | null;
  rawPayload: unknown;
} | null {
  if (!offer || typeof offer !== "object") {
    return null;
  }
  const o = offer as Record<string, unknown>;

  const qogitaId = pickQogitaId(o);
  if (!qogitaId) {
    return null;
  }

  const ean =
    findGtin(o) ||
    normalizeGtinFromUnknown(o.gtin) ||
    normalizeGtinFromUnknown(o.ean) ||
    normalizeGtinFromUnknown(nestedValue(o, ["variant", "gtin"])) ||
    normalizeGtinFromUnknown(nestedValue(o, ["variant", "ean"])) ||
    normalizeGtinFromUnknown(nestedValue(o, ["product", "gtin"])) ||
    normalizeGtinFromUnknown(nestedValue(o, ["product", "ean"])) ||
    normalizeGtinFromUnknown(nestedValue(o, ["sku", "gtin"]));

  const title =
    stringFrom(o, ["title", "name", "product_name"]) ||
    nestedString(o, ["title", "name"]) ||
    `Offer ${qogitaId}`;

  const brand =
    stringFrom(o, ["brand", "brand_name"]) || nestedString(o, ["brand"]);

  const categorySlug =
    typeof o.category === "string"
      ? o.category
      : typeof o.category_slug === "string"
        ? o.category_slug
        : nestedString(o, ["slug", "category_slug"]);

  const { amount, currency } = extractMoney(o);

  const stock =
    numberFrom(o, [
      "available_quantity",
      "stock",
      "quantity",
      "inventory",
      "available",
    ]) ?? nestedNumber(o, ["available_quantity", "stock", "quantity"]);

  return {
    qogitaId,
    ean,
    title,
    brand,
    categorySlug,
    currency: (currency || "EUR").slice(0, 8).toUpperCase(),
    buyUnitPrice: amount,
    stockUnits: stock,
    rawPayload: offer,
  };
}

function pickQogitaId(o: Record<string, unknown>): string | null {
  const keys = [
    o.qid,
    o.id,
    o.uuid,
    o.offer_qid,
    o.offer_id,
    nestedValue(o, ["variant", "qid"]),
    nestedValue(o, ["variant", "id"]),
    nestedValue(o, ["line", "qid"]),
  ];
  for (const v of keys) {
    if (typeof v === "string" && v.length > 0) {
      return v;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      return String(v);
    }
  }
  return null;
}

function normalizeGtinFromUnknown(v: unknown): string | null {
  if (typeof v === "string") {
    return normalizeGtin(v);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return normalizeGtin(String(Math.trunc(v)));
  }
  return null;
}

function nestedValue(
  o: Record<string, unknown>,
  path: string[]
): unknown {
  let cur: unknown = o;
  for (const p of path) {
    if (!cur || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function findGtin(o: Record<string, unknown>): string | null {
  const stack: unknown[] = [o];
  let guard = 0;
  while (stack.length && guard++ < 100) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") {
      continue;
    }
    if (Array.isArray(cur)) {
      for (const x of cur) {
        stack.push(x);
      }
      continue;
    }
    const rec = cur as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      const kl = k.toLowerCase();
      const isBarcodeKey =
        kl === "gtin" ||
        kl === "ean" ||
        kl === "upc" ||
        kl.endsWith("_gtin") ||
        kl.endsWith("_ean") ||
        kl.includes("barcode") ||
        kl === "international_article_number" ||
        kl === "article_number";
      if (isBarcodeKey) {
        const n = normalizeGtinFromUnknown(v);
        if (n) {
          return n;
        }
      }
      if (v && typeof v === "object") {
        stack.push(v);
      }
    }
  }
  return null;
}

function stringFrom(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return null;
}

function nestedString(o: Record<string, unknown>, keys: string[]): string | null {
  const stack: unknown[] = [o];
  let guard = 0;
  while (stack.length && guard++ < 80) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") {
      continue;
    }
    if (Array.isArray(cur)) {
      for (const x of cur) {
        stack.push(x);
      }
      continue;
    }
    const rec = cur as Record<string, unknown>;
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === "string" && v.trim()) {
        return v.trim();
      }
    }
    for (const v of Object.values(rec)) {
      if (v && typeof v === "object") {
        stack.push(v);
      }
    }
  }
  return null;
}

function numberFrom(
  o: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return Math.max(0, Math.floor(v));
    }
  }
  return null;
}

function nestedNumber(
  o: Record<string, unknown>,
  keys: string[]
): number | null {
  const stack: unknown[] = [o];
  let guard = 0;
  while (stack.length && guard++ < 80) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") {
      continue;
    }
    if (Array.isArray(cur)) {
      for (const x of cur) {
        stack.push(x);
      }
      continue;
    }
    const rec = cur as Record<string, unknown>;
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        return Math.max(0, Math.floor(v));
      }
    }
    for (const v of Object.values(rec)) {
      if (v && typeof v === "object") {
        stack.push(v);
      }
    }
  }
  return null;
}

function extractMoney(o: Record<string, unknown>): {
  amount: string | null;
  currency: string | null;
} {
  const stack: unknown[] = [o];
  let guard = 0;
  while (stack.length && guard++ < 100) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") {
      continue;
    }
    if (Array.isArray(cur)) {
      for (const x of cur) {
        stack.push(x);
      }
      continue;
    }
    const rec = cur as Record<string, unknown>;
    if ("amount" in rec) {
      const amt = rec.amount;
      const curCode = rec.currency;
      if (typeof amt === "number" && Number.isFinite(amt)) {
        return {
          amount: amt.toFixed(4),
          currency: typeof curCode === "string" ? curCode : null,
        };
      }
      if (typeof amt === "string" && amt.trim()) {
        return {
          amount: amt.trim(),
          currency: typeof curCode === "string" ? curCode : null,
        };
      }
    }
    if (typeof rec.unit_price === "number" && Number.isFinite(rec.unit_price)) {
      return {
        amount: rec.unit_price.toFixed(4),
        currency:
          typeof rec.currency === "string" ? rec.currency : null,
      };
    }
    if (typeof rec.price === "number" && Number.isFinite(rec.price)) {
      return {
        amount: rec.price.toFixed(4),
        currency:
          typeof rec.currency === "string" ? rec.currency : null,
      };
    }
    for (const v of Object.values(rec)) {
      if (v && typeof v === "object") {
        stack.push(v);
      }
    }
  }
  return { amount: null, currency: null };
}
