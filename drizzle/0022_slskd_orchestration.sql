CREATE TABLE IF NOT EXISTS "slskd_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"target_id" integer NOT NULL,
	"recommendation_id" integer,
	"source_type" text NOT NULL,
	"work_key" text NOT NULL,
	"artist_mbid" uuid NOT NULL,
	"artist_name" text NOT NULL,
	"release_group_mbid" text,
	"release_title" text NOT NULL,
	"lidarr_artist_id" integer,
	"lidarr_album_id" integer,
	"state" text DEFAULT 'pending' NOT NULL,
	"confidence" real,
	"slskd_search_id" text,
	"slskd_queue_id" text,
	"slskd_download_id" text,
	"selected_result" jsonb,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'slskd_jobs_user_id_users_id_fk'
 ) THEN
  ALTER TABLE "slskd_jobs" ADD CONSTRAINT "slskd_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'slskd_jobs_target_id_targets_id_fk'
 ) THEN
  ALTER TABLE "slskd_jobs" ADD CONSTRAINT "slskd_jobs_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'slskd_jobs_recommendation_id_recommendations_id_fk'
 ) THEN
  ALTER TABLE "slskd_jobs" ADD CONSTRAINT "slskd_jobs_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "slskd_jobs_active_work_key_idx" ON "slskd_jobs" USING btree ("work_key") WHERE "state" in ('pending', 'searching', 'queued', 'downloading', 'import_pending');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slskd_jobs_state_idx" ON "slskd_jobs" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slskd_jobs_user_state_idx" ON "slskd_jobs" USING btree ("user_id","state");
