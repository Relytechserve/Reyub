ALTER TABLE "product_match_decisions" ADD COLUMN "user_id" uuid;
--> statement-breakpoint
UPDATE "product_match_decisions" d
SET "user_id" = u.id
FROM (
  SELECT id
  FROM "users"
  ORDER BY "created_at" ASC
  LIMIT 1
) u
WHERE d."user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "product_match_decisions" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_match_decisions" ADD CONSTRAINT "product_match_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "product_match_decisions_match_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "product_match_decisions_match_user_uidx" ON "product_match_decisions" USING btree ("product_match_id","user_id");
--> statement-breakpoint
CREATE INDEX "product_match_decisions_user_idx" ON "product_match_decisions" USING btree ("user_id");
