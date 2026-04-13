# API Reference

All endpoints require authentication via `Authorization: Bearer <token>` header unless marked as public. Only `/api/pipeline/events` and `/api/preview/audio` also accept `?token=<token>` for SSE and `<audio>` clients that cannot send headers.

Locale-aware routes accept `X-Digarr-Locale` to override the saved user locale for that request. If the header is absent, Digarr falls back to the saved user preference and then `Accept-Language`.

Admin-only endpoints return 403 for non-admin users.

---

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Create account. First user becomes admin. Rate limited: 5/min |
| POST | `/api/auth/login` | No | Login with username/password. Rate limited: 10/min |
| POST | `/api/auth/logout` | Yes | Invalidate current session |
| GET | `/api/auth/status` | No | Server auth status, OIDC config, version |
| GET | `/api/auth/me` | Yes | Current user profile |
| GET | `/api/auth/validate` | Yes | Lightweight token/session validity check. Returns `204` when valid |
| PATCH | `/api/auth/me/locale` | Yes | Update the saved user locale. Session auth only. |
| POST | `/api/auth/change-password` | Yes | Change password. Invalidates all sessions. Rate limited: 5/min |
| GET | `/api/auth/me/preferences` | Yes | Get merged user preferences |
| PATCH | `/api/auth/me/preferences` | Yes | Update user preferences (partial merge) |

**PATCH /api/auth/me/locale** body:
```json
{ "preferredLocale": "fr" }
```

Notes:
- `preferredLocale` may be a supported locale string or `null`
- Supported locales: `en`, `es`, `fr`, `de`, `pt-BR`, `it`, `nl`, `ro`, `pl`, `tr`, `uk`, `ru`, `ja`, `ko`, `zh-CN`
- Legacy token auth is rejected with `403`; this route requires a session-authenticated user

### OIDC / OAuth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/oidc/login` | No | Redirect to OIDC provider. Requires `ALLOWED_ORIGIN` env var |
| GET | `/api/auth/oidc/callback` | No | OIDC callback, creates user if needed |
| POST | `/api/auth/oauth/:provider/initiate` | Yes | Start OAuth flow (e.g. Spotify) |
| GET | `/api/auth/oauth/:provider/callback` | No | OAuth callback |
| GET | `/api/auth/oauth/:provider/status` | Yes | Check OAuth connection status |
| DELETE | `/api/auth/oauth/:provider` | Yes | Disconnect OAuth provider |

---

## Setup

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/setup/status` | No | Check if setup is complete |
| POST | `/api/setup/complete` | No | Complete initial setup |

Setup validation rules:
- `aiProvider` and `aiModel` are required
- Lidarr is optional, but `lidarrUrl` and `lidarrApiKey` must be provided together when used
- Emby is optional, but `embyUrl`, `embyApiKey`, and `embyUserId` must be provided together when used
- When Lidarr is provided during setup, Digarr auto-creates the default Lidarr target for the first user
- When Emby is provided during setup, Digarr stores the per-user Emby connection and auto-creates an Emby playlist target

**POST /api/setup/complete** body:
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
| POST | `/api/pipeline/run` | Yes | Start a full discovery scan. Returns 202. |
| GET | `/api/pipeline/status` | Yes | Current pipeline status (running, stage, last run) |
| GET | `/api/pipeline/events` | Yes | SSE stream of pipeline progress events |
| POST | `/api/pipeline/quick-discover` | Yes | Fire-and-forget: discover artists similar to a given name. Rate limited: 5/min |
| POST | `/api/pipeline/rescan` | Yes | Re-fetch images/metadata for existing recommendations |

**POST /api/pipeline/quick-discover** body:
```json
{ "artistName": "Radiohead" }
```

Locale notes:
- `POST /api/pipeline/run` and `POST /api/pipeline/quick-discover` honor `X-Digarr-Locale`
- For authenticated users, the explicit request locale wins over the saved user locale for that request
- AI responses follow the resolved UI locale; prompt-language detection is handled separately for freeform inputs

---

## Discovery Modes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/discovery-modes` | Yes | List discovery modes with current availability, fallback, and field metadata |
| POST | `/api/discovery-modes/run` | Yes | Start a manual discovery-mode run. Returns 202 with no batch ID. |

