CREATE TABLE IF NOT EXISTS "recording_artist_cache" (
	"recording_mbid" uuid PRIMARY KEY NOT NULL,
	"artist_mbid" uuid NOT NULL,
	"artist_name" text NOT NULL,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL
);
