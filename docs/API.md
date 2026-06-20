# API Reference

All endpoints require authentication via `Authorization: Bearer <token>` header unless marked as public. Only `/api/v1/pipeline/events` and `/api/v1/preview/audio` also accept `?token=<token>` for SSE and `<audio>` clients that cannot send headers.

Locale-aware routes accept `X-Digarr-Locale` to override the saved user locale for that request. If the header is absent, Digarr falls back to the saved user preference and then `Accept-Language`.

Admin-only endpoints return 403 for non-admin users.

---

## Pagination Shapes

Digarr uses three pagination styles depending on the route's compatibility history.

Shared cursor pagination is opt-in: callers that omit both `limit` and `cursor` receive the legacy array response, while callers that send either parameter receive:

```json
{
  "data": [],
  "meta": {
    "limit": 50,
    "nextCursor": null
  }
}
```

Routes using this shared cursor shape:
- `GET /api/v1/subscriptions`
- `GET /api/v1/targets`
- `GET /api/v1/batches`
- `GET /api/v1/users`
- `GET /api/v1/playlists`
- `GET /api/v1/analytics/batches`

For these routes, non-integer `limit` values return `400`. `meta.nextCursor` is an opaque string when another page exists and `null` when the page is exhausted.

`GET /api/v1/artist-blocks` uses a route-specific cursor shape:

```json
{
  "items": [],
  "nextCursor": null
}
```

Offset-paginated routes:
- `GET /api/v1/recommendations` returns `{ "items": [], "total": 0 }` and accepts `limit` plus `offset`
- `GET /api/v1/jobs` returns `{ "items": [], "total": 0 }` and accepts `limit` plus `offset`
- `GET /api/v1/listening/top-artists` returns `{ "tracks": [], "total": 0, "offset": 0, "limit": 5, "source": null }`

---

## API Metadata

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/docs` | No | Minimal HTML entry point for API documentation |
| GET | `/api/v1/docs/openapi.json` | No | OpenAPI 3.1 document with shared schemas plus selected stable route groups |

OpenAPI coverage currently includes auth status/login, recommendations, artist blocks, jobs, and settings service probes. The Markdown reference remains the complete route inventory.

---

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | No | Create account. First user becomes admin. Rate limited: 5/min |
| POST | `/api/v1/auth/login` | No | Login with username/password. Rate limited: 10/min |
| POST | `/api/v1/auth/logout` | Yes | Invalidate current session |
| GET | `/api/v1/auth/status` | No | Login-screen auth requirement and OIDC availability |
| GET | `/api/v1/auth/meta` | Yes | Deployment metadata: version and enabled auth integrations |
| GET | `/api/v1/auth/me` | Yes | Current user profile |
| GET | `/api/v1/auth/validate` | Yes | Lightweight token/session validity check. Returns `204` when valid |
| PATCH | `/api/v1/auth/me/locale` | Yes | Update the saved user locale. Session auth only. |
| POST | `/api/v1/auth/change-password` | Yes | Change password. Invalidates all sessions. Rate limited: 5/min |
| GET | `/api/v1/auth/me/preferences` | Yes | Get merged user preferences |
| PATCH | `/api/v1/auth/me/preferences` | Yes | Update user preferences (partial merge). Session auth only. |

**PATCH /api/v1/auth/me/locale** body:
```json
{ "preferredLocale": "fr" }
```

Notes:
- `preferredLocale` may be a supported locale string or `null`
- Supported locales: `en`, `es`, `fr`, `de`, `pt-BR`, `it`, `nl`, `ro`, `pl`, `tr`, `uk`, `ru`, `ja`, `ko`, `zh-CN`
- Legacy token auth is rejected with `403`; this route requires a session-authenticated user
- `POST /api/v1/auth/change-password` also rejects legacy token auth with `403`; password changes require a session-authenticated user
- `PATCH /api/v1/auth/me/preferences` also rejects legacy token auth with `403`; preference writes require a session-authenticated user
- `GET /api/v1/auth/status` returns `required: true` as soon as setup is complete, even if no users exist yet, so the frontend can force registration/login instead of treating the app as public

### OIDC / OAuth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/auth/oidc/login` | No | Redirect to OIDC provider. Requires `ALLOWED_ORIGIN` env var |
| GET | `/api/v1/auth/oidc/callback` | No | OIDC callback, creates user if needed |
| POST | `/api/v1/auth/oauth/:provider/initiate` | Yes | Start OAuth flow (e.g. Spotify) |
| GET | `/api/v1/auth/oauth/:provider/callback` | No | OAuth callback |
| GET | `/api/v1/auth/oauth/:provider/status` | Yes | Check OAuth connection status |
| DELETE | `/api/v1/auth/oauth/:provider` | Yes | Disconnect OAuth provider |

