CREATE INDEX IF NOT EXISTS "playlist_tracks_playlist_position_idx" ON "playlist_tracks" USING btree ("playlist_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playlists_user_id_idx" ON "playlists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playlists_enabled_last_generated_idx" ON "playlists" USING btree ("enabled","last_generated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendations_batch_idx" ON "recommendations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendations_artist_idx" ON "recommendations" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendations_user_status_score_idx" ON "recommendations" USING btree ("user_id","status","score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendations_user_created_idx" ON "recommendations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendations_user_acted_on_idx" ON "recommendations" USING btree ("user_id","acted_on_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendations_status_acted_on_idx" ON "recommendations" USING btree ("status","acted_on_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_expires_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_user_id_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_enabled_idx" ON "subscriptions" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "targets_user_id_idx" ON "targets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "targets_type_idx" ON "targets" USING btree ("type");
