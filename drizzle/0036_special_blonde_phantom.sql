ALTER TABLE "library_artists" ADD COLUMN IF NOT EXISTS "last_gap_check_at" timestamp with time zone;