---

## Setup

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/setup/status` | No | Check if setup is complete |
| POST | `/api/v1/setup/complete` | No | Complete initial setup |

Setup validation rules:
- `aiProvider` and `aiModel` are required
- Lidarr is optional, but `lidarrUrl` and `lidarrApiKey` must be provided together when used
- Emby is optional, but `embyUrl`, `embyApiKey`, and `embyUserId` must be provided together when used
- When Lidarr is provided during setup, Digarr auto-creates the default Lidarr target for the first user
- When Emby is provided during setup, Digarr stores the per-user Emby connection and auto-creates an Emby playlist target
- Completing setup does not create a user account. If setup finishes before any user exists, the next step is to register or sign in; protected routes stay locked until then

**POST /api/v1/setup/complete** body:
```json
{
  "aiProvider": "openai",
  "aiModel": "gpt-4o-mini",
  "lidarrUrl": "http://lidarr:8686",
  "lidarrApiKey": "abc123",
  "embyUrl": "http://emby:8096",
  "embyApiKey": "abc123",
  "embyUserId": "user-1",
  "skipTlsVerify": false
}
```

---

## Pipeline

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/pipeline/run` | Yes | Start a full discovery scan. Returns 202. |
| GET | `/api/v1/pipeline/status` | Yes | Current pipeline status (running, stage, last run) |
| GET | `/api/v1/pipeline/events` | Yes | SSE stream of pipeline progress events |
| POST | `/api/v1/pipeline/quick-discover` | Yes | Fire-and-forget: discover artists similar to a given name. Rate limited: 5/min |
| POST | `/api/v1/pipeline/rescan` | Yes | Re-fetch images/metadata for existing recommendations |

`POST /api/v1/pipeline/run` and `/api/v1/pipeline/rescan` are intentionally
available to any authenticated user (not admin-only): "Run Scan" is a core
regular-user action on the dashboard and discover screens. Concurrency is
bounded by a single-flight orchestrator, so a second run while one is active
returns `409` rather than starting a parallel run.

**POST /api/v1/pipeline/quick-discover** body:
```json
{ "artistName": "Radiohead" }
```

Locale notes:
- `POST /api/v1/pipeline/run` and `POST /api/v1/pipeline/quick-discover` honor `X-Digarr-Locale`
- For authenticated users, the explicit request locale wins over the saved user locale for that request
- AI responses follow the resolved UI locale; prompt-language detection is handled separately for freeform inputs

---

## Discovery Modes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/discovery-modes` | Yes | List discovery modes with current availability, fallback, and field metadata |
| POST | `/api/v1/discovery-modes/run` | Yes | Start a manual discovery-mode run. Returns 202 with a `jobId`, but no batch ID. |

**GET /api/v1/discovery-modes** notes:
- Always returns the shipped discovery-mode catalog, including modes that are visible but currently unavailable
- In the web UI, these modes are exposed from Discover -> Discovery Modes
- Each mode includes `availability.enabled`, `availability.fallbackUsed`, `availability.providerPath`, and an optional `availability.reason`
- Unavailable modes stay visible for roadmap transparency, should be treated as read-only UI metadata, and are not runnable jobs

