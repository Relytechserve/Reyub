# Reyub — Product Requirements Specification

**Version:** 0.3.0  
**Last updated:** 2026-04-01  
**Status:** Living document — update as the product evolves.

**Implementation:** Next.js app in this repo (`reyub`), Drizzle schema in `db/schema.ts`, Auth.js email/password, Neon via `DATABASE_URL`, Qogita offers + Keepa UK matching on `/dashboard`. See root `README.md`.

---

## 1. Vision

A web application that helps UK/EU-focused sellers decide **what to source** from **Qogita** (wholesale) by combining buy-side data with **Amazon** (Keepa) and **eBay UK** market signals, surfacing **actionable, margin-first** opportunities and **alerts**—without drowning users in raw data.

---

## 2. Goals & non-goals

### 2.1 Goals (MVP)

- **Single-user** deployment first; architecture supports **multi-tenant SaaS** later.
- **Platform-owned API keys** for Qogita, Keepa, and eBay (users get app experience + future usage limits; no BYOK for these integrations in the planned model).
- **Category scope (MVP):** Health & beauty, fragrance, household — **config-driven** so more categories can be added without code forks.
- **Discovery** is **data-driven** from Qogita + Keepa + eBay (no manual starter SKU list required).
- **Primary identifier:** **EAN/GTIN** for matching across marketplaces.
- **Pack / variant handling:** support **normalization** (e.g. multipacks) with explicit **confidence** and explainability.
- **Two-tier presentation:**
  - **Top opportunities:** **high-confidence** matches only.
  - **Watchlist candidates:** **medium-confidence** matches worth review; **never silently treated as high confidence**.
- **User actions:** promote a watchlist mapping to trusted status (**30-day validity**, then **automatic re-evaluation**; on confidence drop → **move back to watchlist** + **alert**).
- **Financial accuracy:** estimates include **UK VAT** assumptions, **marketplace fees**, **FBA vs FBM toggle** for Amazon UK, **rule-based shipping** costs (editable in UI), **GBP display**, **manual FX rates** (USD, EUR, GBP) in settings.
- **Default margin target:** **15%** net (configurable globally and **per product**).
- **Amazon analytics:** **margin-heavy** composite score using **30-day** history; key inputs include **Buy Box**, **sales rank / velocity proxies**, **stability**, **competition**; expected sell price uses a **conservative Buy Box blend**.
- **eBay UK:** **sold/completed** pricing as the primary signal; small differences vs seller UI Insights are **acceptable**.
- **Geography:** **Amazon UK/EU** enrichment as needed; **eBay UK**; **EU destination countries from day one** for VAT/shipping modelling.
- **Operations:** **daily sync at 07:00 UK**; architecture must support increasing frequency to **hourly** without redesign.
- **Retention:** store detailed snapshots **180 days** (prune older).
- **Sourcing constraints:** default **minimum 5 units** per line (flexible); default **£500** minimum order value with **global + per-supplier overrides** (flexible).
- **Recommendations:** default **5–8 SKUs** per suggested basket (**default 8**, **admin-configurable** later); **£1,000** default capital context; **60/30/10** risk mix (**high/medium/test**); budget split uses **Qogita pack/stock** data.
- **Alerts:** rich **user preferences**; MVP **immediate** alerts for **margin below threshold**, **Qogita out-of-stock**, **sync/API failure**; **in-app + email (Resend)**; future channels (Slack/WhatsApp) **pluggable**.
- **Usage instrumentation:** **log usage events** with **no enforcement** until monetization strategy is defined.
- **Authentication (MVP):** **email + password** with **password reset**; **no magic links** for MVP.

### 2.2 Non-goals (MVP)

- Perfect parity with eBay Insights UI metrics.
- Fully automated VAT compliance filing or tax advice (the app provides **estimates** under stated assumptions).
- Mobile native apps.

---

## 3. Personas

- **New seller:** overwhelmed by data; needs a **small prioritized queue**, clear **why**, and **defaults**.
- **Existing seller:** has a catalog/watchlist; needs **portfolio health**, **what changed**, and **better sourcing** for known SKUs.

