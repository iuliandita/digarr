CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique_idx" ON "users" USING btree ("email") WHERE "users"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_oidc_subject_unique_idx" ON "users" USING btree ("oidc_subject") WHERE "users"."oidc_subject" IS NOT NULL;
