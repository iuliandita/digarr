-- library_sync_state, library_match_overrides, and library_album_match_overrides
-- use (user_id, source[, source_*_id]) as their natural upsert key, but user_id
-- is nullable (shared/global sync cursor == NULL). By default Postgres unique
-- indexes treat NULL values as distinct, which means ON CONFLICT cannot match
-- an existing NULL-user_id row and would insert duplicates on retry.
--
-- Postgres 15+ supports NULLS NOT DISTINCT on unique indexes. Replace each
-- natural-key index with a NULLS NOT DISTINCT variant so upserts are
-- race-safe for both null and non-null user_id.
DROP INDEX IF EXISTS library_sync_state_natural_key_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX library_sync_state_natural_key_idx
  ON library_sync_state (user_id, source) NULLS NOT DISTINCT;
--> statement-breakpoint
DROP INDEX IF EXISTS library_match_overrides_natural_key_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX library_match_overrides_natural_key_idx
  ON library_match_overrides (user_id, source, source_artist_id) NULLS NOT DISTINCT;
--> statement-breakpoint
DROP INDEX IF EXISTS library_album_match_overrides_natural_key_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX library_album_match_overrides_natural_key_idx
  ON library_album_match_overrides (user_id, source, source_album_id) NULLS NOT DISTINCT;