**POST /api/v1/discovery-modes/run** body:
```json
{
  "modeId": "release-radar",
  "settingsMode": "easy",
  "rawUserSettings": { "windowDays": 14 },
  "normalizedSettings": { "windowDays": 14 },
  "providerContext": { "providerPath": ["lastfm"] },
  "fallbackPolicy": "allow-fallback"
}
```

**POST /api/v1/discovery-modes/run** behavior:
- Returns `202 { "message": "Discovery run started" }` after validation; the actual run continues in the background
- The accepted response now includes `jobId`, so clients can poll the job detail endpoint while the run continues in the background
- The server re-evaluates availability and execution context from the current user connections before starting the run
- Returns `400` with the availability reason when a mode is currently unavailable, matching the `availability.reason` shown in the UI
- Mode-specific preflight preparation can still reject the request before `202`; for example, Artist Radio resolves free-text artist seeds to MusicBrainz IDs before the job is accepted

---

## Recommendations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/recommendations` | Yes | List recommendations (paginated, filterable) |
| GET | `/api/v1/recommendations/:id` | Yes | Get single recommendation with artist data |
| PATCH | `/api/v1/recommendations/:id` | Yes | Approve, reject, or restore a recommendation |
| POST | `/api/v1/recommendations/bulk` | Yes | Bulk approve/reject (reject accepts an optional shared `reason` + `permanent` block) |
| GET | `/api/v1/recommendations/feedback-summary` | Yes | Genre approval rates (top 20), scoped to the calling user's own feedback |

**GET /api/v1/recommendations** query params:
- `status` - `pending`, `approved`, `rejected`, `added_to_lidarr`, `add_failed` (comma-separated)
- `batchId` - filter by batch
- `sort` - `score_desc` (default), `score_asc`, `created_desc`, `acted_on_desc`
- `decades` - era filter, comma-separated: `60s`, `70s`, `80s`, `90s`, `00s`, `10s`, `20s`
- `limit` - 1-200 (default 20)
- `offset` - pagination offset

**PATCH /api/v1/recommendations/:id** body:
```json
{
  "status": "approved",
  "approvalMode": "combined_lidarr_slskd",
  "monitorOption": "popular",
  "selectedAlbumIds": ["release-group-mbid"],
  "lidarrTargetId": "lidarr-1",
  "targetId": "slskd-7",
  "qualityProfileId": 1,
  "metadataProfileId": 1,
  "rootFolderId": 1
}
```

Approval notes:
- `approvalMode` defaults to `single_target`
- `monitorOption` accepts `all`, `new`, `selected`, `popular`, or `none`. `popular` resolves the artist through Spotify, ranks album releases by Spotify popularity, maps the top 3 matches back to MusicBrainz release groups, and sends them to Lidarr as selected albums.
- `selectedAlbumIds` contains MusicBrainz release-group MBIDs when `monitorOption` is `selected`; clients may omit it for `popular` because Digarr resolves the top albums server-side.
- use `approvalMode: "combined_lidarr_slskd"` with an `slskd-*` `targetId` to add to Lidarr first and then queue the matched release in `slskd`
- `lidarrTargetId` is optional; when the selected `slskd` target is linked to a Lidarr target, Digarr uses that linked target as the fallback, and an explicit `lidarrTargetId` only overrides that default
- rejected recommendations may include `reason`, `reasonText`, and `permanent`; `permanent: true` also adds the artist to the caller's blocklist

## Artist Blocks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/artist-blocks` | Yes | List the caller's permanently blocked artists |
| POST | `/api/v1/artist-blocks` | Yes | Permanently block an artist for the caller |
| DELETE | `/api/v1/artist-blocks/:artistId` | Yes | Remove an artist from the caller's blocklist |

**GET /api/v1/artist-blocks** query params:
- `q` - optional artist-name search
- `limit` - integer, clamped to 1-200 (default 50). Non-integer values return `400`
- `cursor` - opaque cursor from `nextCursor`

