-- Add missing indexes on foreign-key columns. Postgres does NOT auto-index FK
-- columns; without these, cascading updates/deletes and joins against the
-- parent tables degrade to sequential scans once row counts grow.
--
-- Note: we use plain CREATE INDEX (not CONCURRENTLY) because drizzle-orm's
-- migrator wraps the batch in a transaction and CONCURRENTLY cannot run inside
-- a transaction. Digarr is a single-process self-hosted app and deploys are
-- already downtime events (Recreate strategy), so the brief table lock is
-- acceptable.
CREATE INDEX IF NOT EXISTS genres_parent_genre_id_idx
  ON genres(parent_genre_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS recommendation_batches_subscription_id_idx
  ON recommendation_batches(subscription_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_runs_user_id_idx
  ON job_runs(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_runs_batch_id_idx
  ON job_runs(batch_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS slskd_jobs_target_id_idx
  ON slskd_jobs(target_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS slskd_jobs_recommendation_id_idx
  ON slskd_jobs(recommendation_id);
