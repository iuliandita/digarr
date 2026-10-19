CREATE TABLE IF NOT EXISTS "musicbrainz_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" integer NOT NULL,
	"body" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "musicbrainz_cache_expires_at_idx" ON "musicbrainz_cache" USING btree ("expires_at");