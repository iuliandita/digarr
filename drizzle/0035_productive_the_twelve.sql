CREATE TABLE IF NOT EXISTS "album_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"artist_id" integer NOT NULL,
	"release_group_mbid" text NOT NULL,
	"reason" text,
	"reason_text" text,
	"source" text DEFAULT 'rejection' NOT NULL,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'artist' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'album_blocks_user_id_users_id_fk'
 ) THEN
  ALTER TABLE "album_blocks" ADD CONSTRAINT "album_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'album_blocks_artist_id_artists_id_fk'
 ) THEN
  ALTER TABLE "album_blocks" ADD CONSTRAINT "album_blocks_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "album_blocks_user_release_group_idx" ON "album_blocks" USING btree ("user_id","release_group_mbid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_blocks_user_idx" ON "album_blocks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_blocks_artist_idx" ON "album_blocks" USING btree ("artist_id");