**POST /api/v1/artist-blocks** body:
```json
{
  "artistId": 123,
  "reason": "wrong_style",
  "reasonText": null
}
```

---

## Artists

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/artists/:id` | Yes | Get artist by ID |
| GET | `/api/v1/artists/:id/top-tracks` | Yes | Top 5 tracks (Deezer, MB fallback) |
| GET | `/api/v1/artists/:id/enrichment` | Yes | Cached Wikidata description and external links |
| GET | `/api/v1/albums/:mbid` | Yes | Release groups for an artist MBID |
| GET | `/api/v1/preview/audio` | Yes | Proxy Deezer preview audio (CORS bypass) |

Path params:
- `:id` values are positive integers. Fractional, negative, zero, or unsafe integer values return `400`

**GET /api/v1/preview/audio** query params:
- `url` - Deezer CDN preview URL (must match `*.dzcdn.net`)
- `token` - auth token (for `<audio>` elements that can't send headers)

**GET /api/v1/artists/:id/enrichment** query params:
- `locale` - optional BCP 47-ish locale token; invalid tokens fall back to `en`

---

## Media

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/media/image-proxy` | Yes | Proxy whitelisted AudioDB image URLs when image proxying is enabled |

**GET /api/v1/media/image-proxy** query params:
- `src` - required `http` or `https` URL on `img.theaudiodb.com`, `theaudiodb.com`, or `www.theaudiodb.com`

Notes:
- Returns `404` when AudioDB image proxying is disabled
- Rejects non-image content, redirects, private addresses, and non-whitelisted hosts

---

## Batches

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/batches` | Admin | List all recommendation batches |
| GET | `/api/v1/batches/:id` | Admin | Get batch details |

Path params:
- `:id` values are positive integers. Fractional, negative, zero, or unsafe integer values return `400`

---

## Subscriptions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/subscriptions` | Yes | List user subscriptions |
| POST | `/api/v1/subscriptions` | Yes | Create subscription |
| PATCH | `/api/v1/subscriptions/:id` | Yes | Update subscription |
| DELETE | `/api/v1/subscriptions/:id` | Yes | Delete subscription |
| POST | `/api/v1/subscriptions/:id/run` | Yes | Trigger manual run (202) |
| GET | `/api/v1/subscriptions/:id/runs` | Yes | Run history |
| POST | `/api/v1/subscriptions/import/spotify-liked-songs` | Yes | Create/reuse the helper Spotify Liked Songs subscription and trigger an import run (202) |
| POST | `/api/v1/subscriptions/import/spotify-playlist` | Yes | Import from a Spotify playlist (accepts URL, URI, or bare ID). Returns 202. |
| POST | `/api/v1/subscriptions/import/csv` | Yes | Upload CSV of artist names (multipart form, field: `file`, max 1MB, 500 artists). Returns 202. |
| POST | `/api/v1/subscriptions/import/deezer-favorites` | Yes | Create/reuse Deezer Favorites subscription and trigger import (202) |
| POST | `/api/v1/subscriptions/import/deezer-followed` | Yes | Create/reuse Deezer Followed Artists subscription and trigger import (202) |
| GET | `/api/v1/subscriptions/import/deezer-playlists` | Yes | List user's Deezer playlists |
| POST | `/api/v1/subscriptions/import/deezer-playlists` | Yes | Import from a Deezer playlist (202) |
| GET | `/api/v1/subscriptions/adapter-types` | Yes | Available adapter types with config schemas |
| GET | `/api/v1/subscriptions/scheduler` | Yes | Scheduler job status, scoped to the calling user's own subscriptions |
| POST | `/api/v1/subscriptions/bulk-toggle` | Yes | Enable/disable all subscriptions |

**Adapter types**: `genre`, `similar`, `discovery-mode`, `spotify-liked-songs`, `spotify-playlist`, `spotify-charts`, `deezer-favorites`, `deezer-followed`, `deezer-flow`, `deezer-playlists`, `lastfm-tag`, `lastfm-charts`, `listenbrainz`, `csv-import`