**GET /api/discovery-modes** notes:
- Always returns the shipped discovery-mode catalog, including modes that are visible but currently unavailable
- In the web UI, these modes are exposed from Discover -> Discovery Modes
- Each mode includes `availability.enabled`, `availability.fallbackUsed`, `availability.providerPath`, and an optional `availability.reason`
- Unavailable modes stay visible for roadmap transparency, should be treated as read-only UI metadata, and are not runnable jobs

**POST /api/discovery-modes/run** body:
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

**POST /api/discovery-modes/run** behavior:
- Returns `202 { "message": "Discovery run started" }` after validation; the actual run continues in the background
- The server re-evaluates availability and execution context from the current user connections before starting the run
- Returns `400` with the availability reason when a mode is currently unavailable, matching the `availability.reason` shown in the UI

---

## Recommendations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/recommendations` | Yes | List recommendations (paginated, filterable) |
| GET | `/api/recommendations/:id` | Yes | Get single recommendation with artist data |
| PATCH | `/api/recommendations/:id` | Yes | Approve, reject, or restore a recommendation |
| POST | `/api/recommendations/bulk` | Yes | Bulk approve/reject |
| GET | `/api/recommendations/feedback-summary` | Yes | Genre approval rates (top 20) |

**GET /api/recommendations** query params:
- `status` -- `pending`, `approved`, `rejected`, `added_to_lidarr`, `add_failed` (comma-separated)
- `batchId` -- filter by batch
- `sort` -- `score_desc` (default), `score_asc`, `created_desc`, `acted_on_desc`
- `decades` -- era filter, comma-separated: `60s`, `70s`, `80s`, `90s`, `00s`, `10s`, `20s`
- `limit` -- 1-200 (default 20)
- `offset` -- pagination offset

**PATCH /api/recommendations/:id** body:
```json
{
  "status": "approved",
  "approvalMode": "combined_lidarr_slskd",
  "monitorOption": "all",
  "lidarrTargetId": "lidarr-1",
  "targetId": "slskd-7",
  "qualityProfileId": 1,
  "metadataProfileId": 1,
  "rootFolderId": 1
}
```

Approval notes:
- `approvalMode` defaults to `single_target`
- use `approvalMode: "combined_lidarr_slskd"` with an `slskd-*` `targetId` to add to Lidarr first and then queue the matched release in `slskd`
- `lidarrTargetId` is optional; when the selected `slskd` target is linked to a Lidarr target, Digarr uses that linked target as the fallback, and an explicit `lidarrTargetId` only overrides that default

---

## Artists

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/artists/:id` | Yes | Get artist by ID |
| GET | `/api/artists/:id/top-tracks` | Yes | Top 5 tracks (Deezer, MB fallback) |
| GET | `/api/albums/:mbid` | Yes | Release groups for an artist MBID |
| GET | `/api/preview/audio` | Yes | Proxy Deezer preview audio (CORS bypass) |

**GET /api/preview/audio** query params:
- `url` -- Deezer CDN preview URL (must match `*.dzcdn.net`)
- `token` -- auth token (for `<audio>` elements that can't send headers)

---

## Batches

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/batches` | Yes | List all recommendation batches |
| GET | `/api/batches/:id` | Yes | Get batch details |

---

