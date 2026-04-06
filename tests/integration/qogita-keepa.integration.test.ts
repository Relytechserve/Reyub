/**
 * Live integration tests against Qogita and Keepa.
 * Skips automatically when the corresponding env vars are missing (e.g. CI without secrets).
 *
 * Run: npm run test:integration
 * Requires: .env.local with credentials (see .env.example). Never commit .env.local.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/db";
import { getQogitaAccessToken } from "@/lib/qogita/auth";
import {
  fetchOfferPages,
  mapOfferToRow,
  qogitaOffersEntryPath,
} from "@/lib/qogita/offers";
import { fetchDirectChildCategoryIds } from "@/lib/keepa/category";
import { fetchBestsellerAsins } from "@/lib/keepa/bestsellers";
import { KEEPA_DOMAIN_UK } from "@/lib/keepa/product";

const hasQogitaAuth =
  Boolean(process.env.QOGITA_API_TOKEN?.trim()) ||
  (Boolean(process.env.QOGITA_EMAIL?.trim()) &&
    Boolean(process.env.QOGITA_PASSWORD?.trim()));

const hasKeepa = Boolean(process.env.KEEPA_API_KEY?.trim());
const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());

describe.skipIf(!hasQogitaAuth)("Qogita Buyer API (integration)", () => {
  it("obtains an access token", async () => {
    const token = await getQogitaAccessToken();
    expect(token.length).toBeGreaterThan(20);
  });

  it("fetches offer pages from the configured path", async () => {
    const pathUsed = qogitaOffersEntryPath();
    expect(pathUsed.startsWith("/")).toBe(true);

    const { items, pagesFetched } = await fetchOfferPages({
      maxPages: 5,
      maxItems: 150,
    });

    expect(pagesFetched).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(items)).toBe(true);

    if (items.length > 0) {
      const row = mapOfferToRow(items[0]);
      expect(row).not.toBeNull();
      expect(row?.qogitaId?.length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!hasKeepa)("Keepa API (integration)", () => {
  const key = process.env.KEEPA_API_KEY!.trim();
  const domain =
    Number(process.env.KEEPA_DOMAIN?.trim()) || KEEPA_DOMAIN_UK;
  const categoryRoot =
    process.env.KEEPA_BESTSELLER_CATEGORY_IDS?.split(",")[0]?.trim() ||
    "118457031";

  it("returns child browse nodes for the configured root category", async () => {
    const children = await fetchDirectChildCategoryIds(
      key,
      domain,
      categoryRoot
    );
    expect(Array.isArray(children)).toBe(true);
  });

  it("returns up to N bestseller ASINs for that browse node", async () => {
    const asins = await fetchBestsellerAsins(key, {
      domain,
      categoryId: categoryRoot,
      range: 30,
      count: 15,
    });
    expect(asins.length).toBeLessThanOrEqual(100);
    for (const a of asins) {
      expect(a).toMatch(/^[A-Z0-9]{10}$/);
    }
  });
});

describe.skipIf(!hasDatabase)("Neon / Postgres (integration)", () => {
  it("executes a simple query via Drizzle", async () => {
    const db = getDb();
    const result = await db.execute(sql`select 1::int as n`);
    const rowList = Array.isArray(result)
      ? result
      : ((result as { rows?: unknown[] }).rows ?? []);
    expect(rowList.length).toBeGreaterThanOrEqual(1);
    const first = rowList[0] as Record<string, unknown>;
    expect(Number(first.n)).toBe(1);
  });
});

describe("integration harness", () => {
  it("always runs (confirms Vitest is wired)", () => {
    expect(1 + 1).toBe(2);
  });
});
