CREATE TABLE "keepa_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asin" text NOT NULL,
	"domain_id" integer DEFAULT 2 NOT NULL,
	"browse_node_id" text,
	"bestseller_rank" integer,
	"title" text NOT NULL,
	"primary_ean" text,
	"metrics" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "keepa_catalog_asin_domain_uidx" ON "keepa_catalog_items" USING btree ("asin","domain_id");--> statement-breakpoint
CREATE INDEX "keepa_catalog_primary_ean_idx" ON "keepa_catalog_items" USING btree ("primary_ean");--> statement-breakpoint
CREATE INDEX "keepa_catalog_captured_idx" ON "keepa_catalog_items" USING btree ("captured_at");