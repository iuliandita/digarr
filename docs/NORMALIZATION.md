# Name normalization

Several tables store a normalized artist name or album title and use it as a lookup or conflict key. Changing a normalizer is therefore a data migration, not a code-only change: rows written under the old rule keep the old key until something rewrites them. This document lists every persisted key and the steps a rule change needs. Nothing here is implemented yet; it is the plan for a future change ([#920](https://github.com/iuliandita/digarr/issues/920)).

`tests/core/normalization-contract.test.ts` pins representative outputs of every persisted normalizer. If you need to change an expected value there, follow the plan below in the same PR.

## Persisted keys

### `library_artists.name_normalized`

- Rule: `normalizeArtistName()` in `src/core/library/normalize.ts`. NFD, strip combining marks U+0300-U+036F, lowercase, drop parentheticals, drop `feat.`/`featuring`/`ft.` suffixes, ` & ` to ` and `, drop a leading `the `, drop an interior `, the `, collapse whitespace, trim.
- The output stays in NFD. Hangul syllables are stored as decomposed jamo and voiced kana as base kana plus a combining mark. Fullwidth Latin is not folded.
- Written by the reconciler (`src/core/library/reconciler.ts`) on every library sync; the store replaces a source's rows wholesale (`replaceArtistRows` in `src/core/library/store.ts`).
- Read by `findReconciledByNormalizedName` (the reconciler's cache short-circuit, across sources and the shared Lidarr rows) and by `listArtistMatches`, which reuses a previous match on a MusicBrainz failure only when the stored key equals the new one. The reconciler also sends the key as the MusicBrainz search query and keeps only results whose primary name normalizes to the same key, falling back to their aliases and sort name when no primary name matches. The library API returns it as `nameNormalized`.
- Indexes: `library_artists_name_idx (user_id, name_normalized)`, not unique. The unique natural key is `(user_id, source, source_artist_id)`.
- Raw input is kept in `name`, so the key can be recomputed.

### `library_albums.title_normalized`

- Rule: `normalizeAlbumTitle()` in the same file. NFD, strip marks, lowercase, drop parenthesized or bracketed `deluxe`/`expanded`/`remaster(ed)`/`edition` qualifiers, collapse whitespace, trim.
- Written by `src/core/library/album-reconciler.ts`. Album matching compares freshly normalized MusicBrainz release-group titles in memory, falling back to the release groups' aliases when no primary title matches; the stored value is only returned by the library API (`titleNormalized`).
- No index on it. Raw input is kept in `title`.

### `artist_genre_aliases.name_normalized`

- Rule: `artistKey()` in `src/core/pipeline/genre-backfill.ts`: `trim().toLowerCase()`. No Unicode normalization, no whitespace collapsing.
- Written by the genre warmer after a name-only artist resolves to exactly one MusicBrainz artist (`upsertArtistGenreAlias` in `src/db/queries/artists.ts`).
- Read by `getArtistGenreCacheByAliases` during genre hydration and warming.
- Index: unique `artist_genre_aliases_source_name_unique (source, name_normalized)`.
- The raw name is not stored. Recomputing is only possible when the new rule can be applied to the old key and give the same result as applying it to the raw name.

### `artist_metadata.name_normalized`

- Rule: `artistMetadataKey()` in `src/db/queries/artist-metadata.ts`: `trim().toLowerCase()`.
- Written by `bulkUpsert`, fed by `scripts/import-artist-metadata.ts`, which computes `name.toLowerCase()` on an already trimmed name (same result, separate code).
- Read by `lookupByName`, by `getPopularityMap` (the scorer in `src/core/pipeline/score.ts` looks names up with its own inline `trim().toLowerCase()`), and by the SQL join in `src/db/queries/recommendations.ts`: `name_normalized = lower(artists.name)`. That join is a second implementation of the rule in Postgres: it does not trim, and Postgres `lower()` follows the database collation rather than JavaScript's `toLowerCase()`.
- Index: unique constraint `artist_metadata_name_normalized_unique`.
- Raw input is kept in `name`.

### Backup restore conflict keys

`RESTORE_ORDER` in `src/core/ops/backup.ts` upserts `artistGenreAliases` on `(source, nameNormalized)` and `artistMetadata` on `nameNormalized`. Restore clears the included tables first, so the conflict target mostly matters for duplicates inside the backup itself. `libraryArtists` and `libraryAlbums` restore on their `id`, carrying the stored key as-is. Backups are `version: 1` and record `appVersion`; there is no field describing which normalization rule produced the keys.

### Not persisted

- `normalizeArtistName()` in `src/core/pipeline/resolve.ts` (NFC, lowercase, trim, collapse whitespace) groups discovered artists and compares MusicBrainz names in memory. It can change without a migration, but changing it changes which candidates resolve.
- The reconciler reuses the library `normalizeArtistName()` on album titles for overlap scoring, in memory only.
- Library health groups Lidarr artists by `toLowerCase()` in memory.
- Recommendations, blocks, slskd work keys, and the recording cache are keyed by IDs or MBIDs, not names.

## Changing a rule

### Recompute

The rules are JavaScript and do not translate exactly to SQL (Unicode normalization, regexes, collation-dependent `lower()`), so recompute in the startup pre-flight, not in a SQL migration.

1. Add a marker migration (for example `00NN_renormalize_artist_keys.sql`) so the change shows up as a pending migration. It can carry related DDL or be a no-op statement.
2. Add a step to `src/core/ops/upgrade.ts` next to `dedupeBeforeUniqueIndexes`, gated on that marker being pending. `runPreFlightCheck` runs it after the automatic backup and before migrations, on both PostgreSQL and PGlite, including the `DIGARR_AUTO_BACKUP=false` path.
3. In one transaction, per table: read `id` and the raw column, compute the new key in JavaScript, resolve collisions (below), then update changed rows in chunks. Log per-table counts the way the 0024/0028 pre-step does.
4. Keep the step idempotent. Running the new rule over already recomputed rows must change nothing.

Per table:

- `library_artists`: recompute from `name`. It also heals on the next full sync of each source, but until then the cache lookup misses and failed MusicBrainz lookups no longer reuse previous matches. The new key is also a different MusicBrainz query.
- `library_albums`: recompute from `title`.
- `artist_metadata`: recompute from `name`. Update the SQL join in `recommendations.ts`, the scorer lookup, and the import script in the same PR.
- `artist_genre_aliases`: recompute from the old key only if the new rule satisfies `new(old(x)) == new(x)` for all inputs (for example, adding diacritic stripping on top of lowercasing). Otherwise delete the rows. They are a cache and the warmer re-resolves them.

### Collisions

Two old keys can map to the same new key.

- `artist_metadata` (unique key): keep the row with the newest `cached_at`, ties by highest `id`, matching `bulkUpsert`'s last-write-wins behavior. Delete the others before updating keys.
- `artist_genre_aliases` (unique per source): if all colliding rows point to the same `mbid`, keep the newest `resolved_at` (ties by `id`). If they point to different MBIDs, the new key is ambiguous; delete all of them, consistent with the warmer skipping ambiguous name matches.
- `library_artists`: no unique index on the key, so nothing to delete. Colliding rows with different MBIDs make the cache lookup ambiguous and fall through to MusicBrainz, which is the intended behavior.
- `library_albums`: no index, nothing to resolve.

Delete losers before updating winners so a unique index never sees two rows with the same key mid-update.

### Restoring older backups

A backup taken before the change carries old keys.

1. Recompute keys during restore with the current rule, before the upsert: `artistMetadata` from `name`, `libraryArtists` from `name`, `libraryAlbums` from `title`, `artistGenreAliases` from the old key or dropped (same condition as the migration). Do this always; it is idempotent for current backups.
2. Collapse collisions inside each table's rows with the same winner rules. A single `INSERT ... ON CONFLICT DO UPDATE` statement fails when two input rows hit the same key, so this cannot be left to the database.
3. If the alias decision depends on which rule wrote the backup, add an optional field to the backup file (for example `keyRules: 2`, absent meaning the current rule) instead of bumping `version`. `restoreBackup` rejects any `version` other than 1, and `backupFileSchema` in `src/server/schemas/admin.ts` drops unknown top-level fields, so the new field must be added there.
4. Mention any dropped alias rows in the restore warnings.

### Rollback and downgrade

- Running the previous image against recomputed keys reproduces the same problem in reverse: library lookups and metadata or alias caches miss until the old code rewrites them. Library rows heal on the next sync; `artist_metadata` needs a re-import or a restore; dropped alias rows are re-resolved by the warmer.
- The migration is lossy when collisions were removed or alias rows dropped. The clean rollback is the automatic pre-migration backup, or a native backup, restored with the previous image.
- A backup taken after the change and restored on the previous image carries new keys. The previous image does not recompute them, so it has the same cache misses until the next sync and re-import.

### Checklist for the PR

- Change the normalizer and update the expected values in `tests/core/normalization-contract.test.ts`.
- Update every writer and reader of the same key, including the SQL join in `src/db/queries/recommendations.ts`, the popularity lookup in `src/core/pipeline/score.ts`, and `scripts/import-artist-metadata.ts`.
- Add the marker migration and the gated recompute step in `src/core/ops/upgrade.ts`, with collision handling per table and logged counts.
- Recompute and collapse keys in `restoreBackup`; add the backup field and schema entry if the alias decision needs it.
- Test the recompute and the restore against isolated PostgreSQL with colliding names and an old-rule backup.
- Record a data-recovery docs receipt with upgrade, backup, and rollback notes in `CHANGELOG.md`, `docs/OPERATIONS.md`, and `docs/guides/switching-backends.md` (see [MAINTENANCE.md](MAINTENANCE.md#breaking-changes-and-migrations)).
- Update this document.
