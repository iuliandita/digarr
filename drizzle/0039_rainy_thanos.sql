ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "jellyfin_library_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emby_library_id" text;