## Subscriptions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/subscriptions` | Yes | List user subscriptions |
| POST | `/api/subscriptions` | Yes | Create subscription |
| PATCH | `/api/subscriptions/:id` | Yes | Update subscription |
| DELETE | `/api/subscriptions/:id` | Yes | Delete subscription |
| POST | `/api/subscriptions/:id/run` | Yes | Trigger manual run (202) |
| GET | `/api/subscriptions/:id/runs` | Yes | Run history |
| POST | `/api/subscriptions/import/spotify-liked-songs` | Yes | Create/reuse the helper Spotify Liked Songs subscription and trigger an import run (202) |
| POST | `/api/subscriptions/import/spotify-playlist` | Yes | Import from a Spotify playlist (accepts URL, URI, or bare ID). Returns 202. |
| POST | `/api/subscriptions/import/csv` | Yes | Upload CSV of artist names (multipart form, field: `file`, max 1MB, 500 artists). Returns 202. |
| POST | `/api/subscriptions/import/deezer-favorites` | Yes | Create/reuse Deezer Favorites subscription and trigger import (202) |
| POST | `/api/subscriptions/import/deezer-followed` | Yes | Create/reuse Deezer Followed Artists subscription and trigger import (202) |
| GET | `/api/subscriptions/import/deezer-playlists` | Yes | List user's Deezer playlists |
| POST | `/api/subscriptions/import/deezer-playlists` | Yes | Import from a Deezer playlist (202) |
| GET | `/api/subscriptions/adapter-types` | Yes | Available adapter types with config schemas |
| GET | `/api/subscriptions/scheduler` | Yes | Scheduler job status |
| POST | `/api/subscriptions/bulk-toggle` | Yes | Enable/disable all subscriptions |

**Adapter types**: `genre`, `similar`, `discovery-mode`, `spotify-liked-songs`, `spotify-playlist`, `spotify-charts`, `deezer-favorites`, `deezer-followed`, `deezer-flow`, `deezer-playlists`, `lastfm-tag`, `lastfm-charts`, `listenbrainz`, `csv-import`

**POST /api/subscriptions** body:
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
| GET | `/api/targets` | Yes | List all targets (config masked for non-owners) |
| POST | `/api/targets` | Admin | Create target |
| PATCH | `/api/targets/:id` | Admin | Update target |
| DELETE | `/api/targets/:id` | Admin | Delete target |
| POST | `/api/targets/:id/test` | Yes | Test target connection |

**Target types**: `lidarr`, `slskd`, `spotify-playlist`, `navidrome-playlist`, `jellyfin-playlist`, `emby-playlist`, `plex-playlist`, `export`

## slskd

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/slskd/jobs` | Admin | Inspect active `slskd` orchestration jobs and current sync state. |
| POST | `/api/slskd/sync` | Admin | Trigger a manual `slskd` orchestration sync. Returns 202 immediately. |

**POST /api/slskd/sync** notes:
- No request body
- The route acknowledges immediately and lets the sync continue in the background
- The sync worker polls linked Lidarr wanted releases, creates deduped `slskd` jobs, advances active jobs through search and transfer states, and verifies Lidarr imports before marking linked jobs complete

**GET /api/slskd/jobs** response shape:

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
| GET | `/api/genres` | Yes | List genres with artist counts and examples |
| GET | `/api/genres/search?q=` | Yes | Search genres (min 2 chars) |
| GET | `/api/genres/:slug` | Yes | Genre detail with sub-genres and library artists |
| GET | `/api/genres/:slug/artists` | Yes | Artists by genre (view: recommended/trending/deep_cuts) |
| POST | `/api/genres/seed` | Yes | Seed genre database from Lidarr library (202) |

---

## Playlists

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/playlists` | Yes | List user playlists |
| POST | `/api/playlists` | Yes | Create playlist |
| GET | `/api/playlists/:id` | Yes | Playlist with tracks |
| PATCH | `/api/playlists/:id` | Yes | Update playlist |
| DELETE | `/api/playlists/:id` | Yes | Delete playlist |
| POST | `/api/playlists/:id/generate` | Yes | Generate playlist tracks (202) |
| GET | `/api/playlists/:id/export/:format` | Yes | Export as json/csv/m3u/xspf |
| GET | `/api/playlists/scheduler` | Yes | Playlist scheduler status |

**Strategies**: `weekly_digest`, `genre_focus`, `mood_mix`, `rediscover`

---

## Mood Discovery

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/mood/discover` | Yes | AI-powered mood-based discovery. Rate limited: 10/min |

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
- `POST /api/mood/discover` honors `X-Digarr-Locale`
- The response reasoning follows the resolved UI locale, while prompt-language detection uses the submitted mood text

---

## Search

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/search` | Yes | Cross-platform artist search |
| GET | `/api/search/sources` | Yes | Available search sources |

