# Sourcing Insights — Product Requirements (v1)

Living companion to [REQUIREMENTS.md](./REQUIREMENTS.md). This document is the **north-star spec** for the seller-facing **sourcing portal**: Amazon demand (Keepa) × wholesale supply (Qogita), with **capital-aware** and **margin-aware** views. The first Reyub iteration proved integrations; this spec defines **match quality**, **economics**, and **UX** as first-class.

---

## 1. Vision

**Outcome:** A signed-in seller opens a **Sourcing** view and sees **actionable lines**: which Amazon listings (ASINs) can be sourced on Qogita, at what **buy price**, what **reference sell price** (windowed), and **estimated profit / margin per unit**—with **explicit match provenance** (GTIN vs heuristic).

**Non-goals (v1):** Auto-ordering, guaranteed sales, VAT/tax filing, multi-tenant billing.

---

## 2. Success metrics

| Metric | Definition |
|--------|------------|
| **Qualified shortlist rate** | Rows where margin ≥ user target AND match method ∈ allowed set AND data freshness ≤ SLO. |
| **Match coverage** | % of Keepa catalog ASINs with any Qogita link vs total (segment by category). |
| **Precision proxy** | Sample audit: % of `title_similarity` matches manually confirmed correct (target ≥ 85% after tuning). |
| **Time-to-insight** | p95 load of Sourcing table < 2s on warm DB. |

---

## 3. Personas & jobs-to-be-done

- **Solo seller:** “I have £5k and want ≥12% net after rough Amazon fees—what can I buy?”
- **Buyer/VA:** “Refresh and show what changed since yesterday on my watch categories.”

---

## 4. Data sources (contracts)

### 4.1 Keepa

- **Bestsellers** → ASIN universe + category context.
- **Product** → title, `eanList`, sales rank, buy box / stats (`statsDays`, optional `history`).

**Requirement:** Persist **`eanCandidates`** (all normalized GTINs from the product payload), not only the first barcode, because Amazon/Keepa ordering is not guaranteed to match Qogita’s primary EAN.

### 4.2 Qogita

- **Offers** → `ean`, title, brand, `buyUnitPrice`, currency, stock, MOQ/pack fields when present.

### 4.3 Persisted match record

- `product_matches`: one row per `(channel, external_id)` e.g. `amazon_uk` + ASIN.
- `confidence`: `high` = identifier-backed; `medium` = heuristic (title/brand).
- `reason_tags`: machine-readable methods, e.g. `ean_exact`, `gtin_variant`, `title_token_jaccard`.
- `match_score`: numeric similarity for heuristics (0–1).

---

## 5. Matching ladder (core product risk)

GTIN alignment is **necessary but not sufficient** for a production matcher. Implement a **staged ladder**; each stage **labels** the outcome and **never silently overwrites** a stronger match with a weaker one.

### Stage A — Normalized GTIN / EAN match (high confidence)

1. **Normalize** barcode strings: digits only; length 8–14.
2. **Expand variants** for lookup (same physical product, different string forms):
   - UPC-A 12-digit → try **leading `0` → 13** (EAN-13 style) and raw 12.
   - Strip leading zero runtimes where both forms appear in feeds.
3. **Join keys:** For each ASIN, try **every** value in `eanCandidates` ∪ `{primary_ean}` against Qogita’s `ean` index (and the same variant expansion on the Qogita side).

**Tags:** `ean_exact` (single canonical hit), or `gtin_variant` when match required variant expansion (optional sub-tag).

**Conflicts:** Multiple Qogita rows share one GTIN → **prefer a live API offer** over an Excel catalog row (`excel-gtin-{ean}`) when both exist for the same normalized GTIN; otherwise use the available row. Within API-only or Excel-only candidates, pick **lowest `buyUnitPrice`** (stock-aware tie-break remains a future refinement). Emit tag `ean_multi_supplier` in `reason_tags` / snapshot metadata when multiple suppliers compete. **UI:** When `flags.priceIncShipping` is set (Excel GBP list), show that buy price includes shipping so margin is not read as ex-shipping landed cost.

### Stage B — Title + token overlap (medium confidence)

**Only if** Stage A did not produce a link for that ASIN.

**Goal:** Recover value when barcodes are missing, wrong, or multipack mismatches.

**Algorithm (v1):**

1. **Normalize** titles: lowercase, strip punctuation, collapse whitespace, remove common stopwords (`the`, `for`, `ml`, `pack`, etc.—tunable list).
2. **Tokenize** on whitespace; drop tokens shorter than 4 characters (configurable).
3. **Candidate generation:** Inverted index: token → list of Qogita product ids (only tokens with length ≥ 4 to limit fan-out).
4. **Score:** Token-set **Jaccard** similarity between Amazon title tokens and Qogita title tokens.
5. **Brand gate (optional but recommended):** If Qogita `brand` is non-empty, require normalized brand substring or token match in Amazon title **or** add brand tokens to Qogita token set before Jaccard.
6. **Acceptance:** `jaccard ≥ J_min` (default **0.38**).
7. **Ambiguity:** Let `s1` = best score, `s2` = second best. Accept only if `s1 - s2 ≥ 0.08` **or** `s2` undefined. Otherwise **no match** (avoid wrong wholesale SKU).

