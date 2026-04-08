import { config } from "dotenv";
import { resolve } from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";
import ExcelJS from "exceljs";

import { getDb } from "@/db";
import { productMatches, qogitaProducts } from "@/db/schema";
import { normalizeGtin } from "@/lib/qogita/offers";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const DEFAULT_PATH = "Filtered_Catalog_Download-X226J8.xlsx";

function parseArgs(argv: string[]): { path: string; dryRun: boolean } {
  let path = resolve(process.cwd(), DEFAULT_PATH);
  let dryRun = false;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (!a.startsWith("-")) path = resolve(process.cwd(), a);
  }
  return { path, dryRun };
}

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.result === "string") return o.result.trim();
  }
  return "";
}

function cellUrl(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("http://") || t.startsWith("https://")) return t;
    return null;
  }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o.hyperlink === "string") {
      const t = o.hyperlink.trim();
      if (t.startsWith("http://") || t.startsWith("https://")) return t;
    }
    if (typeof o.formula === "string") {
      const m = o.formula.match(/HYPERLINK\(\s*"([^"]+)"/i);
      if (m?.[1]) {
        const t = m[1].trim();
        if (t.startsWith("http://") || t.startsWith("https://")) return t;
      }
    }
  }
  return null;
}

function rowValues(row: ExcelJS.Row): unknown[] {
  const vals = row.values;
  if (!vals || !Array.isArray(vals)) return [];
  return vals.slice(1);
}

async function buildLinkMap(xlsxPath: string): Promise<Map<string, string>> {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(xlsxPath, {
    worksheets: "emit",
    sharedStrings: "cache",
    styles: "ignore",
    entries: "ignore",
  });
  const out = new Map<string, string>();
  let header: Map<string, number> | null = null;
  for await (const ws of wb) {
    for await (const row of ws) {
      const cells = rowValues(row);
      if (!header) {
        const map = new Map<string, number>();
        cells.forEach((c, i) => {
          const k = cellStr(c);
          if (k) map.set(k, i);
        });
        if (map.has("GTIN") && map.has("Product Link")) {
          header = map;
        }
        continue;
      }
      const ean = normalizeGtin(cellStr(cells[header.get("GTIN") ?? -1]));
      const link = cellUrl(cells[header.get("Product Link") ?? -1]);
      if (!ean || !link) continue;
      out.set(`excel-gtin-${ean}`, link);
    }
    break;
  }
  return out;
}

async function main() {
  const { path, dryRun } = parseArgs(process.argv.slice(2));
  const linkMap = await buildLinkMap(path);
  const db = getDb();

  const matched = await db
    .select({
      id: qogitaProducts.id,
      qogitaId: qogitaProducts.qogitaId,
      flags: qogitaProducts.flags,
    })
    .from(productMatches)
    .innerJoin(qogitaProducts, eq(qogitaProducts.id, productMatches.qogitaProductId))
    .where(
      and(eq(productMatches.channel, "amazon_uk"), isNotNull(productMatches.qogitaProductId))
    );

  let candidates = 0;
  let updated = 0;
  for (const row of matched) {
    const link = linkMap.get(row.qogitaId);
    if (!link) continue;
    candidates += 1;
    if (dryRun) continue;
    const flags =
      row.flags && typeof row.flags === "object"
        ? (row.flags as Record<string, unknown>)
        : {};
    await db
      .update(qogitaProducts)
      .set({
        flags: { ...flags, productLink: link },
        updatedAt: new Date(),
      })
      .where(eq(qogitaProducts.id, row.id));
    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        xlsxPath: path,
        matchedRows: matched.length,
        linkCandidates: candidates,
        updated,
        dryRun,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
