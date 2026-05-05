CREATE INDEX IF NOT EXISTS "idx_job_runs_subscription" ON "job_runs" USING btree ("subscription_id") WHERE "job_runs"."subscription_id" IS NOT NULL;
