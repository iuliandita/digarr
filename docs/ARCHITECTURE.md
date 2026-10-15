# Digarr Architecture

## Overview

Digarr runs as one Bun process with a Hono API and React frontend. Drizzle connects to a PostgreSQL server or embedded PGlite (see [Database backend](#database-backend)). Hono serves the built frontend in production; Vite serves it during development.

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

OIDC account linking reuses that callback with a server-owned transaction
purpose. Initiation requires a cookie session and fresh password proof. The
link callback locks the user and initiating session, rechecks the password
fingerprint and session validity, and updates only the OIDC subject. It never
creates an account or session; the unique subject index prevents linking one
identity to two accounts.

## Database backend

Digarr runs on PostgreSQL through Drizzle either way, but the backend is chosen
at boot:

- **PostgreSQL server** when a DSN is present -- `DATABASE_URL`, or the
  `DB_HOST` + `DB_USER` + `DB_NAME` triple. Uses a connection pool.
- **Embedded PGlite** otherwise -- PostgreSQL compiled to Wasm,
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

**Invariants and limits.** PGlite is single-writer: the database runs in
Wasm and persists in a data directory, so exactly one replica may own it. The
Helm opt-in requires `replicaCount=1` and forces the `Recreate` rollout strategy
(no two pods touching the file at once). Raw manifests require manual PVC, strategy, environment, and memory-limit edits; see their deployment comments. Because the working set sits in Wasm
memory, PGlite is a scale ceiling -- it fits digarr's small-data, single-writer
profile. Switch to a PostgreSQL server for a managed database or larger
datasets, but keep the app at one replica: pipeline coordination, schedulers,
rate limits, and migration locks remain process-local, so a DSN alone does not
make horizontal scaling safe.

**Per-platform defaults.** The container image and the Unraid template default
to embedded PGlite (bare `docker run` with no DB env, or
`deploy/docker/docker-compose.pglite.yml`). The default
`deploy/docker/docker-compose.yml` and the Helm chart bundle PostgreSQL; a user-managed external server can be configured instead.

The Helm-generated `deploy/k8s/rendered.yaml` snapshot also includes PostgreSQL, while the standalone reference `deploy/k8s/deployment.yaml` requires a supplied `DATABASE_URL` and provisions no database.

For Helm, opt into PGlite with `--set database.backend=pglite`; this requires a PVC plus `replicaCount=1` and `Recreate`. The standalone raw manifest requires the manual changes described above.

**In-app backend migration.** Admins can switch between PGlite and a
PostgreSQL server through Settings > Administration > Migrate Database Backend without
stopping the server or writing SQL. The tool (`src/core/ops/migrate-backend.ts`)
runs schema migrations on the target, then opens a consistent source view inside
a `REPEATABLE READ READ ONLY` transaction and copies the restore registry in
foreign key order inside one target transaction. Each table is selected, restored in
chunks, and verified by row count and SHA-256 content hash before the next table
is loaded. The process does not retain whole-source or whole-target backup
objects, so its working set follows the largest individual table instead of the
whole database. A copy write failure rolls back the target copy transaction and
propagates as HTTP `500`, without a `MigrationReport`. Verification mismatches
return HTTP `422` with a report extension; they do not roll back the copied rows. During the copy, `maintenanceMiddleware`
blocks all write methods (`POST/PUT/PATCH/DELETE`) on non-migration routes,
returning `503 Maintenance in progress`; reads pass through. Background
schedulers check the same flag (`isMaintenance()` in `src/core/ops/maintenance.ts`)
and skip their ticks while it is set. The routes are
`POST /api/v1/admin/migrate-backend/test` (validate target, non-destructive) and
`POST /api/v1/admin/migrate-backend` (run copy). See
[`docs/guides/switching-backends.md`](guides/switching-backends.md) for the
operator walkthrough.

## Dashboard listening history

Listening routes preserve configuration, empty-result, and failure outcomes separately from their returned entries. A successful fallback with entries wins; without entries, any attempted source failure produces an error outcome. ListenBrainz artist statistics map HTTP 204 to an empty result locally, while the shared JSON transport continues to reject missing response bodies elsewhere.

The dashboard distinguishes loading, unconfigured, empty, and failed history and retries failed queries on request. Its listening query functions reject HTTP 200 source-error outcomes as query failures, retaining the last successful matching query data with the existing failure notice. Successful retries, empty periods, and unconfigured responses replace old rows normally. Range/page keys and session cache clearing keep their existing boundaries; no separate history cache is added. The server outcome contract and successful provider fallback remain unchanged ([#770](https://github.com/iuliandita/digarr/issues/770)).

## Pipeline

Seven stages:

1. **Collect** - gather seed artists from the user's library and listening history
2. **Analyze** - build weighted artist and genre profiles, genre coverage, and listening totals and trends
3. **Discover** - ask providers (AI + similarity sources) for candidates
4. **Resolve** - canonicalize candidates to MusicBrainz IDs, then enrich sparse genres from cached metadata
5. **Score** - weighted feature scoring, clamped to [0, 1]
6. **Filter** - dedupe across batches, apply rejection cooldown, threshold
7. **Store** - persist recommendations with status = 'pending'

Pure functions live in `src/core/pipeline/`. The orchestrator
(`src/core/pipeline/orchestrator.ts`) composes the stages and emits SSE progress.

In v2.0.0, cooperative cancellation retains coordinator ownership until active operations and awaited bookkeeping settle. Storage stops between complete artist/recommendation units; automatic approval drains an attempted target and records its outcome before skipping later work. Final success bookkeeping has an explicit commitment boundary after which cancellation is declined. Terminal progress follows settlement, with no timer-based forced unlock. Successful writes are retained; this lifecycle does not make all background jobs idle ([#790](https://github.com/iuliandita/digarr/issues/790)).

In v2.0.0, Quick Discover preserves the explicit seed add at score `1.0` with MusicBrainz-only resolution, but applies the same owner-scoped library, recommendation deduplication, block, cooldown, and threshold policy as similar results before storage. It refreshes recommendation deduplication after seed storage. Job stored counts sum actual successful writes from the completed seed and similar-result batches, including seed-only runs; fatal storage or batch-statistics errors fail the job without undoing completed writes. Provider-discovered counts still exclude the explicit seed. v1.19.0 bypasses the seed filters and omits its stored count. See the [API contract](API.md#pipeline) and [#795](https://github.com/iuliandita/digarr/issues/795).

Artist filtering applies per-user permanent blocks and, in v2.0.0, owner-scoped rejection cooldowns. Pipeline, Quick Discover seed/similar-result, and subscription reads pass an explicit owner to the cooldown query, using the current run's configured window. Account runs include only their own rejected rows; legacy unowned subscriptions include only unowned rows. Neither scope includes the other. Existing rows are preserved without reassignment. v1.19.0 instead includes rejected recommendations from all accounts ([#788](https://github.com/iuliandita/digarr/issues/788)).

### Analyze: source-relative weights

Analyze hydrates listening-artist genres from native source payloads,
`library_artists`, and the `artists` cache before computing the taste profile.
It deduplicates each source's artist evidence, then normalizes its positive
weights to a total of one.

Spotify contributes reciprocal best position across the existing personal
top-artist windows; this is an ordinal estimate, not a published affinity score. Subsonic starred artists contribute equal membership
evidence. Other adapters retain their source-local numeric signals, including
favorite boosts or collection counts. Raw values remain separate from normalized
`tasteWeight` values.

Artists appearing in several sources keep their maximum contribution rather
than summing overlapping history. Aggregate genres and the analyzed profile use
these relative weights with deterministic ties. Empty, invalid, or zero numeric
evidence contributes no positive weight; missing genre tags stay unknown.

Raw seed values remain source-dependent, not comparable play counts. Relative
taste weights do not measure probability or establish one dominant taste. A
sparse source can give its single artist a strong relative weight. The AI
guidance preserves distinct interests supported by the profile without setting recommendation quotas.

After foreground pipeline work completes, a maintenance-aware warmer queues at
most 10 stale or missing artists through the shared MusicBrainz rate gate. The
next scan consumes the refreshed cache through an ambiguity-checked source/name
alias when the listening source has no MBID. Listening-artist genre data in the
artist cache uses its own freshness timestamp, so unrelated image or metadata
refreshes cannot extend the 180-day genre TTL.

### Discover: seed selection

Discovery queries only listening sources declaring `similarArtists`. Job results
distinguish unsupported capabilities, explicit discovery modes, missing seeds,
successful empty lookups, and upstream failures. A seed lookup failure remains
visible even when other seeds contribute candidates. These outcomes describe
discovery, independently of profile analysis and library sync.

Before similarity lookup, discovery shuffles exact positive finite taste-weight
ties on a copied list; unequal weights and legacy ordering remain intact.
Library mixing deduplicates known identities, preserves a uniquely matching
catalog ID on copied seeds, and backfills unavailable slots from remaining
listening artists without exceeding the configured cap. This changes seed
opportunity, not genre quotas or scoring. Bounded seed selection cannot guarantee
representation of every interest. Scoring, stored recommendations, and source
history windows are unchanged.

### AI discovery: prompts and name checks

Recommendation prompts retain per-artist genre context for at most 20 seeds and
eight genre tags per seed. AI discovery retains comparisons to listening-profile
artists. The existing `hasNameConfusion` filter separately rejects
recommendations when either normalized name contains the other. It lowercases
names and strips leading English articles; exact matches are handled elsewhere,
and seed names shorter than four characters are skipped. Distinct artists with
overlapping names can still be rejected by this heuristic.

The AI description guard only checks likely shared-name collisions: an unquoted
seed name without the recommended name can be rejected. Prompts ask for the exact
recommended name in the first sentence. This check cannot verify artist identity
or factual accuracy; MusicBrainz resolution remains a separate stage.

### Resolve: identity and genre enrichment

Name-only resolution checks at most five MusicBrainz hits against the requested
name or returned catalog aliases before comparing genres. Name normalization
preserves accents and punctuation. A uniquely best matching identity can resolve;
ties and unrelated hits are dropped. Known-MBID candidates retain their explicit
identity path. Older stored recommendations are not rewritten. Enrichment from
`artist_metadata` runs as a Resolve sub-step before Score.

### Filter: artist and album rules

The filter stage partitions candidates by `kind`. Artist-kind candidates run the
full artist-existence / library / top-artist filters. Album-kind candidates
bypass those artist-oriented filters because a new release from a tracked artist
is the point, but still pass the album block layer, cross-batch dedup, and the
score threshold.

## Registry patterns

Extension points use registries or configuration maps:

- `DiscoverySource` - listening-source plugins in `src/core/plugins/`, registered through `SourceRegistry`; add new IDs to `LISTENING_SOURCE_IDS` for unconfigured-source reporting
- `LibrarySource` - library-sync adapters in `src/core/library/sources/`, registered through `LibrarySourceRegistry` and ordered by MBID quality

- `DestinationTarget` - where recommendations are pushed (Lidarr, Emby, `slskd`, ...)
- `SubscriptionAdapter` - how recurring seeds are sourced (CSV, Spotify saved, ...)
- `SearchSource` - multi-source artist / track search (Spotify, Deezer, MusicBrainz, TIDAL, Bandcamp)
- `RecommendationProvider` - AI backends (Anthropic, OpenAI, Gemini, Ollama, ...)
- `DiscoveryMode` - on-demand / savable discovery flows, registered in `src/core/discovery-modes/registry.ts` (ListenBrainz radio, Release Radar, Library Gap-Fill, Charts, Deezer Flow, Spotify Saved Albums, TIDAL Favorite Artists, ...). A new mode is a factory plus a `registry.register` line plus an availability entry; the frontend renders modes generically, so no frontend change is needed.

  Modes that just read a user's artist collection from an OAuth-connected provider are one `createUserArtistCollectionMode({ id, label, description, provider, fetchArtists })` spec (`modes/user-artist-collection.ts`), and modes gated on a single connection flag are one row in `SINGLE_FLAG_MODES` in `availability.ts` rather than a hand-written branch.

  An optional `stability: 'experimental'` on the definition (serialized by `GET /api/v1/discovery-modes`, defaulting to `stable`) badges the mode card without a per-mode frontend branch. TIDAL Favorite Artists remains experimental while live-account connect, refresh, and populated collection-result validation is deferred; see [TIDAL feedback](AUTHENTICATION.md#tidal-feedback).
- `NotificationChannel` - where notifications are delivered (webhook, ntfy, Telegram, Apprise), in `src/core/notifications/`. `registry.ts` fans one event out to every enabled, subscribed channel via `Promise.allSettled` (one channel down never blocks the others). Each `channels/<type>.ts` formats its payload and calls the single SSRF-guarded `transport.ts`.

   A new type needs a `channels/<type>.ts` sender, a `NotificationChannel` union arm, and wiring in `registry.ts`: `SenderMap`, `defaultSenders`, and the dispatch switch. Add its accepted shape to the discriminated union in `src/server/schemas/settings.ts`. Update configuration UI and translations, secret encryption/masking and masked round trips where applicable, and relevant tests. Reuse the guarded transport.

  The transport does DNS-pinned resolution, `redirect: manual`, and blocks private/link-local/cloud-metadata targets; a per-channel admin-only `allowPrivateTarget` waives only the RFC1918 set. Channel secrets are encrypted at rest when `DIGARR_ENCRYPTION_KEY` is configured. The settings API masks full channel secrets as `***` and partially masks channel webhook URLs so their destinations remain recognizable. Global scalar fanart credentials and legacy webhook URLs are masked as `***` for admins and omitted for non-admins in v2.0.0; masked PATCH values preserve their stored bytes. This response projection does not change at-rest encryption policy.
- `ProviderAuth` - how a streaming provider's stored OAuth token is resolved and refreshed, as a `PROVIDER_AUTH` map in `src/core/provider-auth.ts` keyed by `OAuthProvider`.

  `resolveProviderToken(db, userId, provider)` is the single entry point for Spotify, Deezer, and TIDAL; a provider without a `tokenEndpoint` (Deezer) is simply one that cannot refresh, rather than a separate code path.

  `authStyle` (`basic` or `body`) must match how that provider's authorization-code exchange authenticates, since a client accepts one style and not both. Failures raise `ProviderAuthError` with `reason: 'not_connected' | 'token_unusable'`, which is what lets discovery modes tell "never connected" from "token dead" instead of flattening both into one message.

  A new provider is one row here plus a callback handler in `src/server/routes/oauth-callbacks.ts`.

Adding a new implementation means:

| Extension | Implementation location |
|-----------|-------------------------|
| Listening sources | `src/core/plugins/<name>.ts` |
| Library sources | `src/core/library/sources/<name>.ts` |
| Targets | `src/core/targets/<name>.ts` |
| Subscriptions | `src/core/subscriptions/adapters/<name>.ts` |
| Search | `src/core/search/sources/<name>.ts` |
| AI providers | `src/core/providers/<name>.ts` |
| Discovery modes | `src/core/discovery-modes/modes/<name>.ts` |
| Notifications | `src/core/notifications/channels/<type>.ts` |
| Provider auth | `PROVIDER_AUTH` in `src/core/provider-auth.ts` plus its OAuth callback |

Register the implementation at its extension point and add settings/schema/UI when configurable.

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

Audition retains per-item unavailable reasons after skipping or queue completion, independently of playback state. New runs reset the summary and retrying an item replaces its prior failure. Reasons describe observable lookup and playback outcomes; browser fetch rejection does not establish CORS or provider outage, and Spotify controller failure does not establish account access. Stale audio callbacks and superseded resolutions cannot advance a newer queue item. No approval writes occur during playback.

## Boot order

Startup in `src/index.ts` has two phases:

1. Before the HTTP listener starts, initialize encryption, wait for external PostgreSQL if configured, run the pre-flight backup check, and apply schema migrations. In v2.0.0, await initial-admin bootstrap next: existing users skip it; an empty database permits manual registration when both bootstrap variables are unset, or requires a complete pair and a 12-character password. Configured creation must return the intended admin, and any failure closes the database and exits before services or HTTP start. Then wire the session store, library services, job recorder, and application dependencies. Startup stuck-job detection runs after migrations. Required backup failures stop startup before any migration. Application snapshots use repeatable-read transactions; partial restores lock affected tables and check dependencies before clearing data.
2. After the HTTP listener starts, an async initializer completes env-based service setup when configured, migrates legacy connections, backfills targets, and starts the pipeline, subscription, playlist, library, slskd, stuck-job, and notification-digest schedulers. In v1.19.0, this best-effort phase also creates the initial admin; the v2.0.0 correction makes admin creation independent of service-setup failures.

Digest positions live in server-owned `settings.digestDeliveryPositions`, outside editable preferences. SQL NULL marks an uninitialized map; current channel IDs inherit `digestLastSentAt` once, even with scheduling disabled; live ticks also initialize after an older backup restores SQL NULL. New IDs start from the cron cadence and save their start before querying or sending. Atomic per-key writes preserve other channels and preference edits. Only that channel's matching successful result or zero-activity window advances its position; failures retry a longer aggregate window. Disabled or removed channels retain positions, and ambiguous duplicate IDs are skipped. One shared in-process guard survives scheduler replacement, but a crash between remote acceptance and persistence can repeat delivery. Multiple replicas are unsupported. Schedulers skip work during maintenance; jobs already running must finish before a backend migration.

## Album-level discovery

Albums are a first-class recommendation unit:

- **`kind` discriminator** on the `recommendations` table (`'artist' | 'album'`, default `'artist'`). All recommendation queries and API responses include `kind`; the list endpoint accepts a `?kind=` filter.
- **`album_blocks` table** -- per-user, forever-block layer for albums, keyed on release-group MBID. Independent of `artist_blocks`; the filter stage drops candidates matching either block layer.
- **`applyAlbumModifier`** in `src/core/pipeline/score.ts` -- computes a bounded recency / popularity / gap-priority modifier added to the artist-similarity base score, then clamps the result to `[0, 1]`.

### Album approval

Individual approval calls the Lidarr target's `addAlbum` method. It adds the
artist unmonitored (no whole-discography grab) and monitors and searches only the
approved album. If the artist already exists in Lidarr, the existing record is
reused, making this safe for gap-fill.

Bulk approval dispatches each recommendation by kind and uses `addAlbum` for
albums, including explicit album-only targets. Missing release-group identities
or incompatible targets fail without artist acquisition. Only successful Lidarr
additions produce `added_to_lidarr`; other successful targets produce `approved`,
with slskd queueing recorded separately from a completed import. Automatic album
approval preserves the release identity in both pipeline entry points and calls
`addAlbum` too. Its monitoring setting applies only to artist recommendations.
Missing release identities or incompatible acquisition targets fail without
artist acquisition; discovery-only instances approve valid albums without a
target call. Album external IDs stay in `targetActions`, never the artist ID.

### Release radar

The release-radar discovery mode emits `kind='album'` recommendations for new
releases from artists the user already tracks. These land in the Albums tab.
Artist seeds come from ListenBrainz, Spotify, or Last.fm; Plex listening history
does not currently supply this mode. Release metadata comes from MusicBrainz.
Kind-aware dedup keeps one album recommendation per release, including several
releases from the same artist in one scan window.

### Library gap-fill

The library gap-fill executor iterates a rotated, bounded slice of the user's
tracked artists. Its cursor is `library_artists.last_gap_check_at`, ordered
`asc nulls first` so never-checked artists go first. The default slice is 25
artists per run, overridable through the mode's `maxArtistsPerRun` setting. A
p-queue walks the slice with concurrency 2 and a 200ms interval so large libraries
do not starve the event loop.

For each artist, the executor calls the album-coverage engine
(`src/core/library/album-coverage.ts`) and emits one `kind='album'` candidate per
missing eligible primary-type `Album` release group. Each carries the release-group MBID and the release year
as the recency signal. In v2.0.0, only a slice whose coverage lookups all succeed
has its artists' `last_gap_check_at` stamped so the next run advances the cursor. The resulting
recommendations fill the Albums tab with missing studio-classified releases from artists
already in the library. In v2.0.0, coverage requires primary type `Album` and an
explicit empty secondary-type array; it excludes every secondary type, including
Live, Compilation, Soundtrack and Demo. Owned excluded groups affect neither count.
Missing or malformed metadata on an Album fails coverage for retry instead of
treating an unknown group as studio. This relies on MusicBrainz classification,
not evidence of recording conditions. v1.19.0 discards secondary types and counts
every Album group ([#798](https://github.com/iuliandita/digarr/issues/798)).
The shared client retains optional `secondaryTypes` metadata but keeps its broad
catalog for album picking, Release Radar, reconciliation and release matching.
Counts can decrease; existing recommendations remain. No schema migration or
row rewrite is added; rollback restores broader coverage.

In v2.0.0, the shared MusicBrainz release-group client walks sequential pages of up to 100 groups through the existing rate limiter, retains type filters and first-seen order, and deduplicates IDs. Provider counts/offsets are validated when present; without them, a short or empty page ends the read. At most 100 pages/10,000 returned groups are read. A failed required page, invalid or stalled pagination, or an unresolved end at that bound rejects the whole lookup without returning accumulated partial groups. Catalog changes can invalidate the read; it is not a snapshot. This also applies to artist album lists, release matching, reconciliation and Release Radar. v1.19.0 stops after the first page ([#796](https://github.com/iuliandita/digarr/issues/796)).

In v2.0.0, Gap-Fill waits for every queued coverage lookup to settle. Any failure rejects the run with the original error before stamping any artist or handing candidates to the pipeline. The whole slice remains eligible for retry, including successful lookups whose candidates were not stored. Manual and subscription runs record the failure; subscriptions retain the previous result count and save the error. Genuine empty coverage remains successful and advances the cursor. A persistently failing artist can hold the selected slice until its lookup succeeds. v1.19.0 swallows coverage errors and marks failed artists checked ([#797](https://github.com/iuliandita/digarr/issues/797)). No schema migration or repair of old cursor values is added; retry after resolving provider errors, and allow the existing rotation to revisit previously stamped artists. Rollback restores swallowed failures.

### Net-new album discovery

In v2.0.0, `netNewAlbumDiscovery` persists as an optional boolean through per-user preferences and admin-global preferences. It defaults off; omission preserves the stored value and explicit `false` disables promotion. Existing per-user/global preference resolution is unchanged. v1.19.0 cannot persist the setting ([#791](https://github.com/iuliandita/digarr/issues/791)); Release Radar and Library Gap-Fill remain usable there. The Recommendations page saves personal preferences independently of admin-only global AudioDB/Wikidata settings and refreshes personal caches after that first write. A later global failure reports partial success without rollback; v1.19.0 still has the non-admin false-failure behavior ([#792](https://github.com/iuliandita/digarr/issues/792)).

When the stored flag is enabled, `resolve()` tries to match
the AI's `suggestedAlbum` to a MusicBrainz release group. A match becomes an album
recommendation with its release-group MBID and first-release date, then follows
the normal album scoring, filtering, and storage paths. An unmatched title stays
an artist recommendation.

### Album empty-state routing

A normal pipeline scan remains artist-focused. When the album-filtered
recommendation list is empty, the frontend links to the two explicit album
discovery modes (`gap-fill` and `release-radar`) and the default-off
`netNewAlbumDiscovery` preference. Discovery-mode deep links focus the requested
generic mode card; the preference link opens its collapsed settings section and
focuses the target. Saving the preference requires the persistence fix described above.

### Kind-aware dedup

Album candidates dedup and group by release-group MBID instead of artist MBID at
three points, allowing multiple albums per artist to survive a single run:

1. Discover-stage dedup keys album candidates on `rg::{releaseGroupMbid}` while artist candidates key on artist MBID/name (`src/core/pipeline/discover.ts`).
2. `resolve()` partitions album-kind discoveries out of the artist-MBID grouping and groups them by release group, producing one resolved recommendation per release group (`src/core/pipeline/resolve.ts`).
3. Resolve's final dedup keys album-kind recommendations on `{artistMbid}::{releaseGroupMbid}` so distinct albums for the same artist are kept.

## Key invariants

- Plex listening uses a per-user server-account mapping bound to the server machine identifier. Every history page is account-filtered and checked before aggregation; missing mappings disable listening without disabling shared-library sync. Plex similarity candidates use artist metadata from that listener's history.
- Audition playlists select only the owner's pending recommendations, deduplicate artists before limiting, and resolve one real track per artist. Generation does not approve recommendations or acquire missing media.
- slskd linked imports retain the queued release manifest, require every expected transfer to succeed, and validate Lidarr's per-file artist, album, and track identifications before moving files. Completion requires track-file verification. Failed work keys remain unique through cooldown retries; superseded historical duplicates are preserved by migrations and backup restore.

- Library sync replaces a source snapshot only after all source album fetches succeed. A failed fetch retains the previous snapshot and marks the run failed; MusicBrainz reconciliation failures remain separately counted.
- Config precedence: for settings stored in the DB (single row, `id=1`), saved values override env defaults. Deployment-only options such as `DIGARR_MUSICBRAINZ_URL` and `DIGARR_MUSICBRAINZ_INTERVAL_MS` come from the environment and require a restart. Direct per-user service credentials live on `users`, with global settings as the fallback where supported; Spotify, Deezer, and TIDAL OAuth credentials live in `oauth_tokens`.
- Metadata, service-client, and playlist-target requests generally go through
  `createHttpClient()` in `src/core/clients/http.ts` for timeout, retry/backoff,
  JSON parsing, response-body errors, redaction, and optional TLS-skip behavior.
  Anthropic and OpenAI providers use vendor SDK transports, so these policies are not universal. Read-only shared-client calls retain the client retry default. Duplicate-producing playlist
  creation and song-add calls pass `retries: 0`; this classification is based on
  endpoint semantics because Subsonic mutations use GET-shaped endpoints.
- Playlist resolution records a disposition for every selected artist: resolved, unmatched, unavailable, error, or excluded by the size cap. Spotify and Deezer artist names must match after Unicode/case/whitespace normalization before tracks are selected.

  Production resolver credentials come only from the playlist owner's saved
  library connections. Jellyfin, Emby, and Subsonic use the saved operator TLS
  verification preference. A `local` priority tries Jellyfin, Emby, Subsonic/Navidrome, then
  Plex with their configured user/library/section scope and existing request
  queues. Each provider search is bounded to 25 candidates. The first exact
  normalized artist match with real title and file path wins; an empty or failed
  lookup continues through local connections before catalog fallbacks. Tracks
  are not combined across connections. File paths remain server paths, not
  copied or verified-playable media. Shared Lidarr settings and export targets
  are separate. Ownerless playlists use no private connections. Spotify search
  is wired only for a user with a stored Spotify OAuth connection and resolves
  its current token per search; Deezer search needs no account.

  MusicBrainz recordings are the final MBID-based fallback. They supply titles
  and recording IDs without playable URIs or paths. Exports link those rows to
  MusicBrainz pages; remote targets resolve tracks separately. No invented titles
  fill unresolved artists.

  Navidrome, Jellyfin, Emby, and Plex accept only an exact title and credited
  artist after case and whitespace normalization. They skip unmatched or
  missing-title items and report added/skipped counts; omissions fail the
  playlist job after all selected exports are attempted.

  Counts distinguish selected artists, artists with resolved tracks, artists
  included after truncation, and included tracks. Resolution metadata is saved in
  the existing job record after local tracks are saved and before remote exports,
  so a later target failure preserves the local result. Owned playlist details
  expose only their latest job projection; legacy playlists have no fabricated
  historical summary.
- Playlist scheduling is gated by the global `preferences.playlistEnabled` switch (default false), plus each playlist's enabled flag and schedule. Manual generation is independent of that switch.
- Playlist generation stores its local tracks before pushing to selected enabled Navidrome, Jellyfin, Emby, Plex, and Spotify targets. A target error, including a returned failed playlist result or a media-server skipped count, does not stop later selected targets; after all attempts it fails the playlist job for Job History. There is no remote rollback, and the locally generated playlist remains available.
- Saved exports use `playlist_exports`, unique by local playlist and target, with both parents checked for ownership. A prepared provider session captures credentials, verifies scope, and resolves usable tracks before writes. An atomic `creating` reservation precedes creation; a returned ID is checkpointed as `linked` before follow-up mutations. A failed or interrupted unconfirmed create blocks automatic retry as `creating` or `recovery_required`; known IDs remain linked after population errors. Regeneration replaces by ID, never by name. Scope mismatch, missing/inaccessible IDs, and zero usable tracks preserve the binding and fail. Owner-only API reset forgets local state after explicit duplicate acknowledgment, never remote data. Bindings participate in backups, omission safety, and backend copies. An in-process per-playlist guard covers cron, manual generation, and recovery; replacement across multiple replicas is unsupported.
- Spotify playlist exports retain explicit track URIs, or resolve artist/title pairs with exact matching. Artist-only approvals take up to three artist-matching track search results. Writes use `/me/playlists` and `/playlists/{id}/items`, with at most 100 URIs per request; failures are not retried as duplicate writes.
- Emby, Jellyfin, and Subsonic source clients each own a media-server request
  queue capped at three concurrent requests and ten starts per second. This is
  an internal load-smoothing policy for self-hosted servers, not a claimed
  vendor limit. It is deliberately per client instance; configurable overrides
  and queue metrics remain deferred until an operational need is demonstrated.
- Field-level encryption uses AES-256-GCM with HKDF-derived keys (`src/core/crypto.ts`). Encrypted DB values are prefixed `enc:v1:`. Legacy SHA-256 decryption is retained as a read-path fallback for pre-migration values.
- Tests run in Node.js (vitest), not Bun. `Bun.serve()`, `Bun.file()` and similar Bun-only APIs are unavailable in tests; password hashing uses `node:crypto` `scrypt`.
- Migrations are idempotent. Drizzle generates bare DDL, so every generated migration must add `IF NOT EXISTS` / `IF EXISTS` clauses by hand.
- Backup restore runs in a single DB transaction. It replaces the included tables and preserves original row IDs. Clearing users also cascades deletion of omitted user-owned rows, so omission does not preserve destination data. Back up the destination and prefer a fresh database for JSON restore ([#757](https://github.com/iuliandita/digarr/issues/757)). Selected tables use natural-key conflict targets (`mbid`, `slug`, `nameNormalized`); others use their original `id`.
- Primary keys are `integer GENERATED BY DEFAULT AS IDENTITY` (not legacy `serial`). BY DEFAULT is deliberate: backup restore re-inserts rows with their original `id`, which `GENERATED ALWAYS` would reject.
- Backend migration never modifies the source database. Verification (row count + content hash) must pass before `ok: true` is returned; any mismatch surfaces in `MigrationReport.mismatches`.
- Optional genre-priority ordering is a user-scoped read concern in `listRecommendations`, independent of score computation. Exact genre matches select primary, secondary, and other groups before score ordering and pagination. Secondary browsing excludes primary matches; missing preferences preserve score ordering. No recommendation rows are rewritten.
- Scoring uses the shared `computeWeightedScore()` in `src/core/pipeline/score.ts`. All callers (main pipeline + hygiene rescorer) clamp results to `[0, 1]` regardless of user weight sums. Maintenance rescoring reuses stored components and album modifiers, scopes reads and writes to the current user, and skips incompatible evidence or rows changed since selection.
- Listening profiles clean semicolon-separated genres, blank values, and numeric artifacts before hydration and after reading cached genres. Coverage counts usable genres; pending-cache counts retain their freshness semantics. This does not rewrite library or cache metadata.

See [Contributing](../CONTRIBUTING.md) for development checks and the [API reference](API.md) for endpoint contracts.