---

## 4. Functional requirements

### 4.1 Integrations

| System | Role | Notes |
|--------|------|--------|
| **Qogita Buyer API** | Wholesale catalog, pricing, stock, MOQ | Auth per Qogita docs ([Buyer API Beta](https://qogita.notion.site/Qogita-Buyer-API-Beta-556b22869bcb47d2bffac8d2a8c7076a)); token from user account. |
| **Keepa** | Amazon pricing/history/rank proxies | Plan TBD; API key on platform. |
| **eBay** | Sold/completed pricing (UK) | Platform credentials; public APIs acceptable where applicable. |

### 4.2 Matching & confidence

- **Primary:** EAN/GTIN exact match where possible.
- **Secondary:** title/attribute similarity for **watchlist candidates** only, with explicit **reason tags** (e.g. `ean_exact`, `pack_normalized`, `title_similarity`).
- **Pack size:** compare like-for-like where possible; when normalizing, **label confidence** and show **per-unit math**.

### 4.3 Scoring (Amazon-heavy)

- **Margin-first** weighting aligned with **fixed capital** workflows.
- **30-day** window for historical features.
- **Outputs:** component scores + **final score** + **explainability** (assumptions visible).
- **Hard filters** before ranking (e.g. minimum margin, minimum stock, category allowlist).

### 4.4 UI surfaces

1. **Daily Top opportunities** (primary) — high confidence, small cap (e.g. Top 20 style views).
2. **Explorer / search** (secondary) — category-scoped by default; admin can widen later.
3. **Watchlist candidates** — separate section/table with badges and promote action.
4. **Account settings** — margins, VAT toggles, FX, shipping rules, alert prefs, sync time, category toggles, recommendation SKU cap, etc.

### 4.5 Risk & compliance flags (display)

Show badges (user decides): **expiry**, **perishable**, **hazmat**, **liquid**, **dangerous goods** — sourced from supplier/product metadata when available.

### 4.6 Alerts (preference-driven)

Support configurable alert types (examples):

- Margin / profit thresholds and step-changes
- Buy/sell price movements
- Stock thresholds and availability changes
- Volatility / match confidence changes
- Sync/job failures and API auth issues
- Daily digest vs immediate (policy configurable)

**MVP default immediate:** margin breach, OOS, sync/API failure (subject to user toggles).

### 4.7 Email

- **Resend** preferred for transactional + alerts; if Resend pricing is unsuitable, fallback to **Google Workspace SMTP** (user-operated).

---

## 5. Non-functional requirements

- **Hosting:** Vercel + Next.js.
- **Database:** Postgres (Neon recommended).
- **Security:** secrets only on server; never expose integration keys to the browser.
- **Observability:** job runs, structured errors, and basic metrics from day one (expand over time).
- **Performance:** batching and rate-limit awareness for external APIs.

---

## 6. Data model (conceptual)

Key entities: `users`, `user_settings`, `fx_rates`, `shipping_rules`, `categories`, `qogita_products`, marketplace links, `product_matches`, `price_snapshots`, `sku_scores`, `daily_top_lists`, `watchlist_candidates`, `alert_preferences`, `notifications`, `email_outbox`, `sync_runs`, `usage_events`.

---

## 7. Revision history

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 0.1.0 | 2026-04-01 | — | Initial consolidated spec from discovery. |
| 0.2.0 | 2026-04-01 | — | Repo scaffold: Next.js, Drizzle schema, auth, cron stub, `README`. |
| 0.3.0 | 2026-04-01 | — | Qogita `/offers/` ingest, Keepa UK EAN match, dashboard table, cron sync. |

---

## 8. Open questions / implementation follow-ups

- Exact mapping from **Qogita taxonomy** → MVP category buckets.
- Keepa plan/tokens and batch sizing strategy.
- eBay API specifics for **sold** comps by GTIN (implementation details).
- Monetization and enforced quotas (deferred; usage logging enabled).
