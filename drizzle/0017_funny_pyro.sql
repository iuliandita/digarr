CREATE TABLE IF NOT EXISTS "library_album_match_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	"source" text NOT NULL,
	"source_album_id" text NOT NULL,
	"correct_album_mbid" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_album_match_overrides_natural_key_idx" ON "library_album_match_overrides" USING btree ("user_id","source","source_album_id");