**Sources**: `spotify`, `deezer`, `musicbrainz`, `tidal`, `bandcamp`

Each source includes a `stability` field (`stable` or `experimental`). TIDAL and Bandcamp are experimental.

**GET /api/search** query params:
- `q` -- required search string
- `sources` -- optional comma-separated source IDs
- `limit` -- 1-50 (default 20)

When one enabled source fails, Digarr still returns results from the healthy sources when possible.

---

## Analytics (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/analytics/overview` | Admin | Summary stats |
| GET | `/api/analytics/batches` | Admin | Batch history |
| GET | `/api/analytics/genres` | Admin | Top genres by recommendation count |
| GET | `/api/analytics/sources` | Admin | Source effectiveness |
| GET | `/api/analytics/scores` | Admin | Score distribution |
| GET | `/api/analytics/trend` | Admin | Approval trend over time |
| GET | `/api/analytics/time-to-act` | Admin | Time-to-decision metrics |

---

## Library Health (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/library/health` | Admin | Health check results + scan status |
| POST | `/api/library/health/scan` | Admin | Start background health scan (202) |
| POST | `/api/library/health/:checkId/fix` | Admin | Apply fix for a health check |
| GET | `/api/library/stats` | Admin | Library statistics |
| POST | `/api/library/warm` | Admin | Warm SkyHook cache for MBIDs (202) |
| GET | `/api/library/warm/status` | Admin | SkyHook warm status |
| GET | `/api/library/sources` | Admin | Per-source sync state for global + per-user library sources |
| POST | `/api/library/sync` | Admin | Run a manual library sync for all sources or a specific source |
| GET | `/api/library/unreconciled` | Admin | List unreconciled library artists still needing a match |
| GET | `/api/library/unreconciled-albums` | Admin | List unreconciled library albums still needing a release-group match |
| GET | `/api/library/album-coverage/:artistMbid` | Yes | Owned/missing album counts for an artist, used by the recommendation card coverage badge |
| POST | `/api/library/overrides` | Admin | Save a manual artist MBID override or an “ignore forever” decision |
| POST | `/api/library/album-overrides` | Admin | Save a manual album release-group MBID override or an ignore decision |
| DELETE | `/api/library/overrides/:source/:sourceArtistId` | Admin | Remove a saved manual artist override |
| POST | `/api/library/reconcile` | Admin | Trigger a background reconcile pass after override changes |

**GET /api/library/sources** response notes:
- `lastSyncCounts.albumsSynced` is present for album-capable sources after a successful sync
- Lidarr, Plex, and Jellyfin source rows now include artist sync counts plus the number of reconciled album rows written for that source snapshot

**POST /api/library/warm** body:
```json
{
  "mbids": ["f59c5520-5f46-4d2c-b2c4-822eabf53419"]
}
```

Notes:
- `mbids` must be a non-empty array of strings
- Only the first 50 MBIDs are queued per request

**GET /api/library/warm/status** query params:
- `mbids` -- comma-separated MBIDs to inspect (up to 100)

**POST /api/library/sync** notes:
- Rate limited: 5/min
- Empty body runs global source sync plus a forced sync for the current user and returns `202`
- `{ "source": "lidarr" }` runs a single source and returns `200` on completion, `202` if still running, or `502` on sync failure
- If the requested source is not configured for the current user, Digarr retries it as a global source

**POST /api/library/sync** body:
```json
{
  "source": "plex"
}
```

**GET /api/library/unreconciled** response notes:
- Returns unreconciled rows from both the current user's sources and any global sources visible to that user

**POST /api/library/overrides** body:
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

**POST /api/library/album-overrides** body:
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

**GET /api/library/album-coverage/:artistMbid** notes:
- `artistMbid` must be a valid UUID
- Returns owned and missing album counts derived from the user's reconciled library snapshot
- Powers the coverage badge shown on recommendation cards

**GET /api/library/unreconciled-albums** response notes:
- Returns unreconciled album rows from both the current user's sources and any global sources visible to that user

