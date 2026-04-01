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

3. Apply the database schema:

   ```bash
   npm run db:push
   ```

   Or use generated SQL migrations under `drizzle/migrations/` with your migration runner.

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

## Cron (daily sync)

`vercel.json` schedules `GET /api/cron/sync` at **07:00 UTC** (adjust schedule or use Vercel project timezone as needed). Set optional `CRON_SECRET` and send `Authorization: Bearer <CRON_SECRET>` for non-Vercel callers.

The handler is currently a **stub**; implement Qogita / Keepa / eBay ingestion and scoring there.

## Repository

Remote: [github.com/Relytechserve/Reyub](https://github.com/Relytechserve/Reyub)

```bash
git remote add origin https://github.com/Relytechserve/Reyub.git
git push -u origin main
```
