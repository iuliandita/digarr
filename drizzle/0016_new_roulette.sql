CREATE TABLE IF NOT EXISTS "library_albums" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"source" text NOT NULL,
	"source_album_id" text NOT NULL,
	"source_artist_id" text NOT NULL,
	"title" text NOT NULL,
	"title_normalized" text NOT NULL,
	"album_mbid" uuid,
	"artist_mbid" uuid,
	"release_year" integer,
	"primary_type" text,
	"match_method" text,
	"match_confidence" real,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_artists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"source" text NOT NULL,
	"source_artist_id" text NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"mbid" uuid,
	"match_method" text,
	"match_confidence" real,
	"genres" text[],
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_match_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"source" text NOT NULL,
	"source_artist_id" text NOT NULL,
	"correct_mbid" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_sync_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"source" text NOT NULL,
	"last_sync_started_at" timestamp with time zone,
	"last_sync_completed_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_error" text,
	"last_sync_counts" jsonb
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "library_sync_interval_hours" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "library_albums" ADD CONSTRAINT "library_albums_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_artists" ADD CONSTRAINT "library_artists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_match_overrides" ADD CONSTRAINT "library_match_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_sync_state" ADD CONSTRAINT "library_sync_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_albums_natural_key_idx" ON "library_albums" USING btree ("user_id","source","source_album_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_albums_artist_idx" ON "library_albums" USING btree ("user_id","artist_mbid");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_artists_natural_key_idx" ON "library_artists" USING btree ("user_id","source","source_artist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_artists_dedup_idx" ON "library_artists" USING btree ("user_id","mbid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_artists_name_idx" ON "library_artists" USING btree ("user_id","name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_match_overrides_natural_key_idx" ON "library_match_overrides" USING btree ("user_id","source","source_artist_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_sync_state_natural_key_idx" ON "library_sync_state" USING btree ("user_id","source");
