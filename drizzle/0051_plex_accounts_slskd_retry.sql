DROP INDEX IF EXISTS "slskd_jobs_active_work_key_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plex_account_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plex_account_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plex_machine_identifier" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "slskd_jobs_active_work_key_idx" ON "slskd_jobs" USING btree ("work_key") WHERE "slskd_jobs"."state" in ('pending', 'searching', 'queued', 'downloading', 'import_pending', 'failed');