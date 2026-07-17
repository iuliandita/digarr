# Digarr Architecture

## Overview

Single Bun process serving a Hono API backend + React SPA frontend. PostgreSQL
via Drizzle ORM -- either an external server or the embedded PGlite backend
(see [Database backend](#database-backend)). Frontend is a Vite SPA served by
Hono in production, proxied via Vite dev server in development.

## Authentication boundary

The SPA authenticates with an `HttpOnly; SameSite=Lax` session cookie and never
reads the raw token. The CSRF trust origin, CORS, and the OIDC callback all
derive from the public `ALLOWED_ORIGIN` when it is set; reverse-proxy
deployments must therefore configure the exact external origin, and TLS
termination requires an `https://` value for correct CSRF and public-URL
behavior. The cookie's `Secure` flag reads the public origin protocol only
(never `X-Forwarded-Proto`): in production it fails closed to `Secure` even when
the backend request arrives over HTTP, so only an explicit
`DIGARR_ALLOW_INSECURE_COOKIES=true` on an `http:` public origin drops it. That
override is intended for a production instance served directly over plain HTTP,
which is vulnerable to network interception.

Unsafe `/api/v1/*` requests using cookie or proxy auth require the fixed
`X-Digarr-CSRF: 1` header plus exact same-origin browser evidence. Verified
bearer sessions remain supported for API compatibility and bypass the
ambient-credential CSRF check. Query-token auth remains restricted to the two
safe GET surfaces that need it: pipeline SSE and preview audio.

Password login and registration negotiate cookie mode through
`X-Digarr-Auth-Mode: cookie`; calls without it retain the bearer-token response
contract. The SPA rotates an old stored bearer into a cookie through an atomic,
single-use migration endpoint. OIDC and trusted-proxy auth mint cookies
directly, and the OIDC callback redirects without putting the session token in
the URL. OIDC login state is browser-bound in a state-scoped `HttpOnly`
transaction cookie that the callback consumes: one-time, 10-minute TTL,
multi-tab safe, capacity-capped, and login-rate-limited (10/min/IP on the login
route; the callback is not limited). Password change and session replacement
run as one database transaction under a user-row lock, so a password verified
before a concurrent reset cannot mint a post-reset session.

## Database backend

Digarr runs on PostgreSQL through Drizzle either way, but the backend is chosen
at boot:

- **External PostgreSQL** when a DSN is present -- `DATABASE_URL`, or the
  `DB_HOST` + `DB_USER` + `DB_NAME` triple. Uses a connection pool.
- **Embedded PGlite** otherwise -- real PostgreSQL 18.3 compiled to Wasm,
  running in-process, with the whole database persisted to a single directory at
  `DB_PATH` (image default `/app/data`). No separate database server or
  container.

The DB module resolves the backend once and exposes an eager Drizzle singleton.
On shutdown `closeDb()` flushes the PGlite data to disk (and closes the pool on
the external path), so the data directory is consistent across restarts. The
selected backend is surfaced at `GET /health` (`"dbBackend": "pglite" |
"postgres"`) and printed at startup as `[db] backend=...`.

Boot interaction (see [Boot order](#boot-order)): `waitForDatabase()` only runs
for the external pool (`if (pool)`) -- PGlite is in-process and always ready --
then the same `preFlightCheck()` -> `runMigrations()` path runs for both
backends.

**Invariants and limits.** PGlite is single-writer: the entire database lives in
Wasm linear memory backed by one file, so exactly one replica may own it. The
Helm/k8s opt-in pins `replicaCount=1` and forces the `Recreate` rollout strategy
(no two pods touching the file at once). Because the working set sits in Wasm
memory, PGlite is a scale ceiling -- it fits digarr's small-data, single-writer
profile. Switch to external PostgreSQL for a managed database or larger
datasets, but keep the app at one replica: pipeline coordination, schedulers,
rate limits, and migration locks remain process-local, so a DSN alone does not
make horizontal scaling safe.

**Per-platform defaults.** The container image and the Unraid template default
to embedded PGlite (bare `docker run` with no DB env, or
`deploy/docker/docker-compose.pglite.yml`). The default
`deploy/docker/docker-compose.yml`, the Helm chart, and the raw k8s manifests
default to external PostgreSQL; PGlite is opt-in there (Helm
`--set database.backend=pglite`, which requires a PVC plus `replicaCount=1` and
`Recreate`).

**In-app backend migration.** Admins can switch between PGlite and external
PostgreSQL through Settings -> Administration -> Migrate Database Backend without
stopping the server or writing SQL. The tool (`src/core/ops/migrate-backend.ts`)
runs schema migrations on the target, then opens a consistent source view inside
a `REPEATABLE READ READ ONLY` transaction and copies the restore registry in
foreign key order inside one target transaction. Each table is selected, restored in
chunks, and verified by row count and SHA-256 content hash before the next table
is loaded. The process does not retain whole-source or whole-target backup
objects, so its working set follows the largest individual table instead of the
whole database. A write failure rolls back the target copy transaction before a
`MigrationReport` is returned. During the copy, `maintenanceMiddleware`
blocks all write methods (`POST/PUT/PATCH/DELETE`) on non-migration routes,
returning `503 Maintenance in progress`; reads pass through. Background
schedulers check the same flag (`isMaintenance()` in `src/core/ops/maintenance.ts`)
and skip their ticks while it is set. The routes are
`POST /api/v1/admin/migrate-backend/test` (validate target, non-destructive) and
`POST /api/v1/admin/migrate-backend` (run copy). See
[`docs/guides/switching-backends.md`](guides/switching-backends.md) for the
operator walkthrough.

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
Analyze hydrates listening-artist genres from native source payloads,
`library_artists`, and the `artists` cache before computing the taste profile.
After foreground pipeline work completes, a maintenance-aware warmer queues at
most 10 stale or missing artists through the shared MusicBrainz rate gate; the
next scan consumes the refreshed cache through an ambiguity-checked source/name
alias when the listening source has no MBID. Listening-artist genre data in the
artist cache uses its own freshness timestamp, so unrelated image or metadata
refreshes cannot extend the 180-day genre TTL. Enrichment from
`artist_metadata` still runs between resolve and score.

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

## Preview playback

Recommendation-card tracks and the Discover audition queue share the global
preview context, so starting one preview stops the other audio surface. Deezer
clips advance from the native `ended` event. Spotify audition playback keeps one
persistent local bridge iframe with `sandbox="allow-scripts"` and no
same-origin capability. Spotify's controller script and embed run only inside
that opaque-origin document; the authenticated SPA transfers a private
`MessageChannel` and accepts exact, token-bound playback events. The narrow
protocol carries load/play/pause/destroy commands plus ready, started, state,
and failure events. Playback start, pause, completion deduplication, controller
reuse, and queue advancement remain in the SPA. Bridge initialization is
bounded and falls back to the standard Spotify iframe for standalone previews;
an active audition queue skips the unavailable item. YouTube embeds have no
equivalent completion signal in this integration and use a bounded 30-second
fallback.

## Boot order

Async IIFE in `src/index.ts`:

1. `createJobRecorder(db)` - module-level, before the IIFE
2. `markStuck()` - flips any in-progress jobs left over from a crashed prior run
3. `waitForDatabase()` - external-pool only (`if (pool)`); retry/backoff until Postgres accepts connections (survives a slow PG startup without crash-looping on kubelet); the HTTP server only binds after this succeeds. PGlite is in-process, so it skips this step
4. `preFlightCheck()` - auto-backup if pending migrations are detected
5. `migrate()` - drizzle-kit migrations
6. `autoSetup()` - first-admin bootstrap when the env vars are present
7. Bootstrap user setup
8. Lidarr target backfill
9. Pipeline scheduler
10. Subscription scheduler
11. Playlist scheduler
12. `startStuckDetector()` - cron every 5 min
13. `startDigestNotifier()` - cron driving the scheduled notification digest; no-ops when `digestCron` is unset. `restartDigestNotifier()` re-arms it at runtime when the cron preference changes, so a settings save applies without a restart. Each send covers the window since a persisted last-sent bookmark (advanced only after a successful send, so delivery is at-least-once and restarts or downtime neither double-report nor drop a window); ticks are skipped during maintenance

## Album-level discovery

Albums are a first-class recommendation unit. Key additions:

- **`kind` discriminator** on the `recommendations` table (`'artist' | 'album'`, default `'artist'`). All recommendation queries and API responses include `kind`; the list endpoint accepts a `?kind=` filter.
- **`album_blocks` table** -- per-user, forever-block layer for albums, keyed on release-group MBID. Independent of `artist_blocks`; the filter stage drops candidates matching either block layer.
- **`applyAlbumModifier`** in `src/core/pipeline/score.ts` -- computes a bounded recency / popularity / gap-priority modifier added to the artist-similarity base score, then clamps the result to `[0, 1]`.
- **`addAlbum` target capability** -- approving an album recommendation calls the Lidarr target's `addAlbum` method: adds the artist unmonitored (no whole-discography grab) and monitors + searches only the approved album. If the artist already exists in Lidarr, the existing record is reused (gap-fill safe).
- **Release-radar producer** -- the release-radar discovery mode is the first producer that populates the album substrate. It emits first-class `kind='album'` recommendations for new releases from artists the user already tracks, instead of collapsing them into artist rows, and these land in the Albums tab. With the kind-aware dedup change (below), a tracked artist that drops several releases in one scan window now yields one album recommendation per release in the same run, rather than one per run.
- **Library gap-fill producer** -- a discovery mode whose executor iterates a rotated, bounded slice of the user's tracked artists. The cursor is the `library_artists.last_gap_check_at` column, ordered `asc nulls first` so never-checked artists go first; the slice is bounded (default 25 per run, overridable via the mode's `maxArtistsPerRun` setting) and walked with a p-queue (concurrency 2, 200ms interval) so a large library does not starve the event loop. For each artist it calls the album-coverage engine (`src/core/library/album-coverage.ts`) and emits one `kind='album'` candidate per missing studio album, carrying the release-group MBID and the release year as the recency signal. After the slice runs, the checked artists' `last_gap_check_at` is stamped so the next run advances the cursor. This fills the Albums tab from missing studio albums of artists already in the library.
- **Net-new album discovery producer** -- a gated promotion inside `resolve()` rather than a standalone discovery mode. AI discovery already returns a free-text `suggestedAlbum`; when the `netNewAlbumDiscovery` preference is on (default off) and that title resolves to a real MusicBrainz release group via `matchSuggestedAlbum`, the artist-kind recommendation is promoted to `kind='album'`, carrying the matched release-group MBID and its first-release date as the recency signal. A failed match falls back to artist-kind. With the toggle off, the trailing `promoteSuggestedAlbums` flag is `false` and the resolve path is byte-for-byte the prior behaviour; the only always-on change is that `matchSuggestedAlbum` now also returns the matched release date (unused unless promoting). This rides the same downstream album paths the substrate and the other two producers built (filter partition, album block/dedup, recency/popularity modifier, `kind` persistence), so it needs no orchestrator/filter/scorer changes beyond threading the flag. It completes the album-discovery producer trilogy.
- **Album empty-state routing** -- a normal pipeline scan remains artist-focused. When the album-filtered recommendation list is empty, the frontend links to the two explicit album discovery modes (`gap-fill` and `release-radar`) and to the default-off `netNewAlbumDiscovery` preference. Discovery-mode deep links focus the requested generic mode card; the preference link opens its collapsed settings section and focuses the target.
- **Kind-aware dedup** -- album candidates dedup and group by release-group MBID instead of artist MBID at three points, which is what lets multiple albums per artist survive a single run (and lifted the release-radar one-album-per-artist-per-run cap): the discover-stage dedup keys album candidates on `rg::{releaseGroupMbid}` while artist candidates still key on artist MBID/name (`src/core/pipeline/discover.ts`); `resolve()` partitions album-kind discoveries out of the artist-MBID grouping and groups them by release group, one resolved recommendation per release group (`src/core/pipeline/resolve.ts`); and the resolve final dedup keys album-kind recommendations on `{artistMbid}::{releaseGroupMbid}` so distinct albums for the same artist are kept.

## Key invariants

- Config precedence: DB settings (single row, `id=1`) override env vars. Per-user credentials live on the `users` table; global settings are the fallback.
- Provider, metadata, and playlist-target requests go through
  `createHttpClient()` in `src/core/clients/http.ts` for timeout, retry/backoff,
  JSON parsing, response-body errors, redaction, and optional TLS-skip behavior.
  Read-only calls retain the client retry default. Duplicate-producing playlist
  creation and song-add calls pass `retries: 0`; this classification is based on
  endpoint semantics because Subsonic mutations use GET-shaped endpoints.
- Emby, Jellyfin, and Subsonic source clients each own a media-server request
  queue capped at three concurrent requests and ten starts per second. This is
  an internal load-smoothing policy for self-hosted servers, not a claimed
  vendor limit. It is deliberately per client instance; configurable overrides
  and queue metrics remain deferred until an operational need is demonstrated.
- Field-level encryption uses AES-256-GCM with HKDF-derived keys (`src/core/crypto.ts`). Encrypted DB values are prefixed `enc:v1:`. Legacy SHA-256 decryption is retained as a read-path fallback for pre-migration values.
- Tests run in Node.js (vitest), not Bun. `Bun.serve()`, `Bun.file()` and similar Bun-only APIs are unavailable in tests; password hashing uses `node:crypto` `scrypt`.
- Migrations are idempotent. Drizzle generates bare DDL, so every generated migration must add `IF NOT EXISTS` / `IF EXISTS` clauses by hand.
- Backup restore runs in a single DB transaction. Upsert conflict targets are natural keys (`mbid`, `slug`, `nameNormalized`, `token`), not serial IDs.
- Backend migration never modifies the source database. Verification (row count + content hash) must pass before `ok: true` is returned; any mismatch surfaces in `MigrationReport.mismatches`.
- Scoring uses the shared `computeWeightedScore()` in `src/core/pipeline/score.ts`. All callers (main pipeline + hygiene rescorer) clamp results to `[0, 1]` regardless of user weight sums.

See `AGENTS.md` for the gotchas, external-API quirks, and CI notes that
accumulate faster than this doc should; `AGENTS.md` stays the living ops file.
