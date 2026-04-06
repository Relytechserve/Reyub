# Reyub

Sourcing insights for sellers buying on **Qogita** and reselling on **Amazon** (via Keepa) and **eBay UK**.

- **Living requirements:** [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md) — update this file as the product evolves.
- **Sourcing product spec (matching ladder, economics, AI build roles):** [docs/SOURCING_INSIGHTS_PRD.md](./docs/SOURCING_INSIGHTS_PRD.md)
- **Stack:** Next.js (App Router), Vercel, Neon Postgres, Drizzle ORM, Auth.js (credentials), Resend (email, later).

## Prerequisites

- Node.js 20+
- A [Neon](https://neon.tech) database (or any Postgres URL compatible with `@neondatabase/serverless`)

## Local setup

1. Copy environment variables:

   ```bash
   cp .env.example .env.local
   ```

2. Set `DATABASE_URL`, `AUTH_SECRET`, and `NEXTAUTH_URL` in `.env.local`.

   - **`AUTH_SECRET`** — A long random string used by [Auth.js](https://authjs.dev) to sign and encrypt session tokens and cookies. It is **not** your password. Generate one locally and never commit it:
     ```bash
     openssl rand -base64 32
     ```
   - **`DATABASE_URL`** — Must live in `.env.local`. Drizzle CLI (`npm run db:push`) loads `.env.local` via `drizzle.config.ts` (not only `.env`).

3. Apply the database schema:

   ```bash
   npm run db:push
   ```

   Or apply SQL migrations under `drizzle/migrations/` (e.g. `0001_*` adds the **global catalog** tables and MVP category seeds) with your migration runner / `npm run db:migrate`.

4. Run the app:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), register the first account, and sign in.

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run db:generate` | Generate Drizzle migrations from `db/schema.ts` |
| `npm run db:push` | Push schema to the database (dev-friendly) |
| `npm run db:studio` | Drizzle Studio |
| `npm run qogita:auth` | Test Qogita login (uses `.env.local`; prints token length only) |
| `npm run import:qogita-excel` | Upsert Qogita **filtered catalog** `.xlsx` into `qogita_products` (streaming; default path = repo root export) |
| `npm run import:qogita-excel:dry` | Parse-only; no DB writes |
| `npm run verify:sourcing` | QA verification for sourcing data structure + computed-field coverage threshold |

### Qogita + Keepa sync

The pipeline **persists both sides in Postgres**, then **matches in the database** on EAN/GTIN:

1. **Qogita** — `GET /offers/` (or `QOGITA_OFFERS_PATH`) → paginated upsert into **`qogita_products`** (your wholesale catalog for matching). **Capped mode** uses **`QOGITA_SYNC_MAX_OFFERS`**. **Full-catalog mode** (`QOGITA_SYNC_FULL_CATALOG=1`) keeps paging until the API has no `next` page or **`QOGITA_SYNC_MAX_ROWS_SAFETY`** / **`QOGITA_SYNC_MAX_PAGES`** is hit — best run via **`npm run sync:pipeline`** locally or a long timeout, since serverless routes may time out on huge feeds. Optional **`QOGITA_SYNC_PAGE_DELAY_MS`** spaces out requests.
2. **Keepa** — [bestsellers](https://keepa.com/#!api) for each browse node (up to **100 ASINs per node**), then [product](https://keepa.com/#!discuss/t/request-products/110) for those ASINs → upserts **`keepa_catalog_items`** (Amazon demand signal). **Subcategory expansion is on by default**: the app resolves **child** browse nodes from **`KEEPA_BESTSELLER_CATEGORY_IDS`** via the [Keepa category API](https://keepa.com/#!api) so you are not stuck at ~100 ASINs when you only configure one parent (e.g. UK Fragrances `118457031`). Set **`KEEPA_BESTSELLER_EXPAND_CHILDREN=0`** to disable (saves tokens). Optional **`KEEPA_BESTSELLER_EXPAND_DEPTH=2`** goes one level deeper if you still see a small catalog. Tune **`KEEPA_BESTSELLER_MAX_CATEGORIES`**, **`KEEPA_BESTSELLER_TARGET_ASINS`**, and **`KEEPA_BESTSELLERS_PER_CATEGORY`** (max 100) for breadth vs token cost. **Batch across runs** with **`KEEPA_BESTSELLER_CATEGORY_SLICE_OFFSET`** + **`KEEPA_BESTSELLER_CATEGORY_SLICE_LENGTH`** (a window over the expanded node list). **`KEEPA_PRODUCT_BATCH_DELAY_MS`** pauses between each 100-ASIN product request.
3. **Match** — **`product_matches`** links each ASIN to **`qogita_products`**: **GTIN ladder** (all barcodes on the Keepa product + UPC/EAN-13 variants), then optional **title token similarity** (see `docs/SOURCING_INSIGHTS_PRD.md`). Each run appends **`price_snapshots`**.

Dashboard: **Sync Qogita + Keepa (UK)** runs the same flow. **Sourcing opportunities** (`/dashboard/sourcing`) lists linked SKUs with estimated margin and £/unit profit. The **Top 20** table joins Qogita via **`product_matches`** (not raw EAN equality on the Keepa row alone). Optional **margin**: `?margin=1&min=10` or the on-page checkbox.

**Env (required for full pipeline):** `QOGITA_EMAIL` + `QOGITA_PASSWORD` (or `QOGITA_API_TOKEN`), `KEEPA_API_KEY`, and **`KEEPA_BESTSELLER_CATEGORY_IDS`**. Optional: `KEEPA_DOMAIN` (default UK `2`), **`KEEPA_BESTSELLER_EXPAND_CHILDREN`** (default expansion on; set `0` to disable), **`KEEPA_BESTSELLER_EXPAND_DEPTH`**, **`KEEPA_MAX_CATEGORY_API_FETCHES`**, **`KEEPA_BESTSELLER_MAX_CATEGORIES`**, **`KEEPA_BESTSELLER_TARGET_ASINS`**, **`KEEPA_BESTSELLER_CATEGORY_SLICE_OFFSET`**, **`KEEPA_BESTSELLER_CATEGORY_SLICE_LENGTH`**, **`KEEPA_PRODUCT_BATCH_DELAY_MS`**, `KEEPA_BESTSELLERS_PER_CATEGORY` (≤100), `KEEPA_BESTSELLER_RANGE`, **`KEEPA_PRODUCT_INCLUDE_HISTORY`** / **`KEEPA_HISTORY_DAYS`**, **`QOGITA_SYNC_MAX_OFFERS`** (capped mode; defaults **2000** if unset), **`QOGITA_SYNC_FULL_CATALOG`**, **`QOGITA_SYNC_MAX_PAGES`**, **`QOGITA_SYNC_MAX_ROWS_SAFETY`**, **`QOGITA_SYNC_PAGE_DELAY_MS`**, **`QOGITA_OFFERS_PATH`** (e.g. fragrance filter if the Buyer API supports it).

**CLI:** `npm run sync:pipeline` loads `.env.local` and runs one full sync (same as dashboard/cron).

### Runbook: Refresh catalog + sync + validate

Run this exact operator sequence after receiving a new Qogita Excel export:

```bash
# 1) Import the latest filtered catalog (default filename in repo root)
npm run import:qogita-excel

# 2) Run full Qogita + Keepa + matching pipeline
npm run sync:pipeline

# 3) Validate end-to-end data quality for sourcing portal
npm run verify:sourcing

# Optional: tighten/relax computed-field coverage threshold (default 0.7)
npm run verify:sourcing -- --min-computed-coverage=0.8
```

- Cron: `GET /api/cron/sync` (optional `CRON_SECRET`).
- Schema: `npm run db:push` (or migrations under `drizzle/migrations/`, including **`keepa_catalog_items`**).
- **Pipeline diagnostics** on the dashboard reads **`sync_runs`** (offers pulled, Keepa rows saved, errors).
- Verification behavior:
  - **Hard fail (structural):** missing `productMatchId`, `asin`, `qogitaId`, invalid match confidence, or no sourcing rows.
  - **Coverage quality gate (computed fields):** margin/profit must be finite for at least **70%** of checked top rows by default.
  - Output includes coverage stats like `computed_coverage=14/20 (70.0%), threshold=70.0%` and a sample of ASINs missing computed fields.
  - Tune threshold with CLI `--min-computed-coverage=0.7` or env var `MIN_COMPUTED_COVERAGE` (alias: `VERIFY_SOURCING_MIN_COMPUTED_COVERAGE`).

### Qogita API token

The Buyer API issues tokens via **`POST https://api.qogita.com/auth/login/`** with `email` and `password` ([API reference](https://qogita.readme.io/reference/auth_login_create)). This app **does not require you to paste a token by hand**: set **`QOGITA_EMAIL`** and **`QOGITA_PASSWORD`** in `.env.local` and Vercel; server code calls `getQogitaAccessToken()` in `lib/qogita/auth.ts`, which logs in and caches the access token until it expires.

Optional **`QOGITA_API_TOKEN`** overrides login if you want to pin a token yourself (advanced).

## Cron (daily sync)

`vercel.json` schedules `GET /api/cron/sync` at **07:00 UTC** (adjust schedule or use Vercel project timezone as needed). Set optional `CRON_SECRET` and send `Authorization: Bearer <CRON_SECRET>` for non-Vercel callers.

The handler runs the same **Qogita + Keepa** sync as the dashboard (`runQogitaKeepaSync`), updating the **global catalog** (`canonical_products`, `product_external_refs`, `product_category_links`) and `product_matches` / `price_snapshots`.

## Repository

Remote: [github.com/Relytechserve/Reyub](https://github.com/Relytechserve/Reyub)

```bash
git remote add origin https://github.com/Relytechserve/Reyub.git
git push -u origin main
```