**POST /api/v1/subscriptions** body:
```json
{
  "name": "Weekly jazz",
  "sourceType": "lastfm-tag",
  "sourceProvider": "lastfm",
  "sourceConfig": { "tag": "jazz" },
  "cron": "0 0 * * 0",
  "maxArtistsPerRun": 20
}
```

Path params:
- `:id` values are positive integers. Fractional, negative, zero, or unsafe integer values return `400`

**Discovery-mode subscription body example:**
```json
{
  "name": "Release Radar Weekly",
  "sourceType": "discovery-mode",
  "sourceProvider": "release-radar",
  "sourceConfig": {
    "modeId": "release-radar",
    "settingsMode": "easy",
    "settings": { "windowDays": 14 },
    "providerContext": { "providerPath": ["lastfm"] },
    "fallbackPolicy": "allow-fallback"
  },
  "cron": "0 8 * * 1",
  "maxArtistsPerRun": 20
}
```

Discovery-mode subscription notes:
- Creation and updates re-check current availability and reject unavailable modes with `400`
- The saved `providerContext` and `fallbackPolicy` mirror the execution path chosen for the manual form, so scheduled runs stay aligned with what the user configured

---

## Targets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/targets` | Yes | List targets. Admins see all targets (config masked for non-owners); non-admins see only their own |
| POST | `/api/v1/targets` | Admin | Create target |
| PATCH | `/api/v1/targets/:id` | Admin | Update target |
| DELETE | `/api/v1/targets/:id` | Admin | Delete target |
| POST | `/api/v1/targets/:id/test` | Yes | Test target connection |

**Target types**: `lidarr`, `slskd`, `spotify-playlist`, `navidrome-playlist`, `jellyfin-playlist`, `emby-playlist`, `plex-playlist`, `export`

## slskd

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/slskd/jobs` | Admin | Inspect active `slskd` orchestration jobs and current sync state. |
| POST | `/api/v1/slskd/sync` | Admin | Trigger a manual `slskd` orchestration sync. Returns 202 immediately. |

**POST /api/v1/slskd/sync** notes:
- No request body
- The route acknowledges immediately and lets the sync continue in the background
- The sync worker polls linked Lidarr wanted releases, creates deduped `slskd` jobs, advances active jobs through search and transfer states, and verifies Lidarr imports before marking linked jobs complete

**GET /api/v1/slskd/jobs** response shape:

```json
{
  "syncing": true,
  "jobs": [
    {
      "id": 101,
      "targetId": 7,
      "recommendationId": 40,
      "state": "downloading",
      "releaseTitle": "Geogaddi"
    }
  ]
}
```

---

## Genres

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/genres` | Yes | List genres with artist counts and examples |
| GET | `/api/v1/genres/search` | Yes | Search genres |
| GET | `/api/v1/genres/:slug` | Yes | Genre detail with sub-genres and library artists |
| GET | `/api/v1/genres/:slug/artists` | Yes | Artists by genre (view: recommended/trending/deep_cuts) |
| POST | `/api/v1/genres/seed` | Admin | Seed genre database from Lidarr library (202) |

**GET /api/v1/genres/search** query params:
- `q` - required search string, minimum 2 characters

---

## Playlists

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/playlists` | Yes | List user playlists |
| POST | `/api/v1/playlists` | Yes | Create playlist |
| GET | `/api/v1/playlists/:id` | Yes | Playlist with tracks |
| PATCH | `/api/v1/playlists/:id` | Yes | Update playlist |
| DELETE | `/api/v1/playlists/:id` | Yes | Delete playlist |
| POST | `/api/v1/playlists/:id/generate` | Yes | Generate playlist tracks (202) |
| GET | `/api/v1/playlists/:id/export/:format` | Yes | Export as json/csv/m3u/xspf |
| GET | `/api/v1/playlists/scheduler` | Yes | Playlist scheduler status |

**Strategies**: `weekly_digest`, `genre_focus`, `mood_mix`, `rediscover`

---

## Mood Discovery

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/mood/discover` | Yes | AI-powered mood-based discovery. Rate limited: 10/min |

