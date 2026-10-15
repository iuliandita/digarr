DROP INDEX IF EXISTS "users_oidc_subject_unique_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oidc_issuer" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_oidc_identity_unique_idx" ON "users" USING btree ("oidc_issuer","oidc_subject");--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "users" ADD CONSTRAINT "users_oidc_identity_valid" CHECK ("users"."oidc_issuer" IS NULL OR (length(trim("users"."oidc_issuer")) > 0 AND "users"."oidc_subject" IS NOT NULL AND length(trim("users"."oidc_subject")) > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
