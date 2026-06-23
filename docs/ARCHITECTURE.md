# Digarr Architecture

## Overview

Single Bun process serving a Hono API backend + React SPA frontend. Postgres
via Drizzle ORM. Frontend is a Vite SPA served by Hono in production, proxied
via Vite dev server in development.

## Pipeline

Seven stages:

1. **Collect** - gather seed artists from the user's library and listening history
2. **Analyze** - extract profile features (preferred genres, eras, popularity)
3. **Discover** - ask providers (AI + similarity sources) for candidates
4. **Resolve** - canonicalize candidates to MusicBrainz IDs
5. **Score** - weighted feature scoring, clamped to [0, 1]
6. **Filter** - dedupe across batches, apply rejection cooldown, threshold
7. **Store** - persist recommendations with status = 'discovered'

Pure functions live in `src/core/pipeline/`. The orchestrator
(`src/core/pipeline/orchestrator.ts`) composes the stages and emits SSE progress.
Genre enrichment from `artist_metadata` runs between resolve and score.

The filter stage partitions candidates by `kind`. Artist-kind candidates run the
full artist-existence / library / top-artist filters. Album-kind candidates
bypass those artist-oriented filters (a new release from a tracked artist is the
point, not a rejection cause) but still pass the album block layer, cross-batch
dedup, and the score threshold.

## Registry patterns

Five extension points, each registry-based:

- `DestinationTarget` - where recommendations are pushed (Lidarr, Emby, `slskd`, ...)
- `SubscriptionAdapter` - how recurring seeds are sourced (CSV, Spotify saved, ...)
- `SearchSource` - multi-source artist / track search (Lidarr, MusicBrainz, Deezer, ...)
- `RecommendationProvider` - AI backends (Anthropic, OpenAI, Gemini, Ollama, ...)
- `DiscoveryMode` - on-demand / savable discovery flows, registered in `src/core/discovery-modes/registry.ts` (ListenBrainz radio, Release Radar, Library Gap-Fill, Charts, Deezer Flow, Spotify Saved Albums, ...). A new mode is a factory plus a `registry.register` line plus an availability branch; the frontend renders modes generically, so no frontend change is needed

Adding a new implementation means:

1. Implement the interface in `src/core/<kind>/adapters/<name>.ts`
2. Register in `src/core/<kind>/registry.ts`
3. Add a settings schema and UI when the adapter is user-configurable

## Boot order

Async IIFE in `src/index.ts`:

1. `createJobRecorder(db)` - module-level, before the IIFE
2. `markStuck()` - flips any in-progress jobs left over from a crashed prior run
3. `waitForDatabase()` - retry/backoff until Postgres accepts connections (survives a slow PG startup without crash-looping on kubelet); the HTTP server only binds after this succeeds
4. `preFlightCheck()` - auto-backup if pending migrations are detected
5. `migrate()` - drizzle-kit migrations
6. `autoSetup()` - first-admin bootstrap when the env vars are present
7. Bootstrap user setup
8. Lidarr target backfill
9. Pipeline scheduler
10. Subscription scheduler
11. Playlist scheduler
12. `startStuckDetector()` - cron every 5 min
13. `startDigestNotifier()` - cron driving the scheduled notification digest; no-ops when `digestCron` is unset. `restartDigestNotifier()` re-arms it at runtime when the cron preference changes, so a settings save applies without a restart

## Album-level discovery

Albums are a first-class recommendation unit. Key additions:

