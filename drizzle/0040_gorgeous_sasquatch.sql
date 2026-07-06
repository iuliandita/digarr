ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "tidal_client_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "tidal_client_secret" text;