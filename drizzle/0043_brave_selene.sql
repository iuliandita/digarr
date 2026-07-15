CREATE TABLE IF NOT EXISTS "artist_genre_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"name_normalized" text NOT NULL,
	"mbid" uuid NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conname = 'artist_genre_aliases_mbid_artists_mbid_fk'
 ) THEN
  ALTER TABLE "artist_genre_aliases" ADD CONSTRAINT "artist_genre_aliases_mbid_artists_mbid_fk" FOREIGN KEY ("mbid") REFERENCES "public"."artists"("mbid") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artist_genre_aliases_source_name_unique" ON "artist_genre_aliases" USING btree ("source","name_normalized");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artist_genre_aliases_mbid_idx" ON "artist_genre_aliases" USING btree ("mbid");
