import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Confidence tier for marketplace ↔ Qogita matches */
export const matchConfidenceEnum = pgEnum("match_confidence", [
  "high",
  "medium",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  name: text("name"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("password_reset_tokens_user_idx").on(t.userId)]
);

/** Per-user preferences & global defaults (SaaS-ready: always scoped by userId) */
export const userSettings = pgTable(
  "user_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Default net margin target, e.g. 0.15 */
    defaultTargetMarginPct: numeric("default_target_margin_pct", {
      precision: 5,
      scale: 4,
    }).notNull(),
    vatRegistered: boolean("vat_registered").notNull().default(false),
    defaultCapitalGbp: numeric("default_capital_gbp", {
      precision: 12,
      scale: 2,
    }).notNull(),
    /** JSON: { high: 0.6, medium: 0.3, low: 0.1 } */
    riskMix: jsonb("risk_mix").notNull(),
    maxRecommendationSkus: integer("max_recommendation_skus").notNull(),
    minUnitsPerLine: integer("min_units_per_line").notNull(),
    defaultMinOrderValueGbp: numeric("default_min_order_value_gbp", {
      precision: 12,
      scale: 2,
    }).notNull(),
    /** HH:mm in Europe/London */
    syncTimeUk: text("sync_time_uk").notNull(),
    /** Enabled category slugs */
    categoriesEnabled: jsonb("categories_enabled").notNull(),
    /** Amazon fulfilment default for UI toggles */
    amazonDefaultFulfilment: text("amazon_default_fulfilment")
      .notNull()
      .$type<"FBA" | "FBM">(),
    /** Alert preferences: toggles + channels (see docs/REQUIREMENTS.md) */
    alertPreferences: jsonb("alert_preferences"),
    /** Manual FX: { USD: number, EUR: number } quotes per 1 GBP — or inverse; UI clarifies */
    fxManual: jsonb("fx_manual"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseCurrency: text("base_currency").notNull(), // GBP
    quoteCurrency: text("quote_currency").notNull(), // USD | EUR
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("fx_rates_pair_idx").on(t.baseCurrency, t.quoteCurrency, t.effectiveFrom),
  ]
);

export const shippingRules = pgTable(
  "shipping_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(),
    destinationCountry: text("destination_country").notNull(),
    weightMinKg: numeric("weight_min_kg", { precision: 10, scale: 3 }).notNull(),
    weightMaxKg: numeric("weight_max_kg", { precision: 10, scale: 3 }).notNull(),
    costGbp: numeric("cost_gbp", { precision: 12, scale: 2 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("shipping_rules_user_idx").on(t.userId)]
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** Qogita taxonomy ids / keys — filled when integration mapping is known */
    qogitaRefs: jsonb("qogita_refs"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

/** Global catalog: one identity per product, shared across all tenants. */
export const canonicalProducts = pgTable(
  "canonical_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    primaryEan: text("primary_ean"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("canonical_products_primary_ean_idx").on(t.primaryEan)]
);

/**
 * Maps marketplace-specific category keys → internal `categories` rows.
 * Sources: qogita | amazon | ebay
 */
export const categorySourceMappings = pgTable(
  "category_source_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    sourceKey: text("source_key").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("category_source_mappings_source_key_uidx").on(
      t.source,
      t.sourceKey
    ),
    index("category_source_mappings_category_idx").on(t.categoryId),
  ]
);

/** External listing/SKU keys pointing at a canonical product (global). */
export const productExternalRefs = pgTable(
  "product_external_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalProductId: uuid("canonical_product_id")
      .notNull()
      .references(() => canonicalProducts.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    externalKey: text("external_key").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("product_external_refs_source_key_uidx").on(
      t.source,
      t.externalKey
    ),
    index("product_external_refs_canonical_idx").on(t.canonicalProductId),
  ]
);

/** Multi-label categories per canonical product; at most one `is_primary` (partial unique). */
export const productCategoryLinks = pgTable(
  "product_category_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalProductId: uuid("canonical_product_id")
      .notNull()
      .references(() => canonicalProducts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("product_category_links_product_cat_source_uidx").on(
      t.canonicalProductId,
      t.categoryId,
      t.source
    ),
    uniqueIndex("product_category_links_one_primary_uidx")
      .on(t.canonicalProductId)
      .where(sql`${t.isPrimary} = true`),
    index("product_category_links_category_idx").on(t.categoryId),
  ]
);

/**
 * Amazon demand data from Keepa (bestseller discovery → product stats).
 * Stored independently; Qogita is matched later by `primary_ean` ↔ `qogita_products.ean`.
 */
export const keepaCatalogItems = pgTable(
  "keepa_catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    asin: text("asin").notNull(),
    domainId: integer("domain_id").notNull().default(2),
    browseNodeId: text("browse_node_id"),
    bestsellerRank: integer("bestseller_rank"),
    title: text("title").notNull(),
    primaryEan: text("primary_ean"),
    metrics: jsonb("metrics").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("keepa_catalog_asin_domain_uidx").on(t.asin, t.domainId),
    index("keepa_catalog_primary_ean_idx").on(t.primaryEan),
    index("keepa_catalog_captured_idx").on(t.capturedAt),
  ]
);

export const qogitaProducts = pgTable(
  "qogita_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    qogitaId: text("qogita_id").notNull().unique(),
    canonicalProductId: uuid("canonical_product_id").references(
      () => canonicalProducts.id,
      { onDelete: "set null" }
    ),
    ean: text("ean"),
    title: text("title").notNull(),
    brand: text("brand"),
    categorySlug: text("category_slug"),
    unitsPerPack: integer("units_per_pack"),
    packDescription: text("pack_description"),
    currency: text("currency").notNull(),
    buyUnitPrice: numeric("buy_unit_price", { precision: 14, scale: 4 }),
    stockUnits: integer("stock_units"),
    minOrderValueOverride: numeric("min_order_value_override", {
      precision: 12,
      scale: 2,
    }),
    supplierId: text("supplier_id"),
    flags: jsonb("flags"),
    rawPayload: jsonb("raw_payload"),
    updatedAtRemote: timestamp("updated_at_remote", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("qogita_products_ean_idx").on(t.ean),
    index("qogita_products_category_idx").on(t.categorySlug),
    index("qogita_products_canonical_idx").on(t.canonicalProductId),
  ]
);

export const productMatches = pgTable(
  "product_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null when we only have Amazon/Keepa data (no Qogita offer for that ASIN yet). */
    qogitaProductId: uuid("qogita_product_id").references(() => qogitaProducts.id, {
      onDelete: "set null",
    }),
    canonicalProductId: uuid("canonical_product_id").references(
      () => canonicalProducts.id,
      { onDelete: "set null" }
    ),
    channel: text("channel").notNull(), // amazon_uk | ebay_uk | amazon_de ...
    externalId: text("external_id").notNull(),
    confidence: matchConfidenceEnum("confidence").notNull(),
    reasonTags: jsonb("reason_tags").notNull().$type<string[]>(),
    matchScore: numeric("match_score", { precision: 6, scale: 4 }),
    promoted: boolean("promoted").notNull().default(false),
    promotedUntil: timestamp("promoted_until", { withTimezone: true }),
    trustExpiresAt: timestamp("trust_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("product_matches_qogita_idx").on(t.qogitaProductId),
    index("product_matches_canonical_idx").on(t.canonicalProductId),
    uniqueIndex("product_matches_channel_ext_uidx").on(t.channel, t.externalId),
  ]
);

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productMatchId: uuid("product_match_id")
      .notNull()
      .references(() => productMatches.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // qogita | keepa | ebay
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    metrics: jsonb("metrics").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("price_snapshots_match_time_idx").on(t.productMatchId, t.capturedAt),
  ]
);

