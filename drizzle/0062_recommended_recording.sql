ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "recommended_recording_mbid" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "recommended_recording_title" text;--> statement-breakpoint
ALTER TABLE "recording_artist_cache" ADD COLUMN IF NOT EXISTS "recording_title" text;