**Body**:
```json
{ "query": "rainy day jazz with piano" }
```

**Response**:
```json
{
  "results": [
    {
      "artistName": "Brad Mehldau",
      "confidence": 0.9,
      "reasoning": "...",
      "inLibrary": false
    }
  ]
}
```

Locale notes:
- `POST /api/v1/mood/discover` honors `X-Digarr-Locale`
- The response reasoning follows the resolved UI locale, while prompt-language detection uses the submitted mood text

---

## Search

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/search` | Yes | Cross-platform artist search |
| GET | `/api/v1/search/sources` | Yes | Available search sources |

**Sources**: `spotify`, `deezer`, `musicbrainz`, `tidal`, `bandcamp`

Each source includes a `stability` field (`stable` or `experimental`). TIDAL and Bandcamp are experimental.

**GET /api/v1/search** query params:
- `q` - required search string
- `sources` - optional comma-separated source IDs
- `limit` - integer, clamped to 1-50 (default 20). Non-integer values return `400`

When one enabled source fails, Digarr still returns results from the healthy sources when possible.

---

## Analytics (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/analytics/overview` | Admin | Summary stats |
| GET | `/api/v1/analytics/batches` | Admin | Batch history |
| GET | `/api/v1/analytics/genres` | Admin | Top genres by recommendation count |
| GET | `/api/v1/analytics/sources` | Admin | Source effectiveness |
| GET | `/api/v1/analytics/scores` | Admin | Score distribution |
| GET | `/api/v1/analytics/trend` | Admin | Approval trend over time |
| GET | `/api/v1/analytics/time-to-act` | Admin | Time-to-decision metrics |

---

## Library Health (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/library/health` | Admin | Health check results, persisted snapshot timestamps, last error, and configured auto-sync interval |
| POST | `/api/v1/library/health/scan` | Admin | Start background health scan (202) |
| POST | `/api/v1/library/health/:checkId/fix` | Admin | Apply fix for a health check |
| GET | `/api/v1/library/stats` | Admin | Library statistics |
| POST | `/api/v1/library/warm` | Admin | Warm SkyHook cache for MBIDs (202) |
| GET | `/api/v1/library/warm/status` | Admin | SkyHook warm status |
| GET | `/api/v1/library/sources` | Admin | Per-source sync state for global + per-user library sources |
| POST | `/api/v1/library/sync` | Admin | Run a manual library sync for all sources or a specific source |
| GET | `/api/v1/library/unreconciled` | Admin | List unreconciled library artists still needing a match |
| GET | `/api/v1/library/unreconciled-albums` | Admin | List unreconciled library albums still needing a release-group match |
| GET | `/api/v1/library/album-coverage/:artistMbid` | Yes | Owned/missing album counts for an artist, used by the recommendation card coverage badge |
| POST | `/api/v1/library/overrides` | Admin | Save a manual artist MBID override or an “ignore forever” decision |
| POST | `/api/v1/library/album-overrides` | Admin | Save a manual album release-group MBID override or an ignore decision |
| DELETE | `/api/v1/library/overrides/:source/:sourceArtistId` | Admin | Remove a saved manual artist override |
| POST | `/api/v1/library/reconcile` | Admin | Trigger a background reconcile pass after override changes |

**GET /api/v1/library/sources** response notes:
- `lastSyncCounts.albumsSynced` is present for album-capable sources after a successful sync
- Lidarr, Plex, and Jellyfin source rows now include artist sync counts plus the number of reconciled album rows written for that source snapshot
- `lastSyncCounts.mbApiCallsFailed` is the number of MusicBrainz lookups that failed after internal retries. A non-zero value means the sync completed with partial reconciliation; affected artists and albums are retried on the next sync

**POST /api/v1/library/warm** body:
```json
{
  "mbids": ["f59c5520-5f46-4d2c-b2c4-822eabf53419"]
}
```

