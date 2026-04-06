CREATE TYPE "public"."match_decision" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TABLE "product_match_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_match_id" uuid NOT NULL,
	"decision" "match_decision" NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_match_decisions" ADD CONSTRAINT "product_match_decisions_product_match_id_product_matches_id_fk" FOREIGN KEY ("product_match_id") REFERENCES "public"."product_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_match_decisions_match_uidx" ON "product_match_decisions" USING btree ("product_match_id");--> statement-breakpoint
CREATE INDEX "product_match_decisions_decision_idx" ON "product_match_decisions" USING btree ("decision");
