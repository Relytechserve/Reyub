CREATE TYPE "public"."match_confidence" AS ENUM('high', 'medium');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"qogita_refs" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "daily_top_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"list_date" date NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_address" text NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_match_id" uuid NOT NULL,
	"source" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"qogita_product_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"confidence" "match_confidence" NOT NULL,
	"reason_tags" jsonb NOT NULL,
	"match_score" numeric(6, 4),
	"promoted" boolean DEFAULT false NOT NULL,
	"promoted_until" timestamp with time zone,
	"trust_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qogita_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"qogita_id" text NOT NULL,
	"ean" text,
	"title" text NOT NULL,
	"brand" text,
	"category_slug" text,
	"units_per_pack" integer,
	"pack_description" text,
	"currency" text NOT NULL,
	"buy_unit_price" numeric(14, 4),
	"stock_units" integer,
	"min_order_value_override" numeric(12, 2),
	"supplier_id" text,
	"flags" jsonb,
	"raw_payload" jsonb,
	"updated_at_remote" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qogita_products_qogita_id_unique" UNIQUE("qogita_id")
);
--> statement-breakpoint
CREATE TABLE "shipping_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"destination_country" text NOT NULL,
	"weight_min_kg" numeric(10, 3) NOT NULL,
	"weight_max_kg" numeric(10, 3) NOT NULL,
	"cost_gbp" numeric(12, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_match_id" uuid NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"final_score" numeric(7, 4) NOT NULL,
	"components" jsonb NOT NULL,
	"expected_sell_gbp" numeric(14, 4),
	"net_profit_gbp" numeric(14, 4),
	"margin_pct" numeric(8, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"stats" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_target_margin_pct" numeric(5, 4) NOT NULL,
	"vat_registered" boolean DEFAULT false NOT NULL,
	"default_capital_gbp" numeric(12, 2) NOT NULL,
	"risk_mix" jsonb NOT NULL,
	"max_recommendation_skus" integer NOT NULL,
	"min_units_per_line" integer NOT NULL,
	"default_min_order_value_gbp" numeric(12, 2) NOT NULL,
	"sync_time_uk" text NOT NULL,
	"categories_enabled" jsonb NOT NULL,
	"amazon_default_fulfilment" text NOT NULL,
	"alert_preferences" jsonb,
	"fx_manual" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"name" text,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "watchlist_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_match_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_top_lists" ADD CONSTRAINT "daily_top_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_product_match_id_product_matches_id_fk" FOREIGN KEY ("product_match_id") REFERENCES "public"."product_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_qogita_product_id_qogita_products_id_fk" FOREIGN KEY ("qogita_product_id") REFERENCES "public"."qogita_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_scores" ADD CONSTRAINT "sku_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_scores" ADD CONSTRAINT "sku_scores_product_match_id_product_matches_id_fk" FOREIGN KEY ("product_match_id") REFERENCES "public"."product_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_candidates" ADD CONSTRAINT "watchlist_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_candidates" ADD CONSTRAINT "watchlist_candidates_product_match_id_product_matches_id_fk" FOREIGN KEY ("product_match_id") REFERENCES "public"."product_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_top_lists_user_date_uidx" ON "daily_top_lists" USING btree ("user_id","list_date");--> statement-breakpoint
CREATE INDEX "email_outbox_status_idx" ON "email_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fx_rates_pair_idx" ON "fx_rates" USING btree ("base_currency","quote_currency","effective_from");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_snapshots_match_time_idx" ON "price_snapshots" USING btree ("product_match_id","captured_at");--> statement-breakpoint
CREATE INDEX "product_matches_qogita_idx" ON "product_matches" USING btree ("qogita_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_matches_channel_ext_uidx" ON "product_matches" USING btree ("channel","external_id");--> statement-breakpoint
CREATE INDEX "qogita_products_ean_idx" ON "qogita_products" USING btree ("ean");--> statement-breakpoint
CREATE INDEX "qogita_products_category_idx" ON "qogita_products" USING btree ("category_slug");--> statement-breakpoint
CREATE INDEX "shipping_rules_user_idx" ON "shipping_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sku_scores_user_computed_idx" ON "sku_scores" USING btree ("user_id","computed_at");--> statement-breakpoint
CREATE INDEX "sync_runs_started_idx" ON "sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "usage_events_user_time_idx" ON "usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_type_idx" ON "usage_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "watchlist_candidates_user_idx" ON "watchlist_candidates" USING btree ("user_id");