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

export const qogitaProducts = pgTable(
  "qogita_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    qogitaId: text("qogita_id").notNull().unique(),
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
  ]
);

export const productMatches = pgTable(
  "product_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    qogitaProductId: uuid("qogita_product_id")
      .notNull()
      .references(() => qogitaProducts.id, { onDelete: "cascade" }),
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