export const skuScores = pgTable(
  "sku_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productMatchId: uuid("product_match_id")
      .notNull()
      .references(() => productMatches.id, { onDelete: "cascade" }),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    finalScore: numeric("final_score", { precision: 7, scale: 4 }).notNull(),
    components: jsonb("components").notNull(),
    expectedSellGbp: numeric("expected_sell_gbp", { precision: 14, scale: 4 }),
    netProfitGbp: numeric("net_profit_gbp", { precision: 14, scale: 4 }),
    marginPct: numeric("margin_pct", { precision: 8, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("sku_scores_user_computed_idx").on(t.userId, t.computedAt),
  ]
);

export const dailyTopLists = pgTable(
  "daily_top_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listDate: date("list_date", { mode: "date" }).notNull(),
    items: jsonb("items").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("daily_top_lists_user_date_uidx").on(t.userId, t.listDate),
  ]
);

export const watchlistCandidates = pgTable(
  "watchlist_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productMatchId: uuid("product_match_id")
      .notNull()
      .references(() => productMatches.id, { onDelete: "cascade" }),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("watchlist_candidates_user_idx").on(t.userId)]
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notifications_user_unread_idx").on(t.userId, t.readAt)]
);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toAddress: text("to_address").notNull(),
    template: text("template").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().$type<"pending" | "sent" | "failed">(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("email_outbox_status_idx").on(t.status)]
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().$type<"running" | "success" | "partial" | "failed">(),
    stats: jsonb("stats"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sync_runs_started_idx").on(t.startedAt)]
);

/** Optional order feed: CSV upload or future connector run (per user). */
export const orderImportBatches = pgTable(
  "order_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull().$type<"csv" | "api">(),
    status: text("status")
      .notNull()
      .default("pending")
      .$type<"pending" | "processed" | "failed">(),
    fileName: text("file_name"),
    rowCount: integer("row_count"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("order_import_batches_user_idx").on(t.userId)]
);

export const orderLineItems = pgTable(
  "order_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id").references(() => orderImportBatches.id, {
      onDelete: "set null",
    }),
    orderDate: date("order_date", { mode: "date" }),
    salesChannel: text("sales_channel").notNull(),
    marketplaceSku: text("marketplace_sku"),
    ean: text("ean"),
    quantity: integer("quantity"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 4 }),
    currency: text("currency"),
    canonicalProductId: uuid("canonical_product_id").references(
      () => canonicalProducts.id,
      { onDelete: "set null" }
    ),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("order_line_items_user_date_idx").on(t.userId, t.orderDate),
    index("order_line_items_canonical_idx").on(t.canonicalProductId),
    index("order_line_items_batch_idx").on(t.batchId),
  ]
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("usage_events_user_time_idx").on(t.userId, t.createdAt),
    index("usage_events_type_idx").on(t.eventType),
  ]
);
