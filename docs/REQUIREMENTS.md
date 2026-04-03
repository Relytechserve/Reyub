# Reyub — Product Requirements Specification

**Version:** 0.4.0  
**Last updated:** 2026-04-03  
**Status:** Living document — update as the product evolves.

**Implementation:** Next.js app in this repo (`reyub`), Drizzle schema in `db/schema.ts`, Auth.js email/password, Neon via `DATABASE_URL`, Qogita offers + Keepa matching, **global `canonical_products` catalog** with `product_external_ref` and multi-label categories. See root `README.md`.

---

## Document control

| Version | Date       | Summary |
|---------|------------|---------|
| 0.4.0   | 2026-04-03 | Global catalog, multi-label categories, matching tiers, data architecture (no RAG), optional orders, requirements alignment. |
| 0.3.0   | 2026-04-01 | Qogita `/offers/` ingest, Keepa UK EAN match, dashboard table, cron sync. |
| 0.2.0   | 2026-04-01 | Repo scaffold: Next.js, Drizzle schema, auth, cron stub, `README`. |
| 0.1.0   | 2026-04-01 | Initial consolidated spec from discovery. |

---

## 1. Vision

A web application that helps UK/EU-focused sellers decide **what to source** from **Qogita** (wholesale) by combining buy-side data with **Amazon** (Keepa) and **eBay** market signals, surfacing **actionable, margin-first** opportunities and **alerts**—without drowning users in raw data.

---

## 2. Goals & non-goals

### 2.1 Goals (MVP)

- **Multi-user SaaS:** multiple registered users; insights respect **per-user preferences** (category selection, margin targets, capital, risk mix, alerts, etc.).
- **Platform-owned API keys** for Qogita, Keepa, and eBay (users get app experience + future usage limits; no BYOK for these integrations in the planned model).
- **Category scope (MVP):** Health & beauty, fragrance, household — **config-driven** so more categories can be added without code forks.
- **Discovery** is **data-driven** from Qogita + Keepa + eBay (no manual starter SKU list required).
- **Sourcing vs comparators (MVP):** **Qogita** is the **sourcing marketplace**. **Keepa (Amazon)** and **eBay** are **demand / comparator** signals. Additional sourcing marketplaces are **out of MVP** but the architecture must allow them later.
- **Global product catalog:** one **`canonical_product`** graph **shared across all tenants**. Ingestion and matching are amortized platform-wide; **per-tenant** data covers preferences, optional integrations, and **private order data**.
- **Product matching (priority order):**
  1. **User override** — confirmed or blocked links; always wins.
  2. **Strong identifiers** — normalized **GTIN/EAN/UPC** exact match when present on both sides; handle conflicts via review policy.
  3. **Amazon** — **ASIN + marketplace domain** as a strong key **within Amazon**; cross-link to Qogita/eBay only when combined with GTIN/MPN or approved fuzzy tier.
  4. **Brand + MPN** — when both are present and normalized; reject generic placeholders (`N/A`, etc.).
  5. **Structured attributes** — brand + pack size / unit volume + count + product form where available; flag multipack vs single.
  6. **Fuzzy fallback** — title/attribute similarity with **brand and category gates**, **score + margin vs runner-up**, **explicit reason tags**; **eBay** often lacks GTIN — cap confidence and prefer review for high-impact suggestions.
- **Pack / variant handling:** support **normalization** (e.g. multipacks) with explicit **confidence** and explainability.
- **Categories — multi-label + primary:**
  - Internal **`canonical_category`** rows (existing `categories` table) are what users filter on.
  - **Mappings** from **Qogita, Keepa/Amazon browse nodes, and eBay categories** into canonical categories (`category_source_mappings`).
  - Each canonical product may have **multiple** category links; **exactly one primary** per product for default dashboard filtering; optional “match any label” for broader analytics (UX policy).
  - **Primary promotion:** when Qogita supplies a resolvable category, prefer that link as **primary** for sourcing-oriented views.
