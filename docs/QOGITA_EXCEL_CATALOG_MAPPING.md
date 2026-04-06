# Qogita filtered catalog (Excel) — column mapping

Reference export: **`Filtered_Catalog_Download-X226J8-mov-limit-1500.00.xlsx`** (sheet **`Catalog`**).

- **Filename hint:** `mov-limit-1500.00` almost certainly means this download was generated with a **minimum order value (MOV) filter of £1,500** (and `X226J8` is likely an internal buyer/export id). Rows are a **subset** of the full catalog, not the whole Qogita universe.
- **Disclaimer row** in file: prices are illustrative; final prices at checkout; inventory can change intraday.

## Header row (row 4, 0-based index 3)

| Excel column | Example | Maps to `qogita_products` / app | Notes |
|--------------|---------|----------------------------------|--------|
| **GTIN** | `5600462906602` | `ean` | Primary key for **Keepa ↔ Qogita** matching in Reyub. |
| **Name** | Andreia Nail Polish… | `title` | |
| **Category** | Nail Polish | `categorySlug` *or* display-only | API often uses slugs; this is **human label** — may need `categorySourceMappings` or fuzzy category bridge. |
| **Brand** | Andreia | `brand` | Also used in **title fuzzy matching** brand gate. |
| **£ Lowest Price inc. shipping** | `1.68` | `buyUnitPrice` + **`currency: GBP`** | **Not equivalent** to API `extractMoney()` rows, which are often **EUR** and may be **ex-shipping**. Do not mix Excel GBP and API EUR in one margin column without explicit conversion and a “price basis” label. |
| **Unit** | `1` | `unitsPerPack` (if confirmed) | Confirm with Qogita whether this is **units per line** or **case multiplier**; sample data looks like `1` for single unit. |
| **Lowest Priced Offer Inventory** | `4` | `stockUnits` | Stock tied to **lowest-price offer**, not total. |
| **Is a pre-order?** | Yes / No | New field or `flags.preorder` | Useful to **down-rank or filter** sourcing opportunities. |
| **Estimated Delivery Time (weeks)** | `6` | New field or `flags.estimatedDeliveryWeeks` | Pre-order / slow lines. |
| **Number of Offers** | `12` | `flags.offerCount` | Liquidity / competition on Qogita side. |
| **Total Inventory of All Offers** | `5473` | `flags.totalInventoryAllOffers` | Different from single-offer stock. |
| **Product Link** | (often empty in sample) | `flags.productLink` or ignore | Populate if present in full export. |

## Gaps vs API ingest (`mapOfferToRow`)

| API / DB need | Excel |
|---------------|--------|
| **`qogitaId` (required)** | **Missing.** There is no stable Qogita offer `qid` in this export. Any Excel import must use a **synthetic id** (e.g. `excel-gtin-{GTIN}`) or merge later when the same row appears from the API. |
| **Raw JSON** | N/A — store a JSON row wrapper in `rawPayload` for traceability. |

## Product manager recommendations

1. **Use this file as the “golden list” for GTIN coverage** when the Buyer API returns few rows — import fills `qogita_products.ean` for matching even before API parity.
2. **Treat “£ inc. shipping” as a separate price channel** in the UI (e.g. “Catalog export (GBP, inc. ship)”) so it is not confused with live API quotes.
3. **Filter pre-orders** in `/dashboard/sourcing` once `Is a pre-order?` is ingested.
4. **Re-download** after changing MOV or filters; document MOV in user settings if you want capital planning to respect **minimum cart value**.

## Import into Postgres (`qogita_products`)

Place the `.xlsx` in the project root (default filename) or pass a path. Requires `DATABASE_URL` in `.env.local`.

```bash
# Preview (no DB writes)
npm run import:qogita-excel:dry

# Upsert all rows (streaming; safe to re-run)
npm run import:qogita-excel

# Custom path and MOV metadata
npx tsx scripts/import-qogita-excel-catalog.ts ./path/to/catalog.xlsx --mov-gbp=1500
```

- **`qogita_id`:** `excel-gtin-{GTIN}` — distinct from live API ids, so API sync can add/update **different** rows for the same product until you dedupe.
- **`min_order_value_override`:** Set from filename `mov-limit-…` or `--mov-gbp=`.

## GTIN match precedence (Keepa ↔ Qogita)

When the same normalized GTIN appears on **both** a live API offer row and an Excel import row (`excel-gtin-{GTIN}`), Reyub’s GTIN index (`buildGtinToQogitaIdMap` in `lib/matching/amazon-qogita-sync.ts`) **prefers the live API row**. If only the Excel row exists for that GTIN, it uses Excel. **Within** each of those two groups (API-only or Excel-only), the row with the **lowest** parsed `buyUnitPrice` wins (same as multi-supplier tie-break).

## How this file was shared

The spreadsheet was read from the user’s local path (e.g. Downloads). For future updates, either copy a fresh export under `reference/` (gitignored) or paste **headers + 5 sample rows** into a ticket/chat.
