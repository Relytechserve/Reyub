ALTER TABLE "keepa_catalog_items" ADD COLUMN "primary_image_url" text;
--> statement-breakpoint
ALTER TABLE "keepa_catalog_items" ADD COLUMN "image_urls" jsonb;
--> statement-breakpoint
ALTER TABLE "qogita_products" ADD COLUMN "primary_image_url" text;
--> statement-breakpoint
ALTER TABLE "qogita_products" ADD COLUMN "image_urls" jsonb;
--> statement-breakpoint
CREATE INDEX "qogita_products_primary_image_idx" ON "qogita_products" USING btree ("primary_image_url");
--> statement-breakpoint
CREATE TABLE "image_similarity_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "source_image_url" text NOT NULL,
  "target_image_url" text NOT NULL,
  "score" numeric(6, 5),
  "status" text NOT NULL,
  "error" text,
  "last_computed_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "image_similarity_cache_provider_pair_uidx" ON "image_similarity_cache" USING btree ("provider","source_image_url","target_image_url");
--> statement-breakpoint
CREATE INDEX "image_similarity_cache_status_idx" ON "image_similarity_cache" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "image_similarity_cache_updated_idx" ON "image_similarity_cache" USING btree ("updated_at");
