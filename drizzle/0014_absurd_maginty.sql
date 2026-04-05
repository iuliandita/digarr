CREATE TABLE IF NOT EXISTS "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"user_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_results" jsonb,
	"subscription_id" integer,
	"batch_id" integer
);
--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_batch_id_recommendation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."recommendation_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_job_runs_type_started ON job_runs (type, started_at DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_job_runs_subscription ON job_runs (subscription_id) WHERE subscription_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_job_runs_running ON job_runs (status) WHERE status = 'running';--> statement-breakpoint
INSERT INTO job_runs (type, status, started_at, completed_at, duration_ms, error, metadata, subscription_id, batch_id)
SELECT
  'subscription',
  CASE WHEN error IS NOT NULL THEN 'failed' ELSE 'completed' END,
  started_at,
  completed_at,
  CASE WHEN completed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (completed_at - started_at))::integer * 1000 END,
  error,
  jsonb_build_object('artistsFound', COALESCE(artists_found, 0), 'artistsNew', COALESCE(artists_new, 0)),
  subscription_id,
  batch_id
FROM subscription_runs;--> statement-breakpoint
DROP TABLE IF EXISTS subscription_runs;
