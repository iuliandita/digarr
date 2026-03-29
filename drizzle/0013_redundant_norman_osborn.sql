ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "begin_year" integer;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "end_year" integer;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "top_tracks" jsonb;