Notes:
- `mbids` must be a non-empty array of strings
- Only the first 50 MBIDs are queued per request

**GET /api/v1/library/warm/status** query params:
- `mbids` - comma-separated MBIDs to inspect (up to 100)

**POST /api/v1/library/sync** notes:
- Rate limited: 5/min
- Empty body runs global source sync plus a forced sync for the current user and returns `202`
- `{ "source": "lidarr" }` runs a single source and returns `200` on completion, `202` if still running, or `502` on sync failure
- If the requested source is not configured for the current user, Digarr retries it as a global source

**POST /api/v1/library/sync** body:
```json
{
  "source": "plex"
}
```

**GET /api/v1/library/unreconciled** response notes:
- Returns unreconciled rows from both the current user's sources and any global sources visible to that user

**POST /api/v1/library/overrides** body:
```json
{
  "source": "plex",
  "sourceArtistId": "artist-123",
  "correctMbid": "f59c5520-5f46-4d2c-b2c4-822eabf53419",
  "note": "Matched against album overlap"
}
```

Override notes:
- Set `correctMbid` to `null` or `""` to store an ignore decision instead of a correction
- `correctMbid`, when present, must be a valid UUID

**POST /api/v1/library/album-overrides** body:
```json
{
  "source": "plex",
  "sourceAlbumId": "album-456",
  "correctAlbumMbid": "d8564bdd-5be3-4f3e-9d2b-3c4b5a6b7c8d",
  "note": "Matched against tracklist"
}
```

Album override notes:
- Set `correctAlbumMbid` to `null` or `""` to store an ignore decision instead of a correction
- `correctAlbumMbid`, when present, must be a valid release-group UUID
- Album overrides persist in a separate `album_override` table keyed by `(userId, source, sourceAlbumId)`

**GET /api/v1/library/album-coverage/:artistMbid** notes:
- `artistMbid` must be a valid UUID
- Returns owned and missing album counts derived from the user's reconciled library snapshot
- Powers the coverage badge shown on recommendation cards

**GET /api/v1/library/unreconciled-albums** response notes:
- Returns unreconciled album rows from both the current user's sources and any global sources visible to that user

**POST /api/v1/library/reconcile** notes:
- Triggers a forced sync for the current user and returns `202`
- This currently re-fetches source data; there is no reconcile-only path yet

---

## Exports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/exports/:format` | Yes | Export recommendations as json/csv/m3u/xspf |

Query params: `status`, `batchId`. Limit: 10,000 rows.

---

## Dashboard

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/dashboard/taste` | Yes | Top genres from user's library |
| GET | `/api/v1/dashboard/activity` | Yes | Recent activity feed |

**GET /api/v1/dashboard/activity** query params:
- `limit` - integer, clamped to 1-20 (default 5). Non-integer values return `400`

---

## Listening

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/listening/top-artists` | Yes | Top artists by play count for a given period (ListenBrainz primary, Last.fm fallback) |
| GET | `/api/v1/listening/recent-tracks` | Yes | Most recent scrobbles (Last.fm primary, ListenBrainz, Jellyfin, Emby fallback) |

**GET /api/v1/listening/top-artists** query params:
- `range` - `this_week`, `this_month`, `this_year`, `all_time` (default `this_month`). Calendar-aligned ongoing periods, not rolling windows. Legacy `week`/`month`/`year` map to `this_week`/`this_month`/`this_year` for back-compat.
- `offset` - 0-10000 (default 0)
- `limit` - 1-50 (default 5)

Response: `{ tracks, total, offset, limit, source }`. `source` is `"listenbrainz"`, `"lastfm"`, or `null`. Last.fm periods are rolling windows (`7day`, `1month`, `12month`, `overall`) and map approximately to the requested calendar range.

**GET /api/v1/listening/recent-tracks** query params:
- `limit` - 1-50 (default 5)

Response: `{ tracks, hasSource, source }`. `hasSource` is `false` when no scrobble-capable source is connected (UI should hide the tile). `source` identifies which source served the data.

---

