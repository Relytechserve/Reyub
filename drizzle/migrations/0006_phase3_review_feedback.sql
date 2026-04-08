CREATE TYPE "public"."review_action" AS ENUM('approve', 'reject', 'remap');--> statement-breakpoint
CREATE TABLE "product_match_feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_match_id" uuid NOT NULL,
	"action" "review_action" NOT NULL,
	"decision" "match_decision",
	"reason_tags" jsonb NOT NULL,
	"score_snapshot" jsonb NOT NULL,
	"notes" text,
	"previous_qogita_product_id" uuid,
	"remapped_qogita_product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_match_feedback_events" ADD CONSTRAINT "product_match_feedback_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_match_feedback_events" ADD CONSTRAINT "product_match_feedback_events_product_match_id_product_matches_id_fk" FOREIGN KEY ("product_match_id") REFERENCES "public"."product_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_match_feedback_events_match_idx" ON "product_match_feedback_events" USING btree ("product_match_id","created_at");--> statement-breakpoint
CREATE INDEX "product_match_feedback_events_user_idx" ON "product_match_feedback_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "product_match_feedback_events_action_idx" ON "product_match_feedback_events" USING btree ("action");
