# Reyub

Sourcing insights for sellers buying on **Qogita** and reselling on **Amazon** (via Keepa) and **eBay UK**.

- **Living requirements:** [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md) — update this file as the product evolves.
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

### Qogita + Keepa sync

The pipeline **persists both sides in Postgres**, then **matches in the database** on EAN/GTIN:

1. **Qogita** — `GET /offers/` (or `QOGITA_OFFERS_PATH`) → upserts **`qogita_products`** and canonical refs.
2. **Keepa** — [bestsellers](https://keepa.com/#!api) for each browse node (up to **100 ASINs per node**), then [product](https://keepa.com/#!discuss/t/request-products/110) for those ASINs → upserts **`keepa_catalog_items`** (Amazon demand signal). A **single** parent category (e.g. UK Fragrances `118457031`) cannot yield ~2000 ASINs by itself: set **`KEEPA_BESTSELLER_EXPAND_CHILDREN=1`** to resolve **direct child** browse nodes via the [Keepa category API](https://keepa.com/#!api), and/or list multiple comma-separated IDs in **`KEEPA_BESTSELLER_CATEGORY_IDS`**. Tune **`KEEPA_BESTSELLER_MAX_CATEGORIES`**, **`KEEPA_BESTSELLER_TARGET_ASINS`**, and **`KEEPA_BESTSELLERS_PER_CATEGORY`** (max 100) for breadth vs token cost.
3. **Match** — rows in **`keepa_catalog_items`** with `primary_ean` are joined to **`qogita_products.ean`**; matches update **`product_matches`** and append **`price_snapshots`**.

Dashboard: **Sync Qogita + Keepa (UK)** runs the same flow. The **Top 20** table reads `keepa_catalog_items` (with Qogita when EAN matches). Optional **margin**: `?margin=1&min=10` or the on-page checkbox.

**Env (required for full pipeline):** `QOGITA_EMAIL` + `QOGITA_PASSWORD` (or `QOGITA_API_TOKEN`), `KEEPA_API_KEY`, and **`KEEPA_BESTSELLER_CATEGORY_IDS`**. Optional: `KEEPA_DOMAIN` (default UK `2`), **`KEEPA_BESTSELLER_EXPAND_CHILDREN`**, **`KEEPA_BESTSELLER_MAX_CATEGORIES`**, **`KEEPA_BESTSELLER_TARGET_ASINS`**, `KEEPA_BESTSELLERS_PER_CATEGORY` (≤100), `KEEPA_BESTSELLER_RANGE`, **`KEEPA_PRODUCT_INCLUDE_HISTORY`** / **`KEEPA_HISTORY_DAYS`**, **`QOGITA_SYNC_MAX_OFFERS`** (raise alongside large Keepa pulls so **EAN overlap** with `qogita_products` is realistic), **`QOGITA_OFFERS_PATH`** (e.g. fragrance filter if the Buyer API supports it).

**CLI:** `npm run sync:pipeline` loads `.env.local` and runs one full sync (same as dashboard/cron).

- Cron: `GET /api/cron/sync` (optional `CRON_SECRET`).
- Schema: `npm run db:push` (or migrations under `drizzle/migrations/`, including **`keepa_catalog_items`**).
- **Pipeline diagnostics** on the dashboard reads **`sync_runs`** (offers pulled, Keepa rows saved, errors).

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
