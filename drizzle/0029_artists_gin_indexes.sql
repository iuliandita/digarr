-- GIN indexes on artist genre/tag arrays. getArtistsByGenre and similar
-- queries do `lower(g) = lower(genreName)` via unnest today, which the
-- planner cannot satisfy from a plain btree. A GIN index on the array
-- columns enables index-only containment checks (genres @> ARRAY['indie']).
--
-- 4.8 (recommendations(user_id, status)) is already covered by
-- recommendations_user_status_score_idx, so only the 4.9 GIN indexes are
-- added here.
CREATE INDEX IF NOT EXISTS artists_genres_gin_idx
  ON artists USING GIN (genres);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS artists_tags_gin_idx
  ON artists USING GIN (tags);
