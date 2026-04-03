ALTER TABLE "product_matches" DROP CONSTRAINT "product_matches_qogita_product_id_qogita_products_id_fk";
--> statement-breakpoint
ALTER TABLE "product_matches" ALTER COLUMN "qogita_product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_qogita_product_id_qogita_products_id_fk" FOREIGN KEY ("qogita_product_id") REFERENCES "public"."qogita_products"("id") ON DELETE set null ON UPDATE no action;