## Jobs (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/jobs` | Admin | Paginated job list |
| GET | `/api/v1/jobs/:id` | Admin | Single job detail |
| GET | `/api/v1/jobs/health` | Admin | System health summary (pipeline, subscriptions, playlists, library sync, sources) |

**GET /api/v1/jobs** query params:
- `type` - `pipeline`, `quick_discover`, `subscription`, `target`, `playlist`, `library_sync`
- `status` - `running`, `completed`, `failed`, `stuck`
- `limit` - 1-100 (default 50)
- `offset` - pagination offset (minimum 0)
- Invalid `type` or `status` values return `400`

---

## Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/settings` | Yes | Get settings (secrets masked) |
| PATCH | `/api/v1/settings` | Yes | Update settings (admin for global, any user for own connections) |
| POST | `/api/v1/settings/test/:service` | Yes | Test service connection |
| POST | `/api/v1/settings/test-webhook` | Admin | Send test webhook |

**Testable services**: `lidarr`, `listenbrainz`, `lastfm`, `ai`, `plex`, `jellyfin`, `emby`, `discogs`, `spotify`, `oidc`

Settings notes:
- Non-admin users can update only their own connection fields; global setting changes return `403`
- `lidarr` and `ai` test calls require admin access when user-session auth is active
- Successful service probes return `200` with a required `message` plus optional metadata:
  `{ "message": "Connected", "version": "1.2.3", "latencyMs": 42 }`
- Failed service probes return `application/problem+json`: `400` for missing or unknown input,
  `403` for non-admin callers, and `502` when the upstream service probe fails

---

## Users (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/users` | Admin | List all users |
| POST | `/api/v1/users` | Admin | Create user |
| PATCH | `/api/v1/users/:id` | Admin | Update user (admin status) |
| DELETE | `/api/v1/users/:id` | Admin | Delete user |

---

## Lidarr

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/lidarr/stats` | Admin | Artist count, monitored count |
| GET | `/api/v1/lidarr/profiles` | Admin | Quality profiles |
| GET | `/api/v1/lidarr/metadataprofiles` | Admin | Metadata profiles |
| GET | `/api/v1/lidarr/rootfolders` | Admin | Root folders |
| GET | `/api/v1/lidarr/approve-options` | Yes | Non-admin picker data for the approve dialog: quality/metadata profile names and root-folder paths only (no freeSpace/structure) |
| POST | `/api/v1/lidarr/add` | Admin | Add artist to Lidarr |

---

## Admin (Admin)

All `/api/v1/admin/*` endpoints require admin authentication.

### Backup & Restore

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/admin/backup` | Admin | Download backup JSON. Query: `?includeCaches=true` |
| POST | `/api/v1/admin/restore` | Admin | Upload and restore backup. Query: `?force=true` to skip encryption key mismatch check. Accepts multipart form (field: `file`) or raw JSON body. |
| GET | `/api/v1/admin/backup/last` | Admin | Last auto-backup metadata. |

### Upgrade

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/admin/migrations/pending` | Admin | Pending migration status. |

### Data Hygiene

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/admin/hygiene/clear-image-failures` | Admin | Reset image failure cache. Query: `?olderThan=7d` |
| POST | `/api/v1/admin/hygiene/rebuild-genres` | Admin | Rebuild genre table from artist data. |
| POST | `/api/v1/admin/hygiene/rescore` | Admin | Re-score recommendations. Query: `?status=pending` (default), `?status=pending,approved` |
| POST | `/api/v1/admin/hygiene/dedupe` | Admin | Find and remove duplicate recommendations. |
| POST | `/api/v1/admin/hygiene/ai-audit` | Admin | Audit AI reasoning. Query: `?autoFix=true`. Returns 202 when auto-fix starts. |
| GET | `/api/v1/admin/hygiene/ai-audit/results` | Admin | Poll auto-fix progress. |
| POST | `/api/v1/admin/hygiene/purge-sessions` | Admin | Delete expired login sessions. |

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Liveness check (DB connectivity) |