- **Presentation (MVP):** **dashboards**, **filtered tables**, and **clear insights** for sourcing decisions — **no chatbot / NL Q&A** in MVP.
- **Data architecture:** **not RAG** as the core pipeline. Use **ETL/sync → Postgres → analytics** (aggregates, time windows, joins). **Optional later:** LLM-generated narratives over **precomputed metrics** (tool-calling / templates), not embeddings of API payloads as the source of truth.
- **Data freshness:** **≤ 24 hours** acceptable for “current” panels; retain **≥ 30 days** of offer/price snapshots where needed for **mean, standard deviation, volatility**, and margin suggestions.
- **Recommended vs actual (loop):** users may **optionally** connect **sales channels** (eBay, Amazon, WooCommerce, Shopify, etc.) so Reyub can ingest **orders** and compare **realized** performance to **recommended** insights. **MVP:** **CSV upload** as an order feed is supported alongside or before full OAuth/API integrations.
- **Two-tier presentation (matching):**
  - **Top opportunities:** **high-confidence** matches only.
  - **Watchlist candidates:** **medium-confidence** matches worth review; **never silently treated as high confidence**.
- **User actions:** promote a watchlist mapping to trusted status (**30-day validity**, then **automatic re-evaluation**; on confidence drop → **move back to watchlist** + **alert**).
- **Financial accuracy:** estimates include **UK VAT** assumptions, **marketplace fees**, **FBA vs FBM toggle** for Amazon UK, **rule-based shipping** costs (editable in UI), **GBP display**, **manual FX rates** (USD, EUR, GBP) in settings.
- **Default margin target:** **15%** net (configurable globally and **per product**).
- **Amazon analytics:** **margin-heavy** composite score using **30-day** history; key inputs include **Buy Box**, **sales rank / velocity proxies**, **stability**, **competition**; expected sell price uses a **conservative Buy Box blend**.
- **eBay UK:** **sold/completed** pricing as the primary signal; small differences vs seller UI Insights are **acceptable**.
- **Geography:** **Amazon UK/EU** enrichment as needed; **eBay UK**; **EU destination countries from day one** for VAT/shipping modelling.
- **Operations:** **daily sync at 07:00 UK**; architecture must support increasing frequency to **hourly** without redesign.
- **Retention:** store detailed snapshots **180 days** (prune older), while maintaining **minimum 30-day** windows for statistical features (align pruning rules in implementation).
- **Sourcing constraints:** default **minimum 5 units** per line (flexible); default **£500** minimum order value with **global + per-supplier overrides** (flexible).
- **Recommendations:** default **5–8 SKUs** per suggested basket (**default 8**, **admin-configurable** later); **£1,000** default capital context; **60/30/10** risk mix (**high/medium/test**); budget split uses **Qogita pack/stock** data.
- **Alerts:** rich **user preferences**; MVP **immediate** alerts for **margin below threshold**, **Qogita out-of-stock**, **sync/API failure**; **in-app + email (Resend)**; future channels (Slack/WhatsApp) **pluggable**.
- **Usage instrumentation:** **log usage events** with **no enforcement** until monetization strategy is defined.
- **Authentication (MVP):** **email + password** with **password reset**; **no magic links** for MVP.

### 2.2 Non-goals (MVP)

- Perfect parity with eBay Insights UI metrics.
- Fully automated VAT compliance filing or tax advice (the app provides **estimates** under stated assumptions).
- Mobile native apps.
- **RAG / vector search** as the primary ingestion or storage path for Keepa/Qogita/eBay structured data.

---

## 3. Personas

- **New seller:** overwhelmed by data; needs a **small prioritized queue**, clear **why**, and **defaults**.
- **Existing seller:** has a catalog/watchlist; needs **portfolio health**, **what changed**, and **better sourcing** for known SKUs.

---

## 4. Functional requirements

### 4.1 Integrations

| System | Role | Notes |
|--------|------|--------|
| **Qogita Buyer API** | Wholesale catalog, pricing, stock, MOQ | Auth per Qogita docs; token from platform account. |
| **Keepa** | Amazon pricing/history/rank proxies | Per **Amazon domain**; API key on platform; filters aligned to MVP categories. |
| **eBay** | Sold/completed pricing | Platform credentials; identifiers often incomplete — matching policy in §4.2. |
| **Sales channels (optional)** | Order / actuals feed | eBay, Amazon, WooCommerce, Shopify, etc.; **CSV MVP**. |