- **`kind` discriminator** on the `recommendations` table (`'artist' | 'album'`, default `'artist'`). All recommendation queries and API responses include `kind`; the list endpoint accepts a `?kind=` filter.
- **`album_blocks` table** -- per-user, forever-block layer for albums, keyed on release-group MBID. Independent of `artist_blocks`; the filter stage drops candidates matching either block layer.
- **`applyAlbumModifier`** in `src/core/pipeline/score.ts` -- computes a bounded recency / popularity / gap-priority modifier added to the artist-similarity base score, then clamps the result to `[0, 1]`.
- **`addAlbum` target capability** -- approving an album recommendation calls the Lidarr target's `addAlbum` method: adds the artist unmonitored (no whole-discography grab) and monitors + searches only the approved album. If the artist already exists in Lidarr, the existing record is reused (gap-fill safe).
- **Release-radar producer** -- the release-radar discovery mode is the first producer that populates the album substrate. It emits first-class `kind='album'` recommendations for new releases from artists the user already tracks, instead of collapsing them into artist rows, and these land in the Albums tab. With the kind-aware dedup change (below), a tracked artist that drops several releases in one scan window now yields one album recommendation per release in the same run, rather than one per run.
- **Library gap-fill producer** -- a discovery mode whose executor iterates a rotated, bounded slice of the user's tracked artists. The cursor is the `library_artists.last_gap_check_at` column, ordered `asc nulls first` so never-checked artists go first; the slice is bounded (default 25 per run, overridable via the mode's `maxArtistsPerRun` setting) and walked with a p-queue (concurrency 2, 200ms interval) so a large library does not starve the event loop. For each artist it calls the album-coverage engine (`src/core/library/album-coverage.ts`) and emits one `kind='album'` candidate per missing studio album, carrying the release-group MBID and the release year as the recency signal. After the slice runs, the checked artists' `last_gap_check_at` is stamped so the next run advances the cursor. This fills the Albums tab from missing studio albums of artists already in the library.
- **Net-new album discovery producer** -- a gated promotion inside `resolve()` rather than a standalone discovery mode. AI discovery already returns a free-text `suggestedAlbum`; when the `netNewAlbumDiscovery` preference is on (default off) and that title resolves to a real MusicBrainz release group via `matchSuggestedAlbum`, the artist-kind recommendation is promoted to `kind='album'`, carrying the matched release-group MBID and its first-release date as the recency signal. A failed match falls back to artist-kind. With the toggle off, the trailing `promoteSuggestedAlbums` flag is `false` and the resolve path is byte-for-byte the prior behaviour; the only always-on change is that `matchSuggestedAlbum` now also returns the matched release date (unused unless promoting). This rides the same downstream album paths the substrate and the other two producers built (filter partition, album block/dedup, recency/popularity modifier, `kind` persistence), so it needs no orchestrator/filter/scorer changes beyond threading the flag. It completes the album-discovery producer trilogy.
- **Kind-aware dedup** -- album candidates dedup and group by release-group MBID instead of artist MBID at three points, which is what lets multiple albums per artist survive a single run (and lifted the release-radar one-album-per-artist-per-run cap): the discover-stage dedup keys album candidates on `rg::{releaseGroupMbid}` while artist candidates still key on artist MBID/name (`src/core/pipeline/discover.ts`); `resolve()` partitions album-kind discoveries out of the artist-MBID grouping and groups them by release group, one resolved recommendation per release group (`src/core/pipeline/resolve.ts`); and the resolve final dedup keys album-kind recommendations on `{artistMbid}::{releaseGroupMbid}` so distinct albums for the same artist are kept.

## Key invariants

- Config precedence: DB settings (single row, `id=1`) override env vars. Per-user credentials live on the `users` table; global settings are the fallback.
- All external HTTP goes through `createHttpClient()` in `src/core/clients/http.ts` (retry, backoff, optional TLS-skip).
- Field-level encryption uses AES-256-GCM with HKDF-derived keys (`src/core/crypto.ts`). Encrypted DB values are prefixed `enc:v1:`. Legacy SHA-256 decryption is retained as a read-path fallback for pre-migration values.
- Tests run in Node.js (vitest), not Bun. `Bun.serve()`, `Bun.file()` and similar Bun-only APIs are unavailable in tests; password hashing uses `node:crypto` `scrypt`.
- Migrations are idempotent. Drizzle generates bare DDL, so every generated migration must add `IF NOT EXISTS` / `IF EXISTS` clauses by hand.
- Backup restore runs in a single DB transaction. Upsert conflict targets are natural keys (`mbid`, `slug`, `nameNormalized`, `token`), not serial IDs.
- Scoring uses the shared `computeWeightedScore()` in `src/core/pipeline/score.ts`. All callers (main pipeline + hygiene rescorer) clamp results to `[0, 1]` regardless of user weight sums.

See `AGENTS.md` for the gotchas, external-API quirks, and CI notes that
accumulate faster than this doc should; `AGENTS.md` stays the living ops file.
