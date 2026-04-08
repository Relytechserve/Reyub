import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";

import { getDb } from "@/db";
import { qogitaProducts } from "@/db/schema";
import { normalizeGtin } from "@/lib/qogita/offers";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const DEFAULT_PATH = "Filtered_Catalog_Download-X226J8.xlsx";

function parseArgs(argv: string[]): { path: string; dryRun: boolean } {
  let path = resolve(process.cwd(), DEFAULT_PATH);
  let dryRun = false;
  for (const a of argv) {
    if (a === "--dry-run") {
      dryRun = true;
    } else if (!a.startsWith("-")) {
      path = resolve(process.cwd(), a);
    }
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
    if (typeof o.result === "string") {
      const t = o.result.trim();
      if (t.startsWith("http://") || t.startsWith("https://")) return t;
    }
  }
  return null;
}

function rowValues(row: ExcelJS.Row): unknown[] {
  const vals = row.values;
  if (!vals || !Array.isArray(vals)) return [];
  return vals.slice(1);
}

type LinkRow = { qogitaId: string; productLink: string };

async function parseRows(xlsxPath: string): Promise<LinkRow[]> {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(xlsxPath, {
    worksheets: "emit",
    sharedStrings: "cache",
    styles: "ignore",
    entries: "ignore",
  });
  const out: LinkRow[] = [];
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
      const gtinRaw = cells[header.get("GTIN") ?? -1];
      const linkRaw = cells[header.get("Product Link") ?? -1];
      const ean = normalizeGtin(cellStr(gtinRaw));
      const link = cellUrl(linkRaw);
      if (!ean || !link) continue;
      out.push({ qogitaId: `excel-gtin-${ean}`, productLink: link });
    }
    break;
  }
  return out;
}

async function main() {
  const { path, dryRun } = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is not set (.env.local).");
  }
  const rows = await parseRows(path);
  const unique = new Map<string, string>();
  for (const r of rows) unique.set(r.qogitaId, r.productLink);

  console.log(
    JSON.stringify(
      { xlsxPath: path, parsedRows: rows.length, uniqueRows: unique.size, dryRun },
      null,
      2
    )
  );
  if (dryRun) return;

  const db = getDb();
  let updated = 0;
  let missing = 0;
  for (const [qogitaId, productLink] of unique) {
    const [existing] = await db
      .select({ id: qogitaProducts.id, flags: qogitaProducts.flags })
      .from(qogitaProducts)
      .where(eq(qogitaProducts.qogitaId, qogitaId))
      .limit(1);
    if (!existing) {
      missing += 1;
      continue;
    }
    const flags =
      existing.flags && typeof existing.flags === "object"
        ? (existing.flags as Record<string, unknown>)
        : {};
    await db
      .update(qogitaProducts)
      .set({
        flags: { ...flags, productLink },
        updatedAt: new Date(),
      })
      .where(eq(qogitaProducts.id, existing.id));
    updated += 1;
    if (updated % 5000 === 0) {
      console.log(`Updated ${updated} links...`);
    }
  }
  console.log(`Done. Updated=${updated}, missing_qogita_ids=${missing}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
