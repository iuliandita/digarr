CREATE INDEX IF NOT EXISTS "artist_blocks_artist_idx" ON "artist_blocks" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genres_parent_genre_id_idx" ON "genres" USING btree ("parent_genre_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_runs_user_id_idx" ON "job_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_runs_batch_id_idx" ON "job_runs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_batches_subscription_id_idx" ON "recommendation_batches" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slskd_jobs_target_id_idx" ON "slskd_jobs" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slskd_jobs_recommendation_id_idx" ON "slskd_jobs" USING btree ("recommendation_id");