**POST /api/library/reconcile** notes:
- Triggers a forced sync for the current user and returns `202`
- This currently re-fetches source data; there is no reconcile-only path yet

---

## Exports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/exports/:format` | Yes | Export recommendations as json/csv/m3u/xspf |

Query params: `status`, `batchId`. Limit: 10,000 rows.

---

## Dashboard

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dashboard/taste` | Yes | Top genres from user's library |
| GET | `/api/dashboard/activity?limit=` | Yes | Recent activity feed |

---

## Listening

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/listening/recent` | Yes | Recent listening history (Last.fm/ListenBrainz) |

Query params: `range` (week/month/year), `limit` (1-50).

---

## Jobs (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/jobs` | Admin | Paginated job list |
| GET | `/api/jobs/:id` | Admin | Single job detail |
| GET | `/api/jobs/health` | Admin | System health summary (pipeline, subscriptions, playlists, sources) |

**GET /api/jobs** query params:
- `type` -- `pipeline`, `quick_discover`, `subscription`, `target`, `playlist`, `library_sync`
- `status` -- `running`, `completed`, `failed`, `stuck`
- `limit` -- 1-100 (default 50)
- `offset` -- pagination offset (minimum 0)
- Invalid `type` or `status` values return `400`

---

## Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings` | Yes | Get settings (secrets masked) |
| PATCH | `/api/settings` | Yes | Update settings (admin for global, any user for own connections) |
| POST | `/api/settings/test/:service` | Yes | Test service connection |
| POST | `/api/settings/test-webhook` | Admin | Send test webhook |

**Testable services**: `lidarr`, `listenbrainz`, `lastfm`, `ai`, `plex`, `jellyfin`, `emby`, `discogs`, `spotify`, `oidc`

Settings notes:
- Non-admin users can update only their own connection fields; global setting changes return `403`
- `lidarr` and `ai` test calls require admin access when user-session auth is active

---

## Users (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users` | Admin | List all users |
| POST | `/api/users` | Admin | Create user |
| PATCH | `/api/users/:id` | Admin | Update user (admin status) |
| DELETE | `/api/users/:id` | Admin | Delete user |

---

## Lidarr

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/lidarr/stats` | Yes | Artist count, monitored count |
| GET | `/api/lidarr/profiles` | Yes | Quality profiles |
| GET | `/api/lidarr/metadataprofiles` | Yes | Metadata profiles |
| GET | `/api/lidarr/rootfolders` | Yes | Root folders |
| POST | `/api/lidarr/add` | Yes | Add artist to Lidarr |

---

## Admin (Admin)

All `/api/admin/*` endpoints require admin authentication.

### Backup & Restore

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/backup` | Admin | Download backup JSON. Query: `?includeCaches=true` |
| POST | `/api/admin/restore` | Admin | Upload and restore backup. Query: `?force=true` to skip encryption key mismatch check. Accepts multipart form (field: `file`) or raw JSON body. |
| GET | `/api/admin/backup/last` | Admin | Last auto-backup metadata. |

### Upgrade

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/migrations/pending` | Admin | Pending migration status. |

### Data Hygiene

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/hygiene/clear-image-failures` | Admin | Reset image failure cache. Query: `?olderThan=7d` |
| POST | `/api/admin/hygiene/rebuild-genres` | Admin | Rebuild genre table from artist data. |
| POST | `/api/admin/hygiene/rescore` | Admin | Re-score recommendations. Query: `?status=pending` (default), `?status=pending,approved` |
| POST | `/api/admin/hygiene/dedupe` | Admin | Find and remove duplicate recommendations. |
| POST | `/api/admin/hygiene/ai-audit` | Admin | Audit AI reasoning. Query: `?autoFix=true`. Returns 202 when auto-fix starts. |
| GET | `/api/admin/hygiene/ai-audit/results` | Admin | Poll auto-fix progress. |
| POST | `/api/admin/hygiene/purge-sessions` | Admin | Delete expired login sessions. |

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Liveness check (DB connectivity) |
