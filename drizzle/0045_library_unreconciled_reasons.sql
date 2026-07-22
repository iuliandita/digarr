ALTER TABLE "library_albums" ADD COLUMN IF NOT EXISTS "unreconciled_reason" text;--> statement-breakpoint
ALTER TABLE "library_artists" ADD COLUMN IF NOT EXISTS "unreconciled_reason" text;
