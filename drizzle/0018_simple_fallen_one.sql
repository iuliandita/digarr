ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emby_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emby_api_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emby_user_id" text;
