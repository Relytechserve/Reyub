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

- Dashboard: **Sync Qogita + Keepa (UK)** pulls `GET /offers/`, upserts `qogita_products`, then batches EANs to [Keepa Product](https://keepa.com/#!discuss/t/request-products/110) (`domain=2`, `stats=30`, `history=0`). **Every** ASIN Keepa returns is stored (with a price snapshot); Qogita is linked when the same GTIN appears on an offer.
- The dashboard **Top 20** table ranks listings by 30-day sales-rank drops (velocity), then BSR. Optional **margin** column: `?margin=1&min=10` or the on-page checkbox.
- Env: `QOGITA_EMAIL`, `QOGITA_PASSWORD`, `KEEPA_API_KEY`, optional `QOGITA_SYNC_MAX_OFFERS` (default `100`).
- Cron: `GET /api/cron/sync` runs the same sync (optional `CRON_SECRET`).
- Apply migration `0002_*` (or `npm run db:push`) so `product_matches.qogita_product_id` can be null for Amazon-only rows.
- After each sync, the dashboard **Pipeline diagnostics** section reads `sync_runs` and shows how many Qogita offers were pulled, how many had EANs, whether Keepa was called, and how many ASIN snapshots were saved (so you can tell if the problem is mapping, EANs, or Keepa).

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