### 4.2 Matching & confidence

- **Primary:** EAN/GTIN exact match where possible (see §2.1 tier list).
- **Secondary:** title/attribute similarity for **watchlist candidates** only, with explicit **reason tags** (e.g. `ean_exact`, `pack_normalized`, `title_similarity`).
- **Pack size:** compare like-for-like where possible; when normalizing, **label confidence** and show **per-unit math**.
- **Global catalog:** automated high-confidence links are **shared**; **tenant-specific overrides** resolve channel SKUs to `canonical_product_id` without silently rewriting the global graph unless promoted via review.

### 4.3 Scoring (Amazon-heavy)

- **Margin-first** weighting aligned with **fixed capital** workflows.
- **30-day** window for historical features (extend with stored series as needed).
- **Outputs:** component scores + **final score** + **explainability** (assumptions visible).
- **Hard filters** before ranking (e.g. minimum margin, minimum stock, category allowlist).

### 4.4 UI surfaces

1. **Daily Top opportunities** (primary) — high confidence, small cap (e.g. Top 20 style views).
2. **Explorer / search** (secondary) — category-scoped by default; **primary category** filter default; optional “any label”.
3. **Watchlist candidates** — separate section/table with badges and promote action.
4. **Account settings** — margins, VAT toggles, FX, shipping rules, alert prefs, sync time, category toggles, recommendation SKU cap, optional order/CSV import, etc.

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

**Global catalog**

- `canonical_products` — stable product identity shared across tenants.
- `product_external_refs` — external keys (`qogita`, `amazon` domain+ASIN, `ebay`, etc.) → `canonical_product_id`.
- `category_source_mappings` — Qogita / Amazon / eBay category keys → `categories.id`.
- `product_category_links` — multi-label links; **one primary** per canonical product (partial unique index).

**Existing / related**

- `users`, `user_settings`, `fx_rates`, `shipping_rules`, `categories`, `qogita_products` (with optional `canonical_product_id`), `product_matches`, `price_snapshots`, `sku_scores`, `daily_top_lists`, `watchlist_candidates`, `alert_preferences`, `notifications`, `email_outbox`, `sync_runs`, `usage_events`.

**Orders (optional / MVP CSV)**

- `order_import_batches` — per-user upload or connector run.
- `order_line_items` — line-level sales with optional `ean`, `marketplace_sku`, `canonical_product_id` (resolved via matching pipeline).

**Future (not all in DB yet)**

- `product_match_candidates`, `product_match_overrides` for review queues and user overrides (logic described in spec; tables may be added when UI ships).

---

## 7. Open questions / implementation follow-ups

- Exact mapping rows from **Qogita taxonomy** and **Amazon browse nodes** → MVP category buckets (`category_source_mappings` seed data).
- Keepa plan/tokens and batch sizing per **Amazon domain** × category filters.
- eBay API specifics for **sold** comps by GTIN and fallback fuzzy workflow.
- Monetization and enforced quotas (deferred; usage logging enabled).
- Promotion workflow from **tenant override** → **global catalog** correction.

---

## 8. Revision history (detailed)

| Version | Date       | Author | Summary |
|---------|------------|--------|---------|
| 0.1.0   | 2026-04-01 | —      | Initial consolidated spec from discovery. |
| 0.2.0   | 2026-04-01 | —      | Repo scaffold: Next.js, Drizzle schema, auth, cron stub, `README`. |
| 0.3.0   | 2026-04-01 | —      | Qogita `/offers/` ingest, Keepa UK EAN match, dashboard table, cron sync. |
| 0.4.0   | 2026-04-03 | —      | Global catalog, multi-label categories, explicit matching tiers, comparator vs sourcing roles, optional orders + CSV, 24h/30d data policy, **explicit non-RAG architecture**, multi-tenant goals, data model updates. |
