CREATE TABLE "canonical_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"primary_ean" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_source_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_name" text,
	"row_count" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"batch_id" uuid,
	"order_date" date,
	"sales_channel" text NOT NULL,
	"marketplace_sku" text,
	"ean" text,
	"quantity" integer,
	"unit_price" numeric(14, 4),
	"currency" text,
	"canonical_product_id" uuid,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_category_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"source" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_external_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_product_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_key" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_matches" ADD COLUMN "canonical_product_id" uuid;--> statement-breakpoint
ALTER TABLE "qogita_products" ADD COLUMN "canonical_product_id" uuid;--> statement-breakpoint
ALTER TABLE "category_source_mappings" ADD CONSTRAINT "category_source_mappings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_import_batches" ADD CONSTRAINT "order_import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_batch_id_order_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."order_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_canonical_product_id_canonical_products_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."canonical_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category_links" ADD CONSTRAINT "product_category_links_canonical_product_id_canonical_products_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."canonical_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category_links" ADD CONSTRAINT "product_category_links_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_external_refs" ADD CONSTRAINT "product_external_refs_canonical_product_id_canonical_products_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."canonical_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canonical_products_primary_ean_idx" ON "canonical_products" USING btree ("primary_ean");--> statement-breakpoint
CREATE UNIQUE INDEX "category_source_mappings_source_key_uidx" ON "category_source_mappings" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "category_source_mappings_category_idx" ON "category_source_mappings" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "order_import_batches_user_idx" ON "order_import_batches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "order_line_items_user_date_idx" ON "order_line_items" USING btree ("user_id","order_date");--> statement-breakpoint
CREATE INDEX "order_line_items_canonical_idx" ON "order_line_items" USING btree ("canonical_product_id");--> statement-breakpoint
CREATE INDEX "order_line_items_batch_idx" ON "order_line_items" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_category_links_product_cat_source_uidx" ON "product_category_links" USING btree ("canonical_product_id","category_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "product_category_links_one_primary_uidx" ON "product_category_links" USING btree ("canonical_product_id") WHERE "product_category_links"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "product_category_links_category_idx" ON "product_category_links" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_external_refs_source_key_uidx" ON "product_external_refs" USING btree ("source","external_key");--> statement-breakpoint
CREATE INDEX "product_external_refs_canonical_idx" ON "product_external_refs" USING btree ("canonical_product_id");--> statement-breakpoint
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_canonical_product_id_canonical_products_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."canonical_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qogita_products" ADD CONSTRAINT "qogita_products_canonical_product_id_canonical_products_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."canonical_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_matches_canonical_idx" ON "product_matches" USING btree ("canonical_product_id");--> statement-breakpoint
CREATE INDEX "qogita_products_canonical_idx" ON "qogita_products" USING btree ("canonical_product_id");
--> statement-breakpoint
INSERT INTO "categories" ("slug", "name", "enabled")
VALUES
	('health-beauty', 'Health & beauty', true),
	('fragrance', 'Fragrance', true),
	('household', 'Household supplies', true)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "category_source_mappings" ("source", "source_key", "category_id")
SELECT 'qogita', c.slug, c.id
FROM "categories" c
WHERE c.slug IN ('health-beauty', 'fragrance', 'household')
ON CONFLICT ("source", "source_key") DO NOTHING;