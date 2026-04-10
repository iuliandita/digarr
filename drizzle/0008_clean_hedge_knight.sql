CREATE TABLE IF NOT EXISTS "artist_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"spotify_genres" text[],
	"spotify_popularity" integer,
	"deezer_fans" integer,
	"cached_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "artist_metadata_name_normalized_unique" UNIQUE("name_normalized")
);
