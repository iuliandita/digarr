CREATE TABLE IF NOT EXISTS "library_album_match_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"source" text NOT NULL,
	"source_album_id" text NOT NULL,
	"correct_album_mbid" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'library_album_match_overrides_user_id_users_id_fk'
	) THEN
		ALTER TABLE "library_album_match_overrides"
			ADD CONSTRAINT "library_album_match_overrides_user_id_users_id_fk"
			FOREIGN KEY ("user_id")
			REFERENCES "public"."users"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_album_match_overrides_natural_key_idx" ON "library_album_match_overrides" USING btree ("user_id","source","source_album_id");
