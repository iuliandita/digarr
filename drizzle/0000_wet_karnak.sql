CREATE TABLE IF NOT EXISTS "artists" (
	"id" serial PRIMARY KEY NOT NULL,
	"mbid" uuid NOT NULL,
	"name" text NOT NULL,
	"disambiguation" text,
	"tags" text[],
	"genres" text[],
	"image_url" text,
	"streaming_urls" jsonb,
	"cached_at" timestamp with time zone,
	CONSTRAINT "artists_mbid_unique" UNIQUE("mbid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recommendation_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_config" jsonb,
	"stats" jsonb,
	"status" text DEFAULT 'running' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"artist_id" integer NOT NULL,
	"batch_id" integer NOT NULL,
	"score" real NOT NULL,
	"sources" jsonb,
	"ai_reasoning" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"lidarr_artist_id" integer,
	"lidarr_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acted_on_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"lidarr_url" text,
	"lidarr_api_key" text,
	"listenbrainz_username" text,
	"listenbrainz_token" text,
	"lastfm_username" text,
	"lastfm_api_key" text,
	"ai_provider" text,
	"ai_api_key" text,
	"ai_model" text,
	"ai_base_url" text,
	"preferences" jsonb,
	"setup_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'recommendations_artist_id_artists_id_fk'
	) THEN
		ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'recommendations_batch_id_recommendation_batches_id_fk'
	) THEN
		ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_batch_id_recommendation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."recommendation_batches"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
