import { EXCEL_CATALOG_QOGITA_ID_PREFIX } from "@/lib/matching/amazon-qogita-sync";

function isQogitaHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "qogita.com" || host.endsWith(".qogita.com");
}

function parseAbsoluteHttpUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readProductLink(flags: unknown): string | null {
  if (!flags || typeof flags !== "object") {
    return null;
  }
  const maybe = (flags as Record<string, unknown>).productLink;
  if (typeof maybe !== "string") {
    return null;
  }
  const trimmed = maybe.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = parseAbsoluteHttpUrl(trimmed);
  if (!parsed) {
    return null;
  }
  if (!isQogitaHost(parsed.hostname)) {
    return null;
  }
  return parsed.toString();
}

export function isValidQogitaUrl(url: string | null | undefined): boolean {
  const value = url?.trim();
  if (!value) {
    return false;
  }
  const parsed = parseAbsoluteHttpUrl(value);
  if (!parsed) {
    return false;
  }
  return isQogitaHost(parsed.hostname);
}

/**
 * Build a stable Qogita URL for a matched product.
 * Excel-imported rows use synthetic ids (`excel-gtin-*`), so we search by EAN.
 */
export function buildQogitaProductUrl(input: {
  qogitaId: string;
  ean: string | null;
  flags: unknown;
}): string | null {
  const explicit = readProductLink(input.flags);
  if (explicit) {
    return explicit;
  }
  // Qogita's public search endpoints currently resolve to 404 for our generated queries.
  // To preserve integrity, only emit verified product links from source payloads.
  const qid = input.qogitaId.trim();
  if (qid.startsWith(EXCEL_CATALOG_QOGITA_ID_PREFIX)) {
    return null;
  }
  return null;
}