**Tags:** `title_token_jaccard`, optional `brand_gate`.

**UX:** Always show **“Review”** chip for medium-confidence rows; never present as equivalent to GTIN match.

### Stage C — Manual / learned (future)

- User “confirm link” / “reject link” feeds a **blocklist** and **allowlist** table.
- Optional **MPN + brand** when both sides expose manufacturer part numbers (requires schema/API discovery).
- **Current sync policy:** matcher runs as a global pipeline and **ignores per-user approve/reject decisions** when deciding whether to overwrite `product_matches`. User decisions only affect that user’s sourcing view.

### Stage D — Order history & seller SKU (future)

- Import **order_line_items** with EAN/ASIN: strongest offline signal for “I already sell this.”

---

## 6. Economics (display contract)

Definitions must match UI copy.

### Reference sell price

Use Keepa **Buy Box GBP** or **30d average Buy Box** (configurable; default show both columns).

### Estimated net margin % (rough)

Let `P` = reference Amazon price (GBP), `C` = landed buy cost in GBP (FX from user settings), `f` = combined referral + fulfilment assumption (default **0.15**).

\[
\text{margin}_{\%} = \frac{P(1-f) - C}{P(1-f)} \times 100
\]

### Estimated profit per unit (GBP)

\[
\pi = P(1-f) - C
\]

**Disclaimer:** Not tax advice; fees vary by category and size tier.

---

## 7. Functional requirements (portal)

| ID | Requirement |
|----|-------------|
| **FR-1** | Route **`/dashboard/sourcing`** lists only ASINs with **`product_matches.qogita_product_id` NOT NULL**. |
| **FR-2** | Columns: ASIN, Amazon title, buy box & 30d avg, BSR signals, Qogita title, buy price + currency, **est. margin %**, **est. profit £/unit**, **match method** (from `reason_tags`), **confidence**. |
| **FR-3** | Filters: min margin %, hide/show **medium** confidence matches. |
| **FR-4** | Sync pipeline runs **Stage A then Stage B** (Stage B configurable via env). |
| **FR-5** | Dashboard “Top” table joins Qogita via **`product_matches`**, not only `primary_ean` equality on `keepa_catalog_items`. |

---

## 8. AI “development team” — roles for agentic build iterations

Use this as a **work breakdown** for Cursor / AI agents. Each role delivers artifacts with **acceptance checks**.

| Agent role | Owns | Acceptance |
|------------|------|------------|
| **Tech PM** | Prioritises phases, defines match thresholds, signs off ambiguity rules | Thresholds documented in this file + env table |
| **Data engineer** | Pipeline idempotency, `eanCandidates` in metrics, sync stats | Integration test or dry-run log shows increased match count vs primary-EAN-only |
| **Matching engineer** | Stages A–B, inverted index, tests for normalizers | Unit tests: GTIN variants, Jaccard edge cases |
| **Full-stack** | Sourcing page, queries, empty states | Authenticated page renders with zero rows gracefully |
| **QA / analyst** | Golden-set of 20 ASINs; manual precision check on fuzzy | Spreadsheet with expected link / no-link |

**Iteration loop:** Ship Stage A → measure coverage → enable Stage B with conservative `J_min` → sample audit → tune.

---

## 9. Environment flags (implementation)

| Variable | Purpose |
|----------|---------|
| `MATCH_FUZZY_TITLES` | `0` disables Stage B; default **on** in code unless set. |
| `MATCH_FUZZY_MIN_JACCARD` | Override default **0.38**. |
| `MATCH_FUZZY_MIN_MARGIN` | Override ambiguity margin **0.08** between top-2 scores. |

---

## 10. Open decisions

- Category-aware fuzzy (restrict candidates to mapped browse node ↔ Qogita category) — **phase 2**.
- Per-category Amazon fee tables — **phase 2** (currently flat %).

---

## 11. References in repo

- Pipeline: `lib/sync/pipeline.ts`
- Matcher: `lib/matching/amazon-qogita-sync.ts` (orchestrator), `lib/matching/gtin.ts`, `lib/matching/title-similarity.ts`
- Sourcing UI: `app/dashboard/sourcing/`
- Margin helpers: `lib/margin/estimate.ts`

## 12. Implementation status (this branch)

- **GTIN ladder:** All Keepa `eanList` values stored in `keepa_catalog_items.metrics.eanCandidates` and used for Qogita lookup with UPC/EAN-13 variant expansion.
- **Title stage:** Token Jaccard + brand gate + top-2 gap; `confidence: medium`, `reason_tags` include `title_token_jaccard` and `jaccard:…`.
- **Portal:** Authenticated route **`/dashboard/sourcing`** — linked SKUs, est. margin %, est. £ profit/unit, filters for min margin and GTIN-only.
