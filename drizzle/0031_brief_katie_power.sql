CREATE TABLE IF NOT EXISTS "artist_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"artist_id" integer NOT NULL,
	"reason" text,
	"reason_text" text,
	"source" text DEFAULT 'rejection' NOT NULL,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "rejection_reason_text" text;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'artist_blocks_user_id_users_id_fk'
 ) THEN
  ALTER TABLE "artist_blocks" ADD CONSTRAINT "artist_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'artist_blocks_artist_id_artists_id_fk'
 ) THEN
  ALTER TABLE "artist_blocks" ADD CONSTRAINT "artist_blocks_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artist_blocks_user_artist_idx" ON "artist_blocks" USING btree ("user_id","artist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artist_blocks_user_idx" ON "artist_blocks" USING btree ("user_id");
