ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subsonic_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subsonic_username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subsonic_password" text;