# API Reference

This reference covers v1.19.0; consult the [changelog](../CHANGELOG.md) for release changes. Unversioned `/api/*` routes have been removed; use `/api/v1/*`.

All endpoints require either a `digarr_session` cookie or an
`Authorization: Bearer <token>` header unless marked as public. Bearer sessions
remain the compatibility path for non-browser API clients. Only
`/api/v1/pipeline/events` and `/api/v1/preview/audio` also accept
`?token=<token>` for SSE and `<audio>` clients that cannot send headers.

Cookie- or proxy-authenticated `POST`, `PUT`, `PATCH`, and `DELETE` requests
must send `X-Digarr-CSRF: 1` plus exact same-origin browser evidence. The
bundled UI handles this automatically. Verified bearer requests do not require
the CSRF header. Browser-shaped public mutations, including login and
registration, also require the header; non-browser requests without browser
origin signals remain compatible. OpenAPI expresses protected mutations as
`sessionCookie` + `csrfHeader`, or `bearerToken`. Set `ALLOWED_ORIGIN` to the
exact public origin when a reverse proxy or TLS terminator changes the scheme
or host seen by the application; the value controls CSRF origin checks and the
OIDC callback URL. Production session and OIDC cookies default to `Secure` even
when the backend request arrives over HTTP behind a TLS terminator; a
production instance served directly over plain HTTP must set
`DIGARR_ALLOW_INSECURE_COOKIES=true` (with a matching `http://` `ALLOWED_ORIGIN`)
and is vulnerable to network interception. See
[Authentication](AUTHENTICATION.md#cookie-secure-policy).

Locale-aware routes accept `X-Digarr-Locale` to override the saved user locale for that request. If the header is absent, Digarr falls back to the saved user preference and then `Accept-Language`.

Admin-only endpoints return 403 for non-admin users. CSRF rejection also returns `403`, with `application/problem+json` and type `/problems/csrf-validation-failed`, before the route handler runs.

---

## Pagination shapes

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
- `GET /api/v1/listening/top-artists` returns `{ "tracks": [], "total": 0, "offset": 0, "limit": 5, "source": null, "status": "not_configured" }`; Last.fm requires page-aligned offsets as described under [Listening](#listening).

---

## API metadata

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/docs` | No | Minimal HTML entry point for API documentation |
| GET | `/api/v1/docs/openapi.json` | No | OpenAPI 3.1 document with shared schemas plus selected stable route groups |

OpenAPI coverage currently includes auth status/login/register/session
migration, recommendation list/get/update, artist blocks, jobs, library reconciliation lists
and bulk ignore, and settings service probes. Some mutation bodies remain generic objects; bulk recommendations, feedback summaries, playlist projections, and preference writes are not machine-described. The Markdown reference is the complete route inventory and the detailed contract for those operations.

---

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | No | Create account. First user becomes admin. Rate limited: 5/min |
| POST | `/api/v1/auth/login` | No | Login with username/password. Rate limited: 10/min |
| POST | `/api/v1/auth/session/migrate` | Bearer session | Atomically replace an active bearer session with an HttpOnly cookie session |
| POST | `/api/v1/auth/logout` | Yes | Invalidate current session |
| GET | `/api/v1/auth/status` | No | Login-screen auth requirement and OIDC availability |
| GET | `/api/v1/auth/meta` | Yes | Deployment metadata: version and enabled auth integrations |
| GET | `/api/v1/auth/me` | Yes | Current user profile |
| GET | `/api/v1/auth/validate` | Yes | Lightweight token/session validity check. Returns `204` when valid |
| PATCH | `/api/v1/auth/me/locale` | Yes | Update the saved user locale. Session auth only. |
| PATCH | `/api/v1/auth/me/email` | Yes (5/min) | Set or clear the user's email. Session auth only. |
| POST | `/api/v1/auth/change-password` | Yes | Change password. Invalidates all sessions. Rate limited: 5/min |
| GET | `/api/v1/auth/me/preferences` | Yes | Get merged user preferences |
| PATCH | `/api/v1/auth/me/preferences` | Yes | Update user preferences (top-level partial merge). Session auth only. |

**PATCH /api/v1/auth/me/locale** body:
```json
{ "preferredLocale": "fr" }
```

**PATCH /api/v1/auth/me/email** body:
```json
{ "email": "you@example.com" }
```

Notes:
- Login and registration return `{ user, token }` for API clients by default.
  Send `X-Digarr-Auth-Mode: cookie` to receive an HttpOnly session cookie and a
  `{ user }` response without the raw token.
- Registration trims surrounding username whitespace and requires 2-50 characters. Passwords require at least 12 characters.
- Registration returns `201`; closed registration returns `403`, an existing
  username returns `409`, and the sixth request from one source within a minute
  returns `429`.
- `POST /api/v1/auth/session/migrate` accepts only an active per-user session
  bearer. It returns `204` after rotating that bearer into a cookie, `403` for
  the deprecated shared token or another auth method, and `409` when the source
  session was already replaced.
- An `Authorization` header suppresses cookie fallback, including when the
  header is malformed or its token is invalid.
- Password changes invalidate every session for the user. Cookie callers
  receive a replacement cookie and `204`; bearer callers receive
  `{ "token": "..." }` for the replacement session. The password verification
  and session replacement run in one atomic transaction under a user-row lock,
  so a password verified before a concurrent reset cannot mint a post-reset
  session.
- `preferredLocale` may be a supported locale string or `null`
- Supported locales: `en`, `es`, `fr`, `de`, `pt-BR`, `it`, `nl`, `ro`, `pl`, `tr`, `uk`, `ru`, `ja`, `ko`, `zh-CN`
- `email` may be a valid address, an empty string, or `null`; empty/null clears it
- A non-empty `email` must be unique across users; a collision returns `409`
  (`code: errors.auth.emailTaken`). Digarr does not auto-link OIDC identities by
  email; see [OIDC account matching](AUTHENTICATION.md#oidc-account-matching)
- Legacy token auth is rejected with `403`; this route requires a session-authenticated user
- `POST /api/v1/auth/change-password` also rejects legacy token auth with `403`; password changes require a session-authenticated user
- `PATCH /api/v1/auth/me/preferences` also rejects legacy token auth with `403`; preference writes require a session-authenticated user
- `GET /api/v1/auth/status` returns `required: true` as soon as setup is complete, even if no users exist yet, so the frontend can force registration/login instead of treating the app as public

The Recommendations settings page first saves user preferences, then writes global metadata settings. For non-admins, the second request returns `403`, so the UI reports failure and skips refreshing cached values even after the preference write succeeds ([#792](https://github.com/iuliandita/digarr/issues/792)). Verify saved values with `GET /api/v1/auth/me/preferences`, or use the per-user `PATCH` directly. `netNewAlbumDiscovery` is not in the per-user allowlist and is silently ignored; the strict global preferences schema rejects it. The UI toggle cannot persist this setting in v1.19.0 ([#791](https://github.com/iuliandita/digarr/issues/791)). Use Release Radar or Library Gap-Fill for album recommendations.

Preference updates merge top-level keys only. A supplied `scoringWeights` object replaces the saved object; omitted weights fall back to defaults rather than retaining saved values. Send the complete intended `scoringWeights` object when changing weights.

### OIDC / OAuth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/auth/oidc/login` | No | Redirect to OIDC provider. Requires `ALLOWED_ORIGIN` env var. Sets a browser-bound, one-time, 10-min `HttpOnly` transaction cookie. Rate limited: 10/min |
| POST | `/api/v1/auth/oidc/link` | Cookie session | Start account linking after current-password verification. Returns `{ url }`. Requires CSRF protection and an unlinked local account. Rate limited: 5/min |
| GET | `/api/v1/auth/oidc/callback` | Transaction-bound | OIDC callback; consumes the browser-bound transaction once. Login creates the user if needed and sets a session cookie. Linking also requires the initiating session and updates only its account's OIDC subject. Not rate limited |
| POST | `/api/v1/auth/oauth/:provider/initiate` | Yes | Start OAuth flow (`spotify`, `deezer`, `tidal`). Sets a browser-bound, 10-min `HttpOnly` transaction cookie scoped to the provider's callback path. Rate limited: 5/min |
| GET | `/api/v1/auth/oauth/:provider/callback` | No | OAuth callback; requires the transaction cookie from initiate. The pending authorization is consumed on read, so a `state` works exactly once. Not rate limited |
| GET | `/api/v1/auth/oauth/:provider/status` | Yes | Check OAuth connection status |
| DELETE | `/api/v1/auth/oauth/:provider` | Yes | Disconnect OAuth provider |

**POST /api/v1/auth/oidc/link** body:

```json
{ "currentPassword": "your-current-password" }
```

The authorization URL uses the existing registered OIDC callback. Linking
returns to `/settings?tab=account` with `oidc_link=success`, `identity_in_use`,
or `failed`. It does not create a session, merge accounts, or match by email.
Logging out or changing the password before the callback invalidates the
attempt. See [Authentication](AUTHENTICATION.md#oidc-account-matching).

**POST /api/v1/auth/oauth/:provider/initiate** notes:
- For `tidal`, the body `clientId` / `clientSecret` are ignored: the server reads the one admin-registered TIDAL app from settings, so the bundled UI sends empty strings. Returns `400` with `TIDAL app credentials are not configured on the server` when no admin app is registered.
- For `tidal`, the body `redirectUri` is ignored whenever `ALLOWED_ORIGIN` is set; the server pins the callback to `${ALLOWED_ORIGIN}/api/v1/auth/oauth/tidal/callback`. With `ALLOWED_ORIGIN` unset, the client-supplied value is accepted only outside production and only for a loopback host; production returns `400 ALLOWED_ORIGIN must be set to connect TIDAL`. The registered URI at TIDAL must match whichever value applies.
- In-flight authorizations live in their own table, so calling initiate on an already-connected provider no longer disturbs the stored token: an abandoned re-connect leaves the existing connection intact. Starting a new flow discards the previous unfinished one for the same user and provider.
- Only digests of the `state` and of the browser binding are persisted, and the row expires after 10 minutes.

**GET /api/v1/auth/oauth/:provider/callback** redirects to `/settings` with either `oauth_success=<provider>` or `oauth_error=<stage>`. The settings page renders both as a dismissible banner and then strips the parameter from the URL. Stages:

| `oauth_error` | Meaning |
|---------------|---------|
| *(provider value)* | The provider returned an `error` query param; passed through verbatim |
| `missing_code_or_state` | The provider redirected without `code` or `state` |
| `no_pending_auth` | No pending authorization matches the `state` (never initiated, already consumed, or superseded by a newer flow) |
| `state_expired` | The pending authorization matched but is older than its 10-minute TTL |
| `browser_mismatch` | The transaction cookie is missing or does not match the browser that started the flow |
| `missing_credentials` | The stored client ID/secret for the provider are gone |
| `token_exchange_unreachable` | The token request threw before a response (DNS, TLS, reset, or the 10s timeout) |
| `token_exchange_failed` | The token endpoint answered non-2xx. The upstream error body is logged, truncated to 300 chars |
| `token_exchange_malformed` | The token endpoint answered 2xx with a non-JSON body. Not reachable for Deezer, which is allowed to answer form-encoded |
| `token_exchange_no_token` | The token endpoint answered 2xx but the body carried no `access_token` |
| `unknown_provider` | The `:provider` path segment is not a supported provider |

Treat these as untrusted when rendering: the pass-through case is provider-controlled. The settings banner maps only the known stages above to their own message; anything else renders a generic failure message with the raw value echoed back as inert, sanitized, length-capped text.

---

## Setup

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/setup/status` | No | Check if setup is complete |
| POST | `/api/v1/setup/complete` | No | Complete initial setup |

Setup validation rules:
- `aiProvider` and `aiModel` are required
- Lidarr is optional, but `lidarrUrl` and `lidarrApiKey` must be provided together when used
- Emby is optional. A nonempty `embyUrl` requires `embyApiKey` and `embyUserId`; a key or user ID supplied without a URL is accepted and discarded. Always send the complete trio.
- Creating a Lidarr target, saving the Emby connection, and creating an Emby playlist target require an authenticated caller. Register and authenticate before completing setup, or configure connections and targets afterward.
- Those connection and target writes are best effort: their failure does not prevent a `204` response. Confirm the saved connection and targets after setup ([#783](https://github.com/iuliandita/digarr/issues/783)).
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
| POST | `/api/v1/pipeline/run` | Yes | Start a full discovery scan, or queue it behind an in-flight run. Returns 202 with `{ message, status, queued, position }`; `status` is `started`, `queued`, or `duplicate`. |
| POST | `/api/v1/pipeline/cancel` | Yes | Request cancellation of the in-flight run and drop the queue. Returns 202 with `{ cancelled, message }` (`cancelled` is false when nothing was running). |
| GET | `/api/v1/pipeline/status` | Yes | Current pipeline status (running, stage, last run, `queueLength`, caller `queuePosition`) |
| GET | `/api/v1/pipeline/events` | Yes | SSE stream of pipeline progress events |
| POST | `/api/v1/pipeline/quick-discover` | Yes | Fire-and-forget: try saving the named seed, then discover similar artists. Rate limited: 5/min |
| POST | `/api/v1/pipeline/rescan` | Admin | Re-fetch images/metadata for up to 200 existing recommendations. Deduplicates artists, safely reuses shared-provider misses for seven days, and returns `{ attempted, updated, failed, total }` (`total` is a compatibility alias for `attempted`). Rate limited to 2/min; concurrent rescans return 409. |

`POST /api/v1/pipeline/run` is intentionally available to any authenticated
user: "Run Scan" is a core regular-user action on the dashboard and discover
screens. The orchestrator is single-flight (one run at a time, shared API/RAM
budgets), but a run requested while one is active is **queued FIFO**, not
rejected: the response is still 202 with `queued: true` and the caller's 1-based
`position`. A given user is deduped (a double-click does not stack two runs).
The queue drains automatically when the active run finishes. The queue is
in-memory and per-process.

`POST /api/v1/pipeline/cancel` is available to any authenticated user and clears
the pending queue. Cancellation is cooperative: when a checkpoint observes the
abort signal, the job is recorded as `cancelled` and emits a terminal progress
event. The final checkpoint precedes storage, so a late cancellation can leave
recommendation writes and automatic target additions running and finish with a
`completed` job status ([#790](https://github.com/iuliandita/digarr/issues/790)).

If the run is still marked running after 15 seconds, a backstop clears the
indicator and emits a `cancelled` event without terminating work or recording job cancellation. Neither
`cancelled: true` nor a cleared indicator proves that all writes have stopped.
Before a backend migration, follow the [migration prerequisites](guides/switching-backends.md#prerequisites)
and do not rely on cancellation as confirmation that the process is idle.

`POST /api/v1/pipeline/rescan` is admin-only because it writes shared artist
metadata using the requesting admin's configured providers. It runs one rescan
at a time and processes artists sequentially, bounding upstream concurrency and
preventing overlapping calls from multiplying shared provider traffic.

The rescan image policy matches normal discovery: TheAudioDB runs first. On a
miss, the configured Lidarr/SkyHook, fanart.tv, and musicinfo.pro fallbacks run
concurrently; results still prefer Lidarr, then fanart.tv, then musicinfo.pro.

A failed fallback does not stop the remaining image providers or the independent
MusicBrainz disambiguation refresh.

Complete misses from the globally shared AudioDB/Lidarr configuration refresh
the seven-day negative cache so repeated rescans do not immediately repeat the
same work. User-scoped fanart.tv or
musicinfo.pro configurations bypass that shared cache, and transient or
rate-limited lookups are not cached as misses.

**POST /api/v1/pipeline/quick-discover** body:
```json
{ "artistName": "Radiohead" }
```

Quick Discover first attempts to resolve and save the submitted artist itself as a pending recommendation with score `1.0`. This direct seed checks existing recommendation MBIDs but bypasses library membership, permanent blocks, rejection cooldowns, and score thresholds. Similar results are resolved and filtered separately through those checks. The seed may remain saved even when no similar artists are found. Job `artistsStored` counts only stored similar results, so it can be zero despite a saved seed ([#795](https://github.com/iuliandita/digarr/issues/795)).

Quick Discover and manual discovery-mode runs return `409 application/problem+json` with type `/problems/pipeline-already-running` when a pipeline scan is active. They do not join the full-scan FIFO queue.

Locale notes:
- `POST /api/v1/pipeline/run` and `POST /api/v1/pipeline/quick-discover` honor `X-Digarr-Locale`
- For authenticated users, the explicit request locale wins over the saved user locale for that request
- AI responses follow the resolved UI locale; prompt-language detection is handled separately for freeform inputs

---

## Discovery modes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/discovery-modes` | Yes | List discovery modes with current availability, fallback, and field metadata |
| POST | `/api/v1/discovery-modes/run` | Yes | Start a manual discovery-mode run. Returns 202 with a `jobId`, but no batch ID. |

**GET /api/v1/discovery-modes** notes:
- Always returns the shipped discovery-mode catalog, including modes that are visible but currently unavailable
- In the web UI, these modes are exposed from Discover -> Discovery Modes
- Each mode includes `availability.enabled`, `availability.fallbackUsed`, `availability.providerPath`, and an optional `availability.reason`
- Each mode also includes a `stability` field (`stable` or `experimental`), mirroring the search-source field. `tidal-favorite-artists` is `experimental`: live-account validation of TIDAL connect, token refresh, and populated favorite-artist results is deferred. Clients should badge experimental modes rather than hide them. See [TIDAL feedback](AUTHENTICATION.md#tidal-feedback) for safe community reports.
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
- Returns `202 { "message": "Discovery run started", "jobId": 123 }` after validation; the actual run continues in the background
- The accepted response includes `jobId`. Admin clients can poll `/api/v1/jobs/:id`; job endpoints return `403` for non-admins. Ordinary users can refresh Discover to see stored recommendations; the bundled mode card shows the accepted-run feedback, not an unrestricted job-detail subscription
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
| GET | `/api/v1/recommendations/feedback-summary` | Yes | Genre approval rates (top 20, at least 3 acted-on recommendations per genre), scoped to the calling user's own feedback |
| GET | `/api/v1/recommendations/popular-albums/availability` | Yes | Credential availability for the popular-album approve option: Spotify token resolution succeeds and/or a Last.fm API key is stored. Does not probe album lookups; a subsequent lookup can still fail. Returns `{ available, spotify, lastfm }` (booleans). |

**GET /api/v1/recommendations/feedback-summary** returns `{ summary: [{ genre, approved, rejected, total, rate }] }`, ordered by descending rate. `total` counts recommendations with an action timestamp. `approved` counts only current `approved` and `added_to_lidarr` statuses; `rejected` is every other counted row, including failed approvals and recommendations restored to pending. `rate` is `approved / total`, so it is not a pure like/dislike ratio ([#789](https://github.com/iuliandita/digarr/issues/789)).

**GET /api/v1/recommendations** query params:
- `status` - `pending`, `approved`, `rejected`, `added_to_lidarr`, `add_failed`, `duplicate`, `queued` (comma-separated)
- `kind` - `artist` or `album`; omitted or unrecognized values return both. Backs the Discover kind filter and the Albums tab (`?kind=album`)
- `batchId` - filter by batch
- `sort` - `score_desc` (default), `score_asc`, `created_desc`, `acted_on_desc`, `taste`
- `tasteTier` - optional `primary` or `secondary`; secondary excludes primary matches

- `decades` - era filter, comma-separated: `60s`, `70s`, `80s`, `90s`, `00s`, `10s`, `20s+` (2020-2099). URL-encode the plus sign as `%2B`; unknown tokens are ignored
- `limit` - 1-200 (default 20)
- `offset` - pagination offset

Taste ordering reads only the authenticated user's optional `primaryGenres` and `secondaryGenres` preferences. It orders primary matches, secondary matches, then other recommendations, using descending score within each group and ID for ties. Genres match exact names after trimming and lowercasing; there is no inferred genre taxonomy. Missing preferences retain score ordering. Filtering and ordering do not change stored scores, statuses, thresholds, or auto-approval.

Save either list through `PATCH /api/v1/auth/me/preferences`: `{"primaryGenres":["metal","jazz"],"secondaryGenres":["ambient"]}`. Each list accepts up to 24 nonempty names of at most 64 characters. Names are trimmed, lowercased, and deduplicated. Empty lists clear the preference.

Each item carries a `kind` field (`artist` or `album`). For `kind: "album"`, `recommendedReleaseGroupId` / `recommendedReleaseGroupTitle` identify the album (its `artistId` still points at the album's artist), and the UI renders the album as the primary unit.

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

The writable `status` values are `approved`, `rejected`, and `pending`; use `pending` to restore a recommendation.

Approval notes:
- `approvalMode` defaults to `single_target`
- `monitorOption` accepts `all`, `new`, `selected`, `popular`, or `none`, and defaults to `none` when omitted: the artist is added to Lidarr without monitoring any albums and no search is triggered.

  These are Digarr's names, translated to the target's own vocabulary at the boundary: `all` monitors the whole discography and triggers a search for missing albums, and `new` monitors only future releases (Lidarr's `future`) without searching for anything existing.
- `popular` tries Spotify popularity first, then Last.fm top albums when Spotify returns no candidates. It maps up to three matching MusicBrainz release groups and sends them to Lidarr as selected albums. If neither source returns candidates, approval fails with `no_source`; if candidates cannot be mapped, it fails with `no_match`.
- `selectedAlbumIds` contains MusicBrainz release-group MBIDs when `monitorOption` is `selected`; clients may omit it for `popular` because Digarr resolves the top albums server-side.
- For artist recommendations, use `approvalMode: "combined_lidarr_slskd"` with an `slskd-*` `targetId` to add to Lidarr first and then queue the matched release in `slskd`
- `lidarrTargetId` is optional; when the selected `slskd` target is linked to a Lidarr target, Digarr uses that linked target as the fallback, and an explicit `lidarrTargetId` only overrides that default
- approving a `kind: "album"` recommendation with a release-group ID routes to targets with the `addAlbum` capability: it adds the artist **unmonitored** (no whole-discography grab, and reuses the artist if already tracked), then monitors and searches only the approved album. `monitorOption` / `selectedAlbumIds` are ignored for album recs since the album is resolved from `recommendedReleaseGroupId`
- Legacy album rows without a release-group ID fall back to artist approval. Album dispatch does not perform the combined Lidarr-then-slskd sequence. Use `single_target` for individual albums, because combined-mode prerequisites can reject a request before dispatch.
- After validation, album approval calls every enabled `addAlbum` target, or the selected `targetId`. Explicit target selection currently requires `addArtist` too; an album-only target cannot be selected this way. With no album-capable target, the result is `add_failed` with empty `targetActions`. The no-target artist path instead returns `approved`.
- Automatic album approval uses artist-level monitoring, defaulting to all albums ([#761](https://github.com/iuliandita/digarr/issues/761)); the individual-approval guarantee does not apply.
- Rejected recommendations may include `reason`, `reasonText`, and `permanent`; `permanent: true` adds an album block for album recommendations with a release-group MBID, or an artist block for artist recommendations and legacy album rows without that identity

For PATCH rejections, reasons are `already_own`, `wrong_style`, `not_interested`, `tried_didnt_like`, `not_right_now`, and `other`. A permanent rejection cannot use `not_right_now`. Nonempty `reasonText` requires `reason: "other"`; input is limited to 400 characters, then control characters are stripped, whitespace is trimmed, and the result is limited to 200. Omit unused fields rather than sending null.

Invalid request shapes return JSON `{error, code: "validation_failed", details}`. Target selection and popularity failures return JSON `{error}` with an optional `no_source` or `no_match` code. Rejection refinement failures return `application/problem+json` with an `issues` array.

Approve response (status `approved`):
```json
{
  "status": "added_to_lidarr",
  "targetActions": {
    "lidarr-1": { "status": "added", "externalId": 42 },
    "lidarr-2": { "status": "failed", "error": "connection refused" }
  },
  "targetSummary": { "total": 2, "succeeded": 1, "failed": 1,
    "failures": [{ "id": "lidarr-2", "name": "Lidarr Backup", "error": "connection refused" }],
    "warnings": [] }
}
```
- Adds are **best-effort per target, not transactional**: a target that fails does not roll back targets that already succeeded (Digarr never deletes an artist from a target that took it).
- `targetActions` is the full merged map persisted on the rec; `targetSummary` describes only the targets attempted by *this* request, so clients can report partial outcomes at submit time. Its `warnings` array contains non-fatal target warnings.
- To retry just the failed targets, re-`PATCH` once per failed `targetId` (this preserves the successful targets' actions and will not regress the rec to `add_failed` if others already succeeded).

**POST /api/v1/recommendations/bulk** accepts 1-500 positive integer `ids` and `action: "approve" | "reject"`. Approval returns per-row results, for example `{ "results": [{ "id": 1, "status": "added_to_lidarr" }] }`, with status `added_to_lidarr`, `approved`, `add_failed`, or `not_found`; missing or unowned IDs return `not_found` entries. Rejection returns `{ "updated": 1 }` for owned rows.

Bulk rejection accepts a shared `reason` (including null) and `permanent`, which defaults to false. Unlike PATCH, it permits `permanent: true` with `reason: "not_right_now"` ([#786](https://github.com/iuliandita/digarr/issues/786)). It does not save free-text reasons: `reasonText` is not a bulk field and the handler passes null. With no shared reason or permanent block, the fast path updates status without rewriting existing reason fields.

Optional target/profile overrides apply to artist approval. An unknown `targetId` returns `400` with `{ "error": "Unknown targetId: <id>" }`; a selected target without artist approval support returns `400` with `{ "error": "Target does not support artist approval: <id>" }`. These are plain JSON errors, not problem-detail envelopes.

In v1.19.0, bulk approval uses the artist-add path even for album rows, requesting no album monitoring or search in Lidarr; approve albums individually with `PATCH /api/v1/recommendations/:id` to monitor and search only the selected album. This limitation is tracked in [#756](https://github.com/iuliandita/digarr/issues/756).

## Artist blocks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/artist-blocks` | Yes | List the caller's permanently blocked artists |
| POST | `/api/v1/artist-blocks` | Yes | Permanently block an artist for the caller |
| DELETE | `/api/v1/artist-blocks/:artistId` | Yes | Remove an artist from the caller's blocklist |

**GET /api/v1/artist-blocks** query params:
- `q` - optional artist-name search
- `limit` - integer, clamped to 1-200 (default 50). Non-integer values return `400`
- `cursor` - opaque cursor from `nextCursor`

List items contain `artistId`, `name`, nullable `mbid`, nullable `reason` and `reasonText`, and an ISO-8601 `blockedAt`. Creating or deleting a block returns `204` with no body.

Deleting an artist block removes only the permanent block. It does not clear a previous rejection or its cooldown, which defaults to 90 days from rejection. Unblocking therefore does not immediately make a recently rejected artist eligible for recommendations. The rejection cooldown is currently shared across accounts ([#788](https://github.com/iuliandita/digarr/issues/788)); permanent blocks are per-user. Quick Discover's direct seed bypasses these filters; see [Quick Discover](#pipeline) and [#795](https://github.com/iuliandita/digarr/issues/795).

**POST /api/v1/artist-blocks** body:
```json
{
  "artistId": 123,
  "reason": "wrong_style",
  "reasonText": null
}
```

For manual artist blocks, `artistId` must be a positive integer. `reason` accepts the rejection reasons above or null; `reasonText` is nullable and limited to 200 characters after control-character removal and trimming. The rejection-only restrictions on `other` and `not_right_now` do not apply to this endpoint.

## Album blocks

Album blocks are created when the caller permanently rejects an album recommendation. They
are keyed by MusicBrainz release-group MBID and are independent of artist blocks.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/album-blocks` | Yes | List up to 500 albums permanently blocked by the caller |
| DELETE | `/api/v1/album-blocks/:releaseGroupMbid` | Yes | Remove an album from the caller's blocklist |

**GET /api/v1/album-blocks** response:

```json
{
  "items": [
    {
      "id": 42,
      "artistId": 17,
      "artistName": "Example Artist",
      "artistMbid": "11111111-1111-1111-1111-111111111111",
      "releaseGroupMbid": "00000000-0000-0000-0000-000000000000",
      "reason": "wrong_style",
      "reasonText": null,
      "blockedAt": "2026-07-12T00:00:00.000Z"
    }
  ]
}
```

`:releaseGroupMbid` must be a UUID. Invalid values return `400`; a successful delete
returns `204` even when the row is already absent.

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

**GET /api/v1/preview/audio** is rate limited to 30 requests per minute. Query params:
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
| POST | `/api/v1/subscriptions/:id/run` | Yes | Await manual run, then return 202 |
| GET | `/api/v1/subscriptions/:id/runs` | Yes | Run history |
| POST | `/api/v1/subscriptions/import/spotify-liked-songs` | Yes | Create/reuse the helper Spotify Liked Songs subscription and trigger an import run (202) |
| POST | `/api/v1/subscriptions/import/spotify-playlist` | Yes | Import the embedded track page from a Spotify playlist (URL, URI, or bare ID). Returns 202; later pages are omitted. |
| POST | `/api/v1/subscriptions/import/csv` | Yes | Upload CSV of artist names (multipart form, field: `file`, max 1MB, 500 artists). Returns 202. |
| POST | `/api/v1/subscriptions/import/deezer-favorites` | Yes | Create/reuse Deezer Favorites subscription and trigger import (202) |
| POST | `/api/v1/subscriptions/import/deezer-followed` | Yes | Create/reuse Deezer Followed Artists subscription and trigger import (202) |
| GET | `/api/v1/subscriptions/import/deezer-playlists` | Yes | List user's Deezer playlists |
| POST | `/api/v1/subscriptions/import/deezer-playlists` | Yes | Import from a Deezer playlist (202) |
| GET | `/api/v1/subscriptions/adapter-types` | Yes | Available adapter types with config schemas |
| GET | `/api/v1/subscriptions/scheduler` | Yes | Scheduler job status, scoped to the calling user's own subscriptions |
| POST | `/api/v1/subscriptions/bulk-toggle` | Yes | Enable/disable all subscriptions |

Manual `POST /api/v1/subscriptions/:id/run` awaits library preparation and subscription execution before returning `202`; it is not a background acknowledgement like the import endpoints. The request can stay open through fetching, resolution, storage, and job completion. Some propagated source errors return `503` with `retryable: true`; other unhandled failures can return `500`. A request timeout does not establish whether the job stopped. Check `GET /api/v1/subscriptions/:id/runs` and Job History before retrying, and inspect the recorded outcome even after a `202`.

Spotify playlist imports and recurring `spotify-playlist` subscriptions read only the playlist response's embedded `tracks.items` page. They do not paginate or enforce `maxArtistsPerRun` through this adapter, so later artists may be omitted and the configured cap may be exceeded ([#779](https://github.com/iuliandita/digarr/issues/779)).

**Adapter types**: `genre`, `similar`, `discovery-mode`, `spotify-liked-songs`, `spotify-playlist`, `spotify-charts`, `deezer` (with `sourceConfig.feedType` of `favorites`, `followed`, `flow`, or `playlists`; `playlistIds` supplies comma-separated IDs for `playlists`), `lastfm-tag`, `lastfm-charts`, `listenbrainz`, `csv-import`

Deezer subscription token-resolution failures currently return an empty artist list instead of an authentication error; reconnect when expected artists disappear ([#774](https://github.com/iuliandita/digarr/issues/774)). Playlist feeds collect at most 500 distinct artists across the selected playlists.

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
- Creation and updates supplying `sourceConfig` re-check current availability and reject unavailable modes with `400`. Updates containing only fields such as `enabled`, `cron`, or `name` do not re-check availability
- The saved `providerContext` and `fallbackPolicy` mirror the execution path chosen for the manual form, so scheduled runs stay aligned with what the user configured

---

## Targets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/targets` | Yes | List targets with masked secrets. Admins see all targets; non-admins see only their own |
| POST | `/api/v1/targets` | Admin | Create target |
| PATCH | `/api/v1/targets/:id` | Admin | Update target |
| DELETE | `/api/v1/targets/:id` | Admin | Delete target |
| POST | `/api/v1/targets/:id/test` | Admin or owner | Test target connection |

Create and update accept an optional positive integer `userId` to assign the target to an existing user. Creation defaults to the calling admin. Admins can manage assigned targets; only the assigned user can use them for approvals. Create a separate target for each user who needs the same destination. Updating a config preserves omitted or masked secrets.

A linked `slskd` target requires an enabled Lidarr target assigned to the same user. To move a linked pair, clear `lidarrTargetId` first, reassign both targets, then restore the link. Active jobs for the previous owner stop instead of using the reassigned connections.

Example create body: `{"type":"lidarr","name":"Music","userId":2,"config":{"url":"http://lidarr:8686","apiKey":"<key>"}}`.

The target test uses the saved provider configuration for `plex-playlist`, `jellyfin-playlist`, `navidrome-playlist`, and `emby-playlist`. Plex playlist export fails before creation when no local tracks resolve or the server identity is missing.

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
- Linked target config requires `lidarrDownloadPath`, the completed downloads root visible to Lidarr. All queued files must succeed before `ManualImport`; partial, rejected, ambiguous, or unidentified files are refused. Imports use `move` and are verified through track `hasFile` values. Releases are capped at 500 files and 20 GiB, with a 2,048-character path limit; rejected manifests never enqueue downloads.
- Failed work reuses its work-key job after a one-hour cooldown and increments `attempts`. Historical duplicate failures are retained in terminal `superseded` state.

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

**POST /api/v1/playlists** returns the created row with `201`. Example:

```json
{
  "name": "Weekly discoveries",
  "strategy": "weekly_digest",
  "targetIds": [1, 2],
  "schedule": "0 9 * * 1",
  "enabled": true,
  "config": { "size": 25, "trackSourcePriority": ["spotify", "deezer"] }
}
```

Creation requires a trimmed, nonempty `name` (up to 200 characters) and a listed strategy. `targetIds` accepts up to 50 positive integer database IDs, not prefixed target strings; omission means no remote exports. `schedule` is a supported cron expression or null, defaulting to null. `enabled` defaults to true. `config` may include `genre` for `genre_focus` or `mood` for `mood_mix`.

When `config` is absent or null, generation defaults to size 25 and source priority `["spotify"]`, with MusicBrainz as the final MBID-based fallback. Spotify search requires that user's stored Spotify OAuth connection. Deezer search needs no account. A supplied config object is not merged with defaults: include both `size` and `trackSourcePriority` (`local`, `spotify`, or `deezer`). The API accepts arbitrary config keys and values without validating their contents. Partial objects or invalid source priorities can fail generation ([#764](https://github.com/iuliandita/digarr/issues/764)).

**PATCH /api/v1/playlists/:id** accepts optional versions of the same fields and rejects unknown top-level fields. Omitted fields remain unchanged; `config` replaces the whole object. Example:

```json
{
  "schedule": null,
  "enabled": false,
  "config": { "size": 10, "trackSourcePriority": ["deezer", "spotify"] }
}
```

Playlist PATCH and DELETE return `204` with no body.

Scheduled generation requires the global `preferences.playlistEnabled` setting, which defaults to false. This global switch is API-only in v1.19.0; there is no web UI control. An admin can enable it with `PATCH /api/v1/settings` and `{ "preferences": { "playlistEnabled": true } }`. Each playlist must also be enabled and have a schedule. Manual generation does not require the global switch.

`GET /api/v1/playlists/scheduler` returns `{ nextRun, cron, enabled }`. `enabled` is the global switch, not a per-playlist flag. `nextRun` is the earliest registered next run among the current user's playlists, or null. `cron` is the single distinct nonempty schedule across that user's saved playlists, or null when there are none or several; it can be present even when scheduling is disabled.

**POST /api/v1/playlists/:id/generate** returns `202` with `{ "status": "generating" }` before generation finishes.

Generated tracks are saved locally before exports to selected enabled playlist targets. Exports to selected enabled Navidrome, Jellyfin, Emby, Plex, and Spotify targets are all attempted; an export failure marks the job failed in Job History, while local tracks and successful remote exports remain. There is no remote rollback.

Regeneration replaces the local track list, but every export creates a new remote playlist rather than updating the previous one. Repeated scheduled runs can accumulate same-name copies ([#765](https://github.com/iuliandita/digarr/issues/765)).

**GET /api/v1/playlists/:id** adds `generation`, either `null` for legacy/no-history playlists or `{ jobId, status, startedAt, completedAt, resolution }` for the latest owned generation job.

`resolution` is `null` until its local result is recorded, and includes `requestedArtistCount`, `resolvedArtistCount`, `includedArtistCount`, `trackCount` and `outcomes` when available.

Each outcome has `artistName`, optional `artistMbid`, `status`, `resolvedTrackCount` and `includedTrackCount`. Outcome statuses are `resolved`, `unmatched`, `unavailable`, `error` and `limited`. A partially included artist remains `resolved` with both counts; `limited` means tracks resolved but none fit the playlist cap.

A failed target export can coexist with a saved local resolution summary. This projection does not expose raw job errors, secrets, other users' results, or remote read-back verification.

**Strategies**: `audition`, `weekly_digest`, `genre_focus`, `mood_mix`, `rediscover`

`audition` selects the playlist owner's pending recommendations in descending score order, deduplicates artists, and resolves one track per artist up to `config.size`. It does not approve recommendations and skips unresolved tracks instead of inventing placeholder titles. It uses the existing on-demand generation endpoint, schedule, and target selection.

Generation uses Spotify and Deezer lookups. The accepted `local` source priority currently has no media-library lookup wired into generation ([#767](https://github.com/iuliandita/digarr/issues/767)). Matching against a media server occurs separately during export.

MusicBrainz recordings provide a final MBID-based fallback, returning real titles and recording IDs without playable URIs or paths; M3U/XSPF export locations for these rows are MusicBrainz recording pages. Remote targets resolve tracks again.

Navidrome, Jellyfin, Emby, and Plex currently substitute their first search result when no exact artist/title match exists ([#758](https://github.com/iuliandita/digarr/issues/758)); local generation outcomes do not verify remote track identity.

---

## Mood discovery

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

Errors:
- `400` when no AI provider is configured
- `502` with `{ "error": "AI provider request failed (<provider>/<model>): <detail>" }` when the provider call fails; `<detail>` includes the upstream status and response body (e.g. an Ollama `model not found` -- pull the model or fix the model name in Settings, and use the Settings test button, which verifies the configured model exists)

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

## Analytics (admin)

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

## Library health (admin)

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
| POST | `/api/v1/library/overrides/bulk-ignore` | Admin | Atomically save ignore overrides for 1-200 unique artist identities (204) |
| POST | `/api/v1/library/album-overrides/bulk-ignore` | Admin | Atomically save ignore overrides for 1-200 unique album identities (204) |
| GET | `/api/v1/library/album-coverage/:artistMbid` | Yes | Owned/missing album counts for an artist, used by the recommendation card coverage badge |
| POST | `/api/v1/library/overrides` | Admin | Save a manual artist MBID override or an “ignore forever” decision |
| POST | `/api/v1/library/album-overrides` | Admin | Save a manual album release-group MBID override or an ignore decision |
| DELETE | `/api/v1/library/overrides/:source/:sourceArtistId` | Admin | Remove a saved manual artist override |
| POST | `/api/v1/library/reconcile` | Admin | Trigger a background reconcile pass after override changes |

**GET /api/v1/library/sources** response notes:
- `lastSyncCounts.albumsSynced` is present for album-capable sources after a successful sync
- Lidarr, Plex, and Jellyfin source rows now include artist sync counts plus the number of reconciled album rows written for that source snapshot
- `lastSyncCounts.unreconciledLookupFailed` counts artist rows left unresolved because their MusicBrainz lookup failed. It is optional and may be absent from historical stored count objects; consumers treat absence as zero
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
- A source album-fetch failure marks the source sync and its job failed and preserves the previous source snapshot. A single-source request returns `502`; for all-source or scheduled runs, inspect the source status and Job History. This differs from MusicBrainz reconciliation failures, which are counted within an otherwise completed sync.

**POST /api/v1/library/sync** body:
```json
{
  "source": "plex"
}
```

**GET /api/v1/library/unreconciled** response notes:
- Returns unreconciled rows from both the current user's sources and any global sources visible to that user
- Each row's `unreconciledReason` is `no_candidate` when MusicBrainz returned no safe match, `ambiguous` when multiple plausible matches remain, or `lookup_failed` when the lookup failed after retries. `null` remains possible for legacy or otherwise unclassified rows.

**POST /api/v1/library/overrides/bulk-ignore** body:
```json
{
  "items": [
    { "source": "plex", "sourceArtistId": "artist-123" }
  ]
}
```

**POST /api/v1/library/album-overrides/bulk-ignore** body:
```json
{
  "items": [
    { "source": "plex", "sourceAlbumId": "album-456" }
  ]
}
```

Bulk-ignore notes:
- `items` must contain 1-200 identities, and every `(source, sourceArtistId)` or `(source, sourceAlbumId)` pair must be unique. Empty, oversized, duplicate, incomplete, or extra-field payloads return `400` without writing overrides.
- A successful request stores every ignore override in one database transaction and returns `204 No Content`. If any write fails, the transaction rolls back instead of leaving a partially ignored selection.
- The operation does not trigger reconciliation. The web review removes the completed selection by refreshing the unreconciled lists and source summary after the `204` response.

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
- `unreconciledReason` uses the same `no_candidate`, `ambiguous`, and `lookup_failed` values as the artist route; `null` remains possible for legacy or otherwise unclassified rows.

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
| GET | `/api/v1/dashboard/genre-coverage` | Yes | Latest listening-artist genre coverage |
| GET | `/api/v1/dashboard/activity` | Yes | Recent activity feed |

`GET /api/v1/dashboard/genre-coverage` returns the latest completed pipeline
run's user-scoped coverage as `{ coveredArtists, pendingArtists, totalArtists }`,
or `null` before a run has recorded coverage. `pendingArtists` can overlap with
covered artists when a populated cache entry is due for refresh.

**GET /api/v1/dashboard/activity** query params:
- `limit` - integer, clamped to 1-20 (default 5). Non-integer values return `400`

---

## Listening

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/listening/top-artists` | Yes | Top artists by play count for a given period (ListenBrainz primary, Last.fm and mapped Plex fallback) |
| GET | `/api/v1/listening/recent-tracks` | Yes | Most recent scrobbles (Last.fm primary, ListenBrainz, Jellyfin, Emby and mapped Plex fallback) |

**GET /api/v1/listening/top-artists** query params:
- `range` - `this_week`, `this_month`, `this_year`, `all_time` (default `this_month`). Calendar-aligned ongoing periods, not rolling windows. Legacy `week`/`month`/`year` map to `this_week`/`this_month`/`this_year` for back-compat.
- `offset` - 0-10000 (default 0)
- `limit` - 1-50 (default 5)

Response: `{ tracks, total, offset, limit, source, status }`. `source` is `"listenbrainz"`, `"lastfm"`, `"plex"`, or `null`. Last.fm periods are rolling windows (`7day`, `1month`, `12month`, `overall`) and map approximately to the requested calendar range.

Last.fm converts the offset to `floor(offset / limit) + 1` and returns that whole provider page without slicing. The response still echoes the requested offset, so offsets 0 and 1 with limit 5 return the same page. Keep `limit` fixed and advance `offset` in multiples of `limit` when Last.fm is used ([#794](https://github.com/iuliandita/digarr/issues/794)).

**GET /api/v1/listening/recent-tracks** query params:
- `limit` - 1-50 (default 5)

Response: `{ tracks, hasSource, source, status }`. `hasSource` is `false` when no scrobble-capable source is connected (UI should hide the tile). `source` identifies the last successful source attempt, including an empty result.

Both listening endpoints return `status`: `not_configured` means no eligible source or application settings; `empty` means attempts succeeded but returned no entries; `error` means no entries were available and at least one attempted source failed; `ok` means entries were returned, including a successful fallback after another source failed. Existing fallback priorities are unchanged. Raw upstream errors are not returned. ListenBrainz artist-statistics HTTP 204 responses count as empty success.

---

## Jobs (admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/jobs` | Admin | Paginated job list |
| GET | `/api/v1/jobs/:id` | Admin | Single job detail |
| GET | `/api/v1/jobs/health` | Admin | System health summary (pipeline, subscriptions, playlists, library sync, sources) |

**GET /api/v1/jobs** query params:
- `type` - `pipeline`, `quick_discover`, `subscription`, `target`, `playlist`, `library_sync`
- `status` - `running`, `completed`, `failed`, `stuck`; see [stuck-job time limits](OPERATIONS.md#job-history-and-stuck-jobs)
- `limit` - 1-100 (default 50)
- `offset` - pagination offset (minimum 0)
- Invalid `type` or `status` values return `400`
- Cancelled jobs can appear in unfiltered results, but `status=cancelled` is not accepted in v1.19.0
- Missing job detail returns `404` with `application/json` body `{ "error": "Job not found" }`

Pipeline job `sourceResults` describe each source's discovery contribution. Configured listening sources without `similarArtists` report `{ "status": "skipped", "reason": "unsupported_capability" }`. Supported sources not queried because of an explicit discovery mode or an empty seed list use `explicit_run` or `no_seeds`; absent connections use `not_configured`. Successful similarity lookups use `ok` with an `artists` count, including zero. Any failed seed lookup uses `error` with the redacted upstream message, even when other seeds return candidates. Profile collection and library sync are separate operations. Existing job records retain their recorded outcomes.

Source health samples the 20 most recent pipeline/quick-discover runs with source results from the last 24 hours. In v1.19.0, `/api/v1/jobs/health` counts every non-`ok` source result, including `skipped`, toward its source failure rate. Normal skips such as `not_configured` or `unsupported_capability` can therefore produce a degraded/failing source summary and a degraded System Health card. Check the individual job's `sourceResults` in Job History before treating the summary as an upstream outage ([#769](https://github.com/iuliandita/digarr/issues/769)).

---

## Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/settings` | Yes | Get settings (partial secret masking; see notes) |
| PATCH | `/api/v1/settings` | Yes | Update settings (admin for global, any user for own connections) |
| POST | `/api/v1/settings/test/:service` | Admin, or own Plex connection | Test service connection |
| POST | `/api/v1/settings/test-webhook` | Admin | Send a synthetic notification to one channel |

**Testable services**: `lidarr`, `listenbrainz`, `lastfm`, `ai`, `plex`, `jellyfin`, `emby`, `subsonic`, `discogs`, `spotify`, `oidc`, `tidal`

Settings notes:
- Treat settings responses as sensitive. Listed top-level credentials and notification-channel secrets are masked, but global `preferences.fanartApiKey` is returned unchanged, including to non-admins. Legacy `preferences.webhookUrl` is returned unchanged to admins and stripped for non-admins. These exceptions are tracked in [#793](https://github.com/iuliandita/digarr/issues/793); do not publish settings responses as safe diagnostics.
- Plex listener mapping is per user: `plexAccountId` is a positive integer or `null` in PATCH. The server verifies the selected account and derives `plexAccountName` and `plexMachineIdentifier`; clients cannot supply those identity fields. GET returns the stored mapping. Changing the Plex URL or token without selecting an account clears the mapping.
- The Plex probe returns `accounts: [{id, name}]` and `machineIdentifier` alongside music-library `sections`. Non-admins may probe their own Plex connection, never shared admin credentials. Other service probes stay admin-only. Listening requests require an explicit mapped account and reject mismatched history rows; library sync does not require listener mapping. Plex top-artist analysis requires complete history for the requested period and fails if it exceeds 5,000 entries or 25 pages. Recent-track requests intentionally return only their requested sample. The probe accepts `accountId` (number or explicit `null`); omission uses the saved listener, while `null` tests library-only access.
- Non-admin users can update only their own connection fields; global setting changes return `403`
- Service probes require admin access when user-session auth is active, except for probing the current user's own Plex connection
- TIDAL client credentials and the TIDAL probe are global, admin-managed settings. TIDAL is *additionally* a per-user OAuth connection: each user authorizes their own account using the admin-registered app via `/api/v1/auth/oauth/tidal/initiate`
- `GET /api/v1/settings` returns `_tidalAppConfigured` (boolean), a read-only capability flag telling non-admins whether an admin has registered a TIDAL app, so the UI can enable the Connect button without exposing the credentials. Underscore-prefixed keys are derived flags, never stored settings, and are ignored on `PATCH`
- Successful service probes return `200` with a required `message` plus optional metadata:
  `{ "message": "Connected", "version": "1.2.3", "latencyMs": 42 }`
- Failed service probes return `application/problem+json`: `400` for missing or unknown input,
  `403` for non-admin callers, and `502` when the upstream service probe fails
- The `502` body's `detail` field carries the upstream failure message (secrets redacted,
  capped at 300 chars) so the caller can see e.g. which model name the provider rejected
- Send a JSON object for probes: `{}` uses saved credentials where supported; an absent payload currently returns `500`, not a validation response ([#759](https://github.com/iuliandita/digarr/issues/759)). Where supported, non-empty connection and credential strings override saved values. Empty strings (including URLs, API keys, tokens, usernames, passwords, provider, and model) fall back to saved values, so a successful probe may test the previous configuration rather than the empty values supplied. For Lidarr, `skipTlsVerify` does not fall back to the saved value and defaults to false: send `{ "skipTlsVerify": true }` explicitly when the saved connection needs it.
- Probe selectors have separate clearing rules: Plex `sectionId: ""` selects automatic library detection, and `accountId: null` tests library-only access. Jellyfin/Emby `libraryId: ""` selects all libraries. Omitted selectors reuse saved values; `sectionId: null` and `libraryId: null` also reuse saved values. These probe rules differ from saving null selectors through settings PATCH.
- The `plex` probe additionally returns the selected library and every music-type library on
  the server: `{ "sectionId": "5", "sections": [{ "key": "5", "title": "Music" }] }`. Save the
  chosen key as the per-user `plexSectionId` setting. Empty/null auto-detects the first
  music-type library for library sync only. Listening history and pipeline listening
  discovery require an explicit saved music-library section and mapped account.
- The `jellyfin` and `emby` probes likewise return the user's music libraries (and the
  selected one when configured): `{ "libraryId": "abc", "libraries": [{ "id": "abc", "name":
  "Music" }] }`. Save the chosen id as the per-user `jellyfinLibraryId` / `embyLibraryId`
  setting; empty/null means all music libraries (server-wide, the default). When set, top
  artists, favorites, recent listening, and library sync are scoped to that library

Notification channels:
- `GET /api/v1/settings` returns a `channels` array under `preferences`, and `PATCH` accepts the
  same. Each channel is one of four shapes, discriminated on `type`. Shared fields: `id` (opaque
  string, stable edit/remove key), `enabled` (boolean), `events` (subset of `["batch_complete",
  "digest"]`), and the admin-only `allowPrivateTarget` (boolean, optional).
  - `webhook` - `{ ..., url }` (Discord payloads are formatted automatically; other endpoints must accept Digarr JSON)
  - `ntfy` - `{ ..., server, topic, priority?, token? }` (`priority` 1-5)
  - `telegram` - `{ ..., botToken, chatId }` (plain-text messages)
  - `apprise` - `{ ..., endpoint, urls }` (`urls` newline-separated, fans out to 80+ services)
- Channel secrets (`telegram.botToken`, `ntfy.token`, `apprise.urls`) are returned masked as `***`;
  sending `***` back on `PATCH` preserves the stored value instead of overwriting it.
  Webhook URLs are partially masked so their destination remains recognizable; submitting the unchanged masked URL preserves the saved value. Encryption at rest requires `DIGARR_ENCRYPTION_KEY`.
- The `channels` array is stripped from `GET` responses for non-admins, and non-admin `PATCH` of it
  returns `403` (same rule as other global settings).
- `allowPrivateTarget: true` relaxes only RFC1918 ranges (`10/8`, `172.16/12`, `192.168/16`) for
  that one channel; cloud-metadata (`169.254.169.254`), link-local, and ULA stay blocked, and
  DNS-pinning plus `redirect: manual` stay on regardless.
- `POST /api/v1/settings/test-webhook` sends a synthetic `batch_complete` notification to a single
  channel and returns `204` on success. Post the channel config inline in the body (any secret
  left as `***` is restored from the stored channel), or `{ "id": "<channelId>" }` (or `?id=`) to
  test a stored channel; with no id it tests the first configured channel. Delivery failure returns
  `application/problem+json` `502` with the upstream message in `detail` (secret-redacted, capped
  at 300 chars); `400` when no channel is configured.

---

## Users (admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/users` | Admin | List all users |
| POST | `/api/v1/users` | Admin | Create user |
| PATCH | `/api/v1/users/:id` | Admin | Update user (admin status) |
| DELETE | `/api/v1/users/:id` | Admin | Delete user |

Admins can promote other users. First-user admin creation is serialized in the database. Deleting a user removes their recommendations, subscriptions, and other owned records; shared artists and batch history remain. Admins cannot delete themselves or remove the last admin.

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

## Admin (admin)

All `/api/v1/admin/*` endpoints require admin authentication.

### Backup & restore

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/admin/backup` | Admin | Download backup JSON. Query: `?includeCaches=true` |
| POST | `/api/v1/admin/restore` | Admin | Replace data from a backup. Requires `?confirm=true`; add `&force=true` only to proceed despite an encryption-key mismatch (affected credentials need re-entry). Accepts multipart form (field: `file`) or raw JSON body. |
| GET | `/api/v1/admin/backup/last` | Admin | Last auto-backup metadata. |

Backup files use a version-1 envelope. Current exports omit `data.oidcTokens`.
The v1.19.0 web restore dialog omits `confirm=true` and cannot restore a backup, including through its forced path ([#784](https://github.com/iuliandita/digarr/issues/784)). Use the authenticated endpoint above, with a complete destination backup and the matching encryption key.

Restore accepts an optional legacy `data.oidcTokens` array for compatibility:
an absent or empty array is silent, while nonempty rows are never restored and
add `Ignored 1 legacy OIDC token record.` or
`Ignored N legacy OIDC token records.` to `warnings`.

JSON backup boundaries in v1.19.0: default exports and startup auto-backups omit referenced artist rows. Use `?includeCaches=true` when recovering recommendations or artist blocks into an empty database. Even that export omits album blocks, library snapshots/overrides, health state, recording cache, and slskd jobs; no public `full=true` option exists. A complete disaster-recovery copy requires a consistent database backup. See [backup boundaries](guides/switching-backends.md#backup-boundaries-and-recovery).

Restore replaces included tables in one transaction. Clearing users also cascades deletion into omitted user-owned tables, including album blocks and library state. Omitted data is not guaranteed to survive ([#757](https://github.com/iuliandita/digarr/issues/757)). Take a complete destination backup first and prefer a fresh database.

### Upgrade

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/admin/migrations/pending` | Admin | Pending migration status. |

### Database migration

Copy the application restore registry from the current backend (PGlite or PostgreSQL) into a different one. The source is never modified.

Sessions, rate-limit counters, and pending OAuth transactions are excluded; sign in again and restart unfinished provider connections after cutover. See [migration scope](guides/switching-backends.md#what-is-not-copied).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/admin/migrate-backend/test` | Admin | Validate target reachability. Non-destructive (for PGlite it only checks path containment, no file is created). Body: `{ backend: 'pglite', path }` or `{ backend: 'postgres', ... }`. Returns `{ ok, backend, description }`, or `502 { ok: false, code, error }` on failure. |
| POST | `/api/v1/admin/migrate-backend` | Admin | Copy data. Body: `{ target, overwrite? }`. Success returns `MigrationReport`; errors use the problem envelope described below. |

A successful copy returns `200` with `MigrationReport`: `{ ok, verified, contentVerified, tablesMigrated, mismatches, targetEnvHint, ... }`. Errors use `application/problem+json` with `{ type, title, status, code, ... }`:

| Status | Code | Meaning |
|--------|------|---------|
| 422 | `migration_verify_failed` | Verification failed; the full report is in the `report` extension. |
| 409 | `pipeline_running` | A pipeline is running. |
| 409 | `migration_in_progress` | Another migration is running. |
| 409 | `target_not_empty` | The target has users and `overwrite` is false. Other destination data is not protected when no users exist ([#775](https://github.com/iuliandita/digarr/issues/775)). |
| 409 | `same_database` | Source and target identify the same database. |

The same-process copy preserves encrypted values and has no source/target key-mismatch check. Retain the running encryption key when restarting on the new backend.


### Data hygiene

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/admin/hygiene/clear-image-failures` | Admin | Reset image failure cache. Query: `?olderThan=7d` |
| POST | `/api/v1/admin/hygiene/rebuild-genres` | Admin | Rebuild genre table from artist data. |
| POST | `/api/v1/admin/hygiene/rescore` | Admin | Re-score the current user's recommendations using saved component evidence and current weights. Incompatible legacy rows and concurrently changed rows are skipped. Query: `?status=pending` (default), `?status=pending,approved` |
| POST | `/api/v1/admin/hygiene/dedupe` | Admin | Find and remove duplicate recommendations. |
| POST | `/api/v1/admin/hygiene/ai-audit` | Admin | Audit AI reasoning. Query: `?autoFix=true`. Returns 202 when auto-fix starts. |
| GET | `/api/v1/admin/hygiene/ai-audit/results` | Admin | Poll auto-fix progress. |
| POST | `/api/v1/admin/hygiene/purge-sessions` | Admin | Delete expired login sessions. |

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Liveness check. On success returns `{ status: 'ok', version, gitSha, channel, dbBackend }`; `503 { status: 'draining' }` while shutting down, or `503 { status: 'error', db: 'unavailable' }` when the DB check fails. |
