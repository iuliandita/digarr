ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "genres_cached_at" timestamp with time zone;
