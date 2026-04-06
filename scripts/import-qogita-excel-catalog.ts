/**
 * Stream-import Qogita "Filtered Catalog" Excel exports into `qogita_products`.
 * Stable id: `excel-gtin-{digits}` (no API qid in export).
 *
 * Usage:
 *   npx tsx scripts/import-qogita-excel-catalog.ts [path/to/file.xlsx] [--dry-run] [--mov-gbp=1500]
 *
 * Loads DATABASE_URL from .env.local (required unless --dry-run).
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";

import { getDb } from "@/db";
import { qogitaProducts } from "@/db/schema";
import { normalizeGtin } from "@/lib/qogita/offers";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const DEFAULT_PATH =
  "Filtered_Catalog_Download-X226J8-mov-limit-1500.00.xlsx";

const HEADER_GTIN = "GTIN";
const HEADER_NAME = "Name";

function parseArgs(argv: string[]) {
  let path = resolve(process.cwd(), DEFAULT_PATH);
  let dryRun = false;
  let movGbp: number | null = null;
  const loose: string[] = [];
  for (const a of argv) {
    if (a === "--dry-run") {
      dryRun = true;
    } else if (a.startsWith("--mov-gbp=")) {
      const n = Number.parseFloat(a.slice("--mov-gbp=".length));
      movGbp = Number.isFinite(n) ? n : null;
    } else if (!a.startsWith("-")) {
      loose.push(a);
    }
  }
  if (loose[0]) {
    path = resolve(process.cwd(), loose[0]);
  }
  if (movGbp == null) {
    const m = path.match(/mov-limit-([\d.]+)/i);
    if (m) {
      const n = Number.parseFloat(m[1]);
      movGbp = Number.isFinite(n) ? n : null;
    }
  }
  return { path, dryRun, movGbp };
}

function cellStr(v: unknown): string {
  if (v == null) {
    return "";
  }
  if (typeof v === "string") {
    return v.trim();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  if (v instanceof Date) {
    return v.toISOString();
  }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") {
      return o.text.trim();
    }
    if (Array.isArray(o.richText)) {
      return o.richText
        .map((r) =>
          r && typeof r === "object" && typeof (r as { text?: string }).text === "string"
            ? (r as { text: string }).text
            : ""
        )
        .join("")
        .trim();
    }
    if (typeof o.result === "string") {
      return o.result.trim();
    }
    if (typeof o.hyperlink === "string") {
      return o.hyperlink.trim();
    }
  }
  return "";
}

function cellNum(v: unknown): number | null {
  if (v == null || v === "") {
    return null;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  const s = String(v).replace(/,/g, "").replace(/£\s?/g, "").trim();
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function cellInt(v: unknown): number | null {
  const n = cellNum(v);
  if (n == null) {
    return null;
  }
  return Math.trunc(n);
}

function rowValues(row: ExcelJS.Row): unknown[] {
  const vals = row.values;
  if (!vals || !Array.isArray(vals)) {
    return [];
  }
  return vals.slice(1);
}

function parseHeaders(cells: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  cells.forEach((c, i) => {
    const k = cellStr(c);
    if (k) {
      map.set(k, i);
    }
  });
  return map;
}

function col(
  headers: Map<string, number>,
  cells: unknown[],
  name: string
): unknown {
  const idx = headers.get(name);
  if (idx == null) {
    return undefined;
  }
  return cells[idx];
}

type CatalogRow = {
  qogitaId: string;
  ean: string;
  title: string;
  brand: string | null;
  categorySlug: string | null;
  currency: string;
  buyUnitPrice: string;
  stockUnits: number | null;
  unitsPerPack: number | null;
  minOrderValueOverride: string | null;
  flags: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
};

function buildRow(
  headers: Map<string, number>,
  cells: unknown[],
  movGbp: number | null
): CatalogRow | null {
  const gtinRaw = cellStr(col(headers, cells, HEADER_GTIN));
  const ean = normalizeGtin(gtinRaw);
  if (!ean) {
    return null;
  }
  const title = cellStr(col(headers, cells, HEADER_NAME));
  if (!title) {
    return null;
  }

  const qogitaId = `excel-gtin-${ean}`;
  const brand = cellStr(col(headers, cells, "Brand")) || null;
  const category = cellStr(col(headers, cells, "Category")) || null;
  const priceGbp =
    cellNum(col(headers, cells, "£ Lowest Price inc. shipping")) ?? null;
  if (priceGbp == null || priceGbp < 0) {
    return null;
  }

  const unit = cellInt(col(headers, cells, "Unit"));
  const stock = cellInt(col(headers, cells, "Lowest Priced Offer Inventory"));
  const preorder = cellStr(col(headers, cells, "Is a pre-order?"));
  const deliveryWeeks = cellNum(
    col(headers, cells, "Estimated Delivery Time (weeks)")
  );
  const offerCount = cellInt(col(headers, cells, "Number of Offers"));
  const totalInv = cellInt(
    col(headers, cells, "Total Inventory of All Offers")
  );
  const pl = cellStr(col(headers, cells, "Product Link"));
  const productLink = pl.length > 0 ? pl : null;

  const rawPayload: Record<string, unknown> = {};
  for (const [name, idx] of headers) {
    rawPayload[name] = cells[idx] ?? null;
  }

  return {
    qogitaId,
    ean,
    title,
    brand,
    categorySlug: category,
    currency: "GBP",
    buyUnitPrice: priceGbp.toFixed(4),
    stockUnits: stock,
    unitsPerPack: unit != null && unit > 0 ? unit : null,
    minOrderValueOverride: movGbp != null ? movGbp.toFixed(2) : null,
    flags: {
      source: "qogita_excel_catalog",
      priceIncShipping: true,
      preorder:
        preorder.toLowerCase() === "yes"
          ? true
          : preorder.toLowerCase() === "no"
            ? false
            : null,
      estimatedDeliveryWeeks: deliveryWeeks,
      offerCount,
      totalInventoryAllOffers: totalInv,
      productLink,
    },
    rawPayload,
  };
}

async function streamCatalogRows(
  xlsxPath: string,
  movGbp: number | null
): Promise<{ rows: CatalogRow[]; headerRowNumber: number; errors: string[] }> {
  const rows: CatalogRow[] = [];
  const errors: string[] = [];
  let headers: Map<string, number> | null = null;
  let headerRowNumber = 0;

  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(xlsxPath, {
    worksheets: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    entries: "ignore",
  });

  for await (const worksheet of workbookReader) {
    for await (const row of worksheet) {
      const n = row.number;
      const cells = rowValues(row);

      if (!headers) {
        const texts = cells.map((c) => cellStr(c));
        const joined = texts.join("|").toLowerCase();
        if (joined.includes("gtin") && joined.includes("name")) {
          headers = parseHeaders(cells);
          headerRowNumber = n;
        }
        continue;
      }

      if (n <= headerRowNumber) {
        continue;
      }

      try {
        const rec = buildRow(headers, cells, movGbp);
        if (rec) {
          rows.push(rec);
        }
      } catch (e) {
        errors.push(
          `Row ${n}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    break;
  }

  if (!headers) {
    errors.push(
      'Could not find header row containing "GTIN" and "Name" (first worksheet only).'
    );
  }

  return { rows, headerRowNumber, errors };
}

const BATCH = 150;

async function upsertBatch(
  batch: CatalogRow[],
  dryRun: boolean
): Promise<void> {
  if (dryRun || batch.length === 0) {
    return;
  }
  const db = getDb();
  await db
    .insert(qogitaProducts)
    .values(
      batch.map((r) => ({
        qogitaId: r.qogitaId,
        ean: r.ean,
        title: r.title,
        brand: r.brand,
        categorySlug: r.categorySlug,
        currency: r.currency,
        buyUnitPrice: r.buyUnitPrice,
        stockUnits: r.stockUnits,
        unitsPerPack: r.unitsPerPack,
        minOrderValueOverride: r.minOrderValueOverride,
        flags: r.flags,
        rawPayload: r.rawPayload,
      }))
    )
    .onConflictDoUpdate({
      target: qogitaProducts.qogitaId,
      set: {
        ean: sql`excluded.ean`,
        title: sql`excluded.title`,
        brand: sql`excluded.brand`,
        categorySlug: sql`excluded.category_slug`,
        currency: sql`excluded.currency`,
        buyUnitPrice: sql`excluded.buy_unit_price`,
        stockUnits: sql`excluded.stock_units`,
        unitsPerPack: sql`excluded.units_per_pack`,
        minOrderValueOverride: sql`excluded.min_order_value_override`,
        flags: sql`excluded.flags`,
        rawPayload: sql`excluded.raw_payload`,
        updatedAt: sql`now()`,
      },
    });
}

async function main() {
  const { path: xlsxPath, dryRun, movGbp } = parseArgs(
    process.argv.slice(2)
  );

  console.log(
    JSON.stringify(
      { xlsxPath, dryRun, movGbp, note: "GBP prices include shipping per file disclaimer" },
      null,
      2
    )
  );

  const { rows, headerRowNumber, errors } = await streamCatalogRows(
    xlsxPath,
    movGbp
  );

  for (const e of errors) {
    console.error(e);
  }

  console.log(
    `Parsed ${rows.length} catalog rows (header at Excel row ${headerRowNumber || "?"})`
  );

  if (dryRun) {
    console.log("Dry run — no database writes.");
    if (rows[0]) {
      console.log("Sample:", JSON.stringify(rows[0], null, 2));
    }
    process.exit(errors.length > 0 && !rows.length ? 1 : 0);
    return;
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is not set (.env.local).");
    process.exit(1);
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await upsertBatch(slice, false);
    written += slice.length;
    if (written % (BATCH * 20) === 0 || written === rows.length) {
      console.log(`Upserted ${written} / ${rows.length}`);
    }
  }

  console.log(`Done. Upserted ${rows.length} rows into qogita_products.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
