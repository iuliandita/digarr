# API Reference

This reference covers v2.0.1; consult the [changelog](../CHANGELOG.md) for release changes. Unversioned `/api/*` routes have been removed; use `/api/v1/*`.

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

Locale fallback is route-specific. Pipeline run and Quick Discover use `X-Digarr-Locale`, then the saved user locale, `Accept-Language`, and English. Auth messages, settings probes, and the Spotify Liked Songs import use the request header, then `Accept-Language` and English; these paths do not consult the saved locale. API clients should send `X-Digarr-Locale` explicitly for predictable messages on locale-aware routes.

Admin-only endpoints return 403 for non-admin users, as `application/problem+json` on most routes and as plain `{ "error": "..." }` on a few older ones. CSRF rejection also returns `403`, with `application/problem+json` and type `/problems/csrf-validation-failed`, before the route handler runs, code `errors.csrf.originMismatch`, and a `detail` telling you to check that the browsed address matches `ALLOWED_ORIGIN`, before the route handler runs.

Error bodies use three shapes. Newer routes return `application/problem+json` (`type`, `title`, `status`, optional `detail`). Request-body validation failures return `{ "error": "...", "code": "validation_failed", "details": [...] }` with `400`. Older routes return plain `{ "error": "..." }`. Clients should read `error` or `detail`/`title` rather than assume one shape. Status codes are not uniform across routes: for example, a missing settings row returns `404` from `GET /api/v1/settings` and `400` from the pipeline routes, an oversized CSV upload returns `413`, and unmet setup state returns `409` from setup routes or `403` with `redirect: "/setup"` from the setup guard.

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
- `GET /api/v1/listening/top-artists` returns `{ "tracks": [], "total": 0, "offset": 0, "limit": 5, "source": null, "status": "not_configured" }`; Last.fm honors arbitrary offsets in v2.0.0 as described under [Listening](#listening).

---

## API metadata

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/docs` | No | Minimal HTML entry point for API documentation |
| GET | `/api/v1/docs/openapi.json` | No | OpenAPI 3.1 document with shared schemas plus selected stable route groups |

The OpenAPI document is partial: it describes 19 of the 155 route operations listed in this reference (it declares so in `info.description`) and marks admin operations with "Admin only". Treat this Markdown reference as the complete route inventory; `bun run check:api-docs` verifies it against the server's route declarations and its Auth column against detectable admin guards.

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
- User objects from login, registration, `GET /api/v1/auth/me`, and
  `/api/v1/users` never include stored connection values (`listenbrainzToken`,
  `lastfmApiKey`, `plexToken`, `jellyfinApiKey`, `embyApiKey`, `discogsToken`,
  `subsonicPassword`). Each is replaced by a boolean such as `hasPlexToken`.
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
- Preference values are checked with the same types and ranges as `preferences` in `PATCH /api/v1/settings`; an invalid value, such as a non-integer `rejectionCooldownDays`, returns `400` without saving anything
- `GET /api/v1/auth/status` returns `required: true` as soon as setup is complete, even if no users exist yet, so the frontend can force registration/login instead of treating the app as public

In v2.0.0, the Recommendations settings page saves user preferences for every user and writes shared AudioDB/Wikidata settings only for admins. Personal preferences and recommendations are refreshed after the user write succeeds. If an admin's later global write fails, the notice explicitly reports that personal preferences saved; it does not imply rollback. Shared metadata controls are admin-only; personal fanart and metadata-fallback controls remain available to everyone. Server permissions are unchanged. v1.19.0 unconditionally attempts the global write, so non-admins see a false save failure and stale cached values ([#792](https://github.com/iuliandita/digarr/issues/792)). Verify saved values with `GET /api/v1/auth/me/preferences`, or use the per-user `PATCH` directly.

In v2.0.0, `PATCH /api/v1/auth/me/preferences` accepts `{"netNewAlbumDiscovery":true}` or `{"netNewAlbumDiscovery":false}`, and the saved boolean is returned by a fresh preferences GET. Omission preserves the saved value; other value types return `400` before writing. Admins may also set `preferences.netNewAlbumDiscovery` through `PATCH /api/v1/settings`. The default remains off, and existing per-user/global fallback rules are unchanged. v1.19.0 silently ignores the per-user key and rejects it in global preferences ([#791](https://github.com/iuliandita/digarr/issues/791)); use Release Radar or Library Gap-Fill until upgrading.

Preference updates merge top-level keys only. A supplied `scoringWeights` object replaces the saved object; omitted weights fall back to defaults rather than retaining saved values. Send the complete intended `scoringWeights` object when changing weights.

### OIDC / OAuth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/auth/oidc/login` | No | Redirect to OIDC provider. Requires `ALLOWED_ORIGIN` env var. Sets a browser-bound, one-time, 10-min `HttpOnly` transaction cookie. Rate limited: 10/min |
| POST | `/api/v1/auth/oidc/link` | Cookie session | Start account linking after current-password verification. Returns `{ url }`. Requires CSRF protection and an unlinked local account. Rate limited: 5/min |
| GET | `/api/v1/auth/oidc/callback` | Transaction-bound | OIDC callback; consumes the browser-bound transaction once. Login creates the user if needed and sets a session cookie. Linking also requires the initiating session and updates only its account's OIDC issuer and subject. Not rate limited |
| POST | `/api/v1/auth/oauth/:provider/initiate` | Yes | Start OAuth flow (`spotify`, `deezer`, `tidal`). Sets a browser-bound, 10-min `HttpOnly` transaction cookie scoped to the provider's callback path. Rate limited: 5/min |
| GET | `/api/v1/auth/oauth/:provider/callback` | No | OAuth callback; requires the transaction cookie from initiate. The pending authorization is consumed on read, so a `state` works exactly once. Not rate limited |
| GET | `/api/v1/auth/oauth/:provider/status` | Yes | Check OAuth connection status |
| DELETE | `/api/v1/auth/oauth/:provider` | Yes | Disconnect OAuth provider |

In v2.0.0, login and linking use the exact validated `iss`/`sub` pair. Legacy
issuer-less bindings require [operator recovery](AUTHENTICATION.md#recovering-legacy-oidc-bindings);
they are not matched by subject or email. A different issuer with the same
subject is a separate identity. Request bodies and callback URLs are unchanged.

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
| POST | `/api/v1/setup/complete` | Conditional | Complete initial setup; requested Lidarr/Emby services require an authenticated owner |

Setup validation rules:
- AI is optional: omit both `aiProvider` and `aiModel`, or send them together; one without the other returns `400`. Setup without an AI provider requires a signed-in user (`401` otherwise), and discovery then relies on the listening sources connected later
- Lidarr is optional, but `lidarrUrl` and `lidarrApiKey` must be provided together when used
- In v2.0.0, Emby is optional, but any nonblank `embyUrl`, `embyApiKey`, or `embyUserId` requires the complete trio. Incomplete Lidarr/Emby groups return `400` before persistence.
- Requested Lidarr/Emby services require an authenticated owner who still exists; otherwise setup returns `401` without saving configuration. The browser creates or signs into an account before opening the wizard. Public AI-only API bootstrap remains available only while the existing authentication guard permits it.
- In v2.0.0, global setup settings, the requested Emby connection, and requested Lidarr/Emby targets commit in one database transaction. `204` means all requested writes succeeded. A persistence failure returns generic `500` problem details with `code: setup.failed`, rolls back the writes, and leaves setup retryable. Completion is rechecked under a settings-row lock; concurrent/repeated completion returns `409` rather than creating duplicate targets. External service reachability is not verified by this commit.
- v1.19.0 can discard incomplete Emby fields and return `204` despite failed connection/target writes; register and sign in first, then verify saved connections and targets ([#783](https://github.com/iuliandita/digarr/issues/783)). Environment-based bootstrap is unchanged by this fix.
- Completing setup does not create a user account. API clients using AI-only bootstrap before registration must still register or sign in before accessing protected routes.

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
| POST | `/api/v1/pipeline/cancel` | Yes | Request cancellation of the caller's in-flight run (any run for admins) and drop the caller's queued run. Returns 202 with `{ cancelled, message }`; `cancelled` is false when idle or already finishing. Returns 403 when another user's run is in progress and the caller has nothing queued. |
| GET | `/api/v1/pipeline/status` | Yes | Current pipeline status (running, stage, last run, `queueLength`, caller `queuePosition`). Admins see the global run, queue, and last batch. Other users see only their own run (`running`, `stage`, `message`), a `queueLength` of 0 or 1 for their own queue entry, and no `lastRun` |
| GET | `/api/v1/pipeline/events` | Yes | SSE stream of the caller's pipeline progress events; other users' runs are not sent |
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

`POST /api/v1/pipeline/cancel` stops the in-flight run only for the user who started it or an admin, and removes only the caller's queued run; other users' queued runs keep their place. In v2.0.0, `cancelled: true` accepts a cooperative stop request; it does not report that the worker has stopped. Storage checks between complete artist/recommendation units, and automatic approval checks before new recommendations and targets. An operation already in flight finishes and records its actual result before stopping. Saved recommendations and remote additions remain; cancellation does not roll them back. An actual target or database failure remains a failure even when cancellation was requested. Interrupted storage marks its batch failed, while the pipeline job records cancellation after cleanup succeeds.

The running flag stays true until active work and awaited batch/job bookkeeping settle. A terminal `cancelled` or `complete` progress event follows that settlement. Cleanup failures surface as errors, preserving the original failure, rather than claiming successful cancellation ([#790](https://github.com/iuliandita/digarr/issues/790), [#850](https://github.com/iuliandita/digarr/issues/850)). There is no forced unlock after 15 seconds. A hung operation keeps the pipeline busy until it settles or the process is deliberately restarted; inspect retained recommendations and target outcomes before retrying.

After the run commits to final success bookkeeping, cancellation is too late: the response is `202` with `cancelled: false` and message `Pipeline finishing`, while `running` remains true until finalization settles. An idle request returns `cancelled: false` with `No pipeline run in progress`. The browser resets the Stop button when cancellation is declined. The queue is cleared in all cases.

v1.19.0 checks cancellation only before storage and can continue storage or target additions after its 15-second backstop clears the indicator. Do not use that indicator as evidence that writes stopped. On every version, follow the [migration prerequisites](guides/switching-backends.md#prerequisites): pipeline settlement does not prove that every background job or other writer is idle.

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

In v2.0.0, Quick Discover treats the submitted artist as an explicit add-to-queue request: it resolves the seed through MusicBrainz and retains its score of `1.0`. Before storage, both the seed and similar results follow the same library, existing-recommendation, permanent-block, owner-scoped rejection-cooldown, and score-threshold checks. The seed can remain pending even when no similar artists are found; a newly saved seed is excluded from the later similar results.

Job `artistsStored` counts successful recommendation writes from both completed storage batches, including a seed-only result; failed per-artist writes do not inflate it. `artistsDiscovered` continues to count similar-provider candidates, excluding the explicit seed. Fatal storage errors or unavailable completed-batch statistics fail the job; completed writes are retained, so inspect Job History and the queue before retrying. Individual write failures remain recorded in the storage batch.

v1.19.0 bypasses the seed filters and excludes the seed from job stored counts ([#795](https://github.com/iuliandita/digarr/issues/795)). After upgrading, an excluded seed will no longer be added explicitly. Existing saved recommendations are unchanged; no schema migration is added. Rollback restores the bypass and old counts.

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

The parser coerces rather than rejects most fields:
- `modeId` is required; a missing or unknown mode returns `400` with `{ "error": "..." }`
- `settingsMode` other than `"advanced"` becomes `"easy"`
- `fallbackPolicy` other than `"strict"` becomes `"allow-fallback"`
- `rawUserSettings`, `normalizedSettings`, and `providerContext` that are not plain objects become `{}`
- an empty `normalizedSettings` falls back to `rawUserSettings`
- only the fields above are read; other keys (including `settings`) are ignored, so send `rawUserSettings` (and optionally `normalizedSettings`) for mode settings. A client that sends only `settings` runs the mode with empty settings
- a mode that is currently unavailable returns `400` with its reason; a pipeline already running returns `409` problem+json

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

**GET /api/v1/recommendations/feedback-summary** returns `{ summary: [{ genre, approved, rejected, other, total, rate }] }` in v2.0.0, ordered by descending rate and limited to 20 genres with at least 3 acted-on recommendations each. `total` counts recommendations with an action timestamp. `approved` counts current `approved` and `added_to_lidarr` statuses; `rejected` counts only current `rejected` rows, including those without a reason. `other` counts the remaining acted-on rows, such as failed approvals and recommendations restored to pending. Thus `approved + rejected + other = total`. `rate` remains `approved / total`, including those other outcomes in the denominator, so it is not a pure like/dislike ratio. Recommendation scoring is unchanged.

v1.19.0 has no `other` field and labels every non-approved acted-on row as `rejected` ([#789](https://github.com/iuliandita/digarr/issues/789)). API consumers upgrading to v2.0.0 must use `other` when reconciling totals instead of assuming `approved + rejected = total`. There is no schema migration or stored-row rewrite; rollback restores the old response calculation.

**GET /api/v1/recommendations** query params:
- `status` - `pending`, `approved`, `rejected`, `added_to_lidarr`, `add_failed`, `duplicate`, `queued` (comma-separated)
- `kind` - `artist` or `album`; omitted or unrecognized values return both. Backs the Discover kind filter (Albums is `?kind=album`)
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
- Automatic album approval uses `addAlbum` with the stored release-group ID; the automatic monitoring setting applies only to artist recommendations. Missing release identities or configured acquisition targets without a working album method fail without artist acquisition. With no acquisition targets, valid albums are marked `approved` for discovery-only use. Album target IDs stay in `targetActions`; successful slskd queueing does not claim a completed Lidarr import.
- Rejected recommendations may include `reason`, `reasonText`, and `permanent`; `permanent: true` adds an album block for album recommendations with a release-group MBID, or an artist block for artist recommendations and legacy album rows without that identity. A rejection responds with `{"status": "rejected", "blockCreated": boolean}`; `blockCreated` is `true` only when this request created the block, so a client undo can leave a block that already existed

For PATCH rejections, reasons are `already_own`, `wrong_style`, `not_interested`, `tried_didnt_like`, `not_right_now`, and `other`. A permanent rejection cannot use `not_right_now`. Nonempty `reasonText` requires `reason: "other"`; input is limited to 400 characters, then control characters are stripped, whitespace is trimmed, and the result is limited to 200. Omit unused fields rather than sending null.

Invalid request shapes return JSON `{error, code: "validation_failed", details}`. Target selection and popularity failures return JSON `{error}` with an optional `no_source` or `no_match` code. PATCH rejection refinement failures return `application/problem+json` with an `issues` array.

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

Bulk rejection accepts a shared `reason` (including null or omission) and `permanent`, which defaults to false. In v2.0.0, `action: "reject"` with `permanent: true` and `reason: "not_right_now"` returns `400` before any updates, matching PATCH's compatibility rule. The bulk error is JSON `{error, code: "validation_failed", details}` with a `permanent` field issue. v1.19.0 accepts that incompatible combination ([#786](https://github.com/iuliandita/digarr/issues/786)). A null or omitted reason remains valid with either permanent value; `not_right_now` remains valid with `permanent: false`. Reject-only compatibility rules do not apply to bulk approval.

Bulk rejection does not save free-text reasons: `reasonText` is not a bulk field and the handler passes null. With no shared reason or permanent block, the fast path updates status without rewriting existing reason fields.

Optional target/profile overrides apply to approval. An unknown `targetId` returns `400` with `{ "error": "Unknown targetId: <id>" }`; a selected target without either artist or album approval support returns `400` with `{ "error": "Target does not support recommendation approval: <id>" }`. These are plain JSON errors, not problem-detail envelopes.

Bulk approval dispatches each owned recommendation by kind. Album rows use `addAlbum` targets and their release-group MBID, monitoring and searching only that release in Lidarr. An album without a release-group identity or a compatible target returns `add_failed` without artist acquisition. Artist rows retain artist approval behavior. Mixed batches return each row's outcome independently. Successful Lidarr album additions return `added_to_lidarr`; a successful non-Lidarr target, including a queued slskd acquisition, returns `approved` and keeps its outcome in `targetActions`. A queued download does not establish import completion. This corrects the v1.19.0 limitation in [#756](https://github.com/iuliandita/digarr/issues/756).

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

Deleting an artist block removes only the permanent block. It does not clear a previous rejection or its cooldown, which defaults to 90 days from rejection. Unblocking therefore does not immediately make a recently rejected artist eligible for recommendations. In v2.0.0, scans, subscriptions, and Quick Discover seeds and similar results use only the run owner's rejected recommendations for cooldowns. Another account's rejections and legacy rejections without an owner do not suppress an account's results. Legacy subscriptions without an owner consult only unowned rejections. The receiving run's configured cooldown window is unchanged. v1.19.0 shares rejection cooldowns across accounts ([#788](https://github.com/iuliandita/digarr/issues/788)); permanent blocks remain per-user. In v2.0.0, Quick Discover also applies these filters to its direct seed; see [Quick Discover](#pipeline) and [#795](https://github.com/iuliandita/digarr/issues/795).

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
      "albumTitle": "Example Album",
      "reason": "wrong_style",
      "reasonText": null,
      "blockedAt": "2026-07-12T00:00:00.000Z"
    }
  ]
}
```

`albumTitle` is the album title stored when the block was created; blocks created before the field was added have `null`.

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

**PATCH /api/v1/subscriptions/:id** accepts only these optional fields: `name`, `enabled`, `sourceConfig`, `maxArtistsPerRun`, `listenerRange`, `cron`, `scoreThreshold` (0 to 1), `scoringWeightPreset`, and `scoringWeightOverrides`. The body is strict: any other key, including `sourceType`, `sourceProvider`, `action`, and a `null` `scoreThreshold`, returns `400` validation failure, so send only the fields you are changing. Success returns `204`; a subscription that does not exist or belongs to another user returns `404` problem+json. Changing `enabled` or `cron` reschedules the job.

In v2.0.0, `GET /api/v1/albums/:mbid` retains the broad Album/EP/Single catalog and adds optional `secondaryTypes` metadata when MusicBrainz provides a valid string array. This list is not restricted to studio albums; the coverage-only rule below does not change album picking, Release Radar or release matching.

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
| POST | `/api/v1/subscriptions/import/spotify-playlist` | Yes | Create/reuse a Spotify playlist import subscription (URL, URI, or bare ID). Returns 202; inspect run history for the outcome. |
| POST | `/api/v1/subscriptions/import/csv` | Yes | Upload CSV of artist names (multipart form, field: `file`, max 1MB, 500 artists). Returns 202. |
| POST | `/api/v1/subscriptions/import/deezer-favorites` | Yes | Create/reuse Deezer Favorites subscription and trigger import (202) |
| POST | `/api/v1/subscriptions/import/deezer-followed` | Yes | Create/reuse Deezer Followed Artists subscription and trigger import (202) |
| GET | `/api/v1/subscriptions/import/deezer-playlists` | Yes | List user's Deezer playlists |
| POST | `/api/v1/subscriptions/import/deezer-playlists` | Yes | Import from a Deezer playlist (202) |
| GET | `/api/v1/subscriptions/adapter-types` | Yes | Available adapter types with config schemas |
| GET | `/api/v1/subscriptions/scheduler` | Yes | Scheduler job status, scoped to the calling user's own subscriptions |
| POST | `/api/v1/subscriptions/bulk-toggle` | Yes | Enable/disable all subscriptions |

Manual `POST /api/v1/subscriptions/:id/run` awaits library preparation and subscription execution before returning `202`; it is not a background acknowledgement like the import endpoints. The request can stay open through fetching, resolution, storage, and job completion. Some propagated source errors return `503` with `retryable: true`; other unhandled failures can return `500`. A request timeout does not establish whether the job stopped. Check `GET /api/v1/subscriptions/:id/runs` and Job History before retrying, and inspect the recorded outcome even after a `202`.

In v2.0.0, Spotify playlist imports and recurring `spotify-playlist` subscriptions read the current [`/playlists/{id}/items` endpoint](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items) in playlist order until `maxArtistsPerRun` distinct artist names are collected or the playlist ends. Names are deduplicated case-insensitively across pages, including collaborations. Local files contribute usable artist names; missing local artist metadata is skipped. New import subscriptions retain their 100-artist cap; ordinary subscriptions retain their 20-artist default, and reused subscriptions keep their saved cap. Requests use 50 items per page with a 20-page/1,000-item safety bound. If that bound is reached before the cap or playlist end, a later page fails, or pagination/data is invalid, the run fails without resolving/storing the accumulated partial artists. Successful empty playlists remain successful. Pagination links are validated and rebuilt for the same playlist, and redirects are refused. These requests use the subscription owner's token; Spotify restricts this endpoint to playlists they own or collaborate on (`403` otherwise). Pagination is not a snapshot: playlist edits between requests can change the observed items. v1.19.0 reads only the embedded first page and ignores this cap ([#779](https://github.com/iuliandita/digarr/issues/779)).

**Adapter types**: `genre`, `similar`, `discovery-mode`, `spotify-liked-songs`, `spotify-playlist`, `spotify-charts`, `deezer` (with `sourceConfig.feedType` of `favorites`, `followed`, `flow`, or `playlists`; `playlistIds` supplies comma-separated IDs for `playlists`), `lastfm-tag`, `lastfm-charts`, `listenbrainz`, `csv-import`

Deezer subscription token-resolution failures and provider error envelopes fail the run instead of completing with zero artists. Disconnected subscriptions still record a failed attempt for their owner. Manual-run failures return `503` with `service: "deezer"`, `retryable: true` and check/reconnect guidance; this is a source failure, not an application-session `401`. Inspect the saved subscription `lastError` and Job History, then reconnect Deezer in Settings when needed before retrying. Successful empty feeds still complete with zero results and clear the previous error. Playlist feeds retain the 500-distinct-artist cap ([#774](https://github.com/iuliandita/digarr/issues/774)).

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
| GET | `/api/v1/playlists/:id/exports` | Yes | Owned remote export bindings |
| POST | `/api/v1/playlists/:id/exports/:targetId/reset` | Yes | Explicitly forget one local export binding |
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

When `config` is absent or null, generation defaults to size 25 and source priority `["spotify"]`, with MusicBrainz as the final MBID-based fallback. Supplied objects also receive those defaults for omitted fields. `size` must be a positive integer; `trackSourcePriority` is an array of `local`, `spotify`, or `deezer`, including an empty array for MusicBrainz-only fallback. Optional `genre` and `mood` are strings. Unknown config keys and invalid values return `400` before saving. Spotify search requires that user's stored Spotify OAuth connection; Deezer search needs no account. Existing partial saved configs receive the same defaults during generation; invalid saved configs fail generation before replacing local tracks or exporting.

**PATCH /api/v1/playlists/:id** accepts optional versions of the same fields and rejects unknown top-level fields. Omitted fields remain unchanged; a supplied `config` object replaces the whole object and fills omitted fields with defaults, while `config: null` resets it to runtime defaults. Example:

```json
{
  "schedule": null,
  "enabled": false,
  "config": { "size": 10, "trackSourcePriority": ["deezer", "spotify"] }
}
```

Playlist PATCH and DELETE return `204` with no body.

Scheduled generation requires the global `preferences.playlistEnabled` setting, which defaults to false. Admins can turn it on with the Scheduled generation switch on the Playlists page, or with `PATCH /api/v1/settings` and `{ "preferences": { "playlistEnabled": true } }`. Each playlist must also be enabled and have a schedule. Manual generation does not require the global switch.

`GET /api/v1/playlists/scheduler` returns `{ nextRun, cron, enabled }`. `enabled` is the global switch, not a per-playlist flag. `nextRun` is the earliest registered next run among the current user's playlists, or null. `cron` is the single distinct nonempty schedule across that user's saved playlists, or null when there are none or several; it can be present even when scheduling is disabled.

**POST /api/v1/playlists/:id/generate** returns `202` with `{ "status": "generating" }` before generation finishes.

Generated tracks are saved locally before exports to selected enabled playlist targets. Exports to selected enabled Navidrome, Jellyfin, Emby, Plex, and Spotify targets are all attempted; an export failure marks the job failed in Job History, while local tracks and successful remote exports remain. There is no remote rollback.

Saved playlist generation retains a binding per playlist and target. Its first export creates a remote playlist and checkpoints its ID; subsequent manual and scheduled runs replace tracks in that same playlist. This applies to Navidrome, Jellyfin, Emby, Plex, and Spotify. Existing remote playlists from older versions are not adopted by name: the first run after upgrading creates one new binding. Renaming refreshes the remote name on Spotify and Navidrome; Jellyfin, Emby, and Plex keep the existing name.

Before remote writes, Digarr verifies the destination identity and resolves matching tracks. An empty generation or zero matches preserves the remote playlist and fails the export. Account/server changes, missing or inaccessible remote IDs, and uncertain creation fail without automatically creating another playlist. Replacement can leave partial remote contents after an upstream failure; retry replaces the same saved ID. One application process prevents overlapping generation and recovery for a playlist. Multiple replicas are unsupported for these operations.

**GET /api/v1/playlists/:id/exports** returns `{ exports: [{ targetId, remotePlaylistId, state, updatedAt }] }` for bindings whose playlist and target both belong to the caller. `state` is `creating`, `linked`, or `recovery_required`. Scope hashes and credentials are not returned.

**POST /api/v1/playlists/:id/exports/:targetId/reset** requires exactly `{ "acknowledgePossibleDuplicate": true }` and returns `204`. It forgets only the owned local binding; it does not remove the remote playlist. Inspect the destination and remove or retain the old playlist deliberately before resetting, because the next export can create another copy. Reset is API-only; there is no automatic adoption or remote deletion. Another playlist owner or a missing/transferred target returns `404`; an overlapping generation/recovery returns `409` with `code: "errors.playlist.busy"`.

**GET /api/v1/playlists/:id** adds `generation`, either `null` for legacy/no-history playlists or `{ jobId, status, startedAt, completedAt, resolution }` for the latest owned generation job.

`resolution` is `null` until its local result is recorded, and includes `requestedArtistCount`, `resolvedArtistCount`, `includedArtistCount`, `trackCount` and `outcomes` when available.

Each outcome has `artistName`, optional `artistMbid`, `status`, `resolvedTrackCount` and `includedTrackCount`. Outcome statuses are `resolved`, `unmatched`, `unavailable`, `error` and `limited`. A partially included artist remains `resolved` with both counts; `limited` means tracks resolved but none fit the playlist cap.

A failed target export can coexist with a saved local resolution summary. This projection does not expose raw job errors, secrets, other users' results, or remote read-back verification.

**Strategies**: `audition`, `weekly_digest`, `genre_focus`, `mood_mix`, `rediscover`

`audition` selects the playlist owner's pending recommendations in descending score order, deduplicates artists, and resolves one track per artist up to `config.size`. It does not approve recommendations and skips unresolved tracks instead of inventing placeholder titles. It uses the existing on-demand generation endpoint, schedule, and target selection.

`config.trackSourcePriority` orders local, Spotify, and Deezer lookups. The `local` entry tries the owner's saved Jellyfin, Emby, Subsonic/Navidrome, and Plex connections in that order, preserving the saved user/library or music-section scope. Each provider search is bounded to 25 candidates per artist. The first usable exact-artist match supplies tracks; empty/pathless/failed lookups continue to the next local connection, then the next configured catalog source. Results from different libraries are not combined for an artist. Local paths come from server file metadata and may be inaccessible to an exported playlist's player; audio is not copied and playback is not verified. Jellyfin, Emby, and Subsonic honor the saved operator TLS verification setting; their credentials come only from the playlist owner. Shared service credentials, export-target credentials, and other users' connections are not used. Ownerless playlists have no local or Spotify connection. API defaults remain Spotify only; web-created playlists explicitly prefer local, then Spotify, then Deezer. Matching against a media server occurs separately during export.

MusicBrainz recordings provide a final MBID-based fallback, returning real titles and recording IDs without playable URIs or paths; M3U/XSPF export locations for these rows are MusicBrainz recording pages. Remote targets resolve tracks again.

Navidrome, Jellyfin, Emby, and Plex require an exact title and credited artist after case and whitespace normalization. Unmatched items and missing titles are skipped. Their internal target results report `itemsAdded` and `itemsSkipped`; a nonzero skipped count marks the export job failed in Job History after all selected targets are attempted. Local generation outcomes remain separate from remote matching and do not verify playback. Partial remote playlists and local tracks are retained; there is no rollback. Saved playlist exports reject zero matches before mutation. Separate create-only recommendation exports keep their existing behavior: Navidrome, Jellyfin, and Emby may create an empty playlist when all items are skipped, while Plex fails without creating one.

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
- `502` with `{ "error": "AI provider request failed (<provider>/<model>): <detail>" }` when the provider call fails; `<detail>` includes the upstream status and response body (e.g. an Ollama `model not found` - pull the model or fix the model name in Settings, and use the Settings test button, which verifies the configured model exists)

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
| GET | `/api/v1/library/sources` | Yes | Per-source sync state for global + per-user library sources |
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

**Library health** notes:
- Lidarr reads fail when Lidarr is not configured, so a manual scan records that error instead of saving empty checks, and `GET /api/v1/library/stats` fails; scheduled scans are skipped while Lidarr is not configured
- When some per-artist album lookups fail, the scan saves its checks with `lastError` noting that missing-album counts are partial; when all fail, the scan fails, keeps the previous checks, and records `lastError`
- `POST /api/v1/library/health/:checkId/fix` uses the last persisted scan after a restart and returns 400 when no scan results exist for that check

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
- Album overrides persist in the separate `library_album_match_overrides` table keyed by `(userId, source, sourceAlbumId)`
- Corrections and ignores apply to that user's owned albums (album coverage and Gap-Fill) as soon as they are saved; the synced library rows, including shared Lidarr rows, keep the source match

**GET /api/v1/library/album-coverage/:artistMbid** notes:
- `artistMbid` must be a valid UUID
- Returns owned and missing album counts derived from the user's reconciled library snapshot
- In v2.0.0, counts eligible primary-type `Album` groups with an explicit empty secondary-type array across sequential MusicBrainz pages of up to 100 groups, with duplicate IDs counted once. The shared client retains its type filter and rate limiter. It reads at most 100 pages/10,000 returned groups; if completeness cannot be established within that bound, a required page fails, or pagination is invalid, it rejects the whole lookup instead of returning accumulated partial groups. Catalog edits between requests can change the results; this is not a snapshot. v1.19.0 reads only the first page ([#796](https://github.com/iuliandita/digarr/issues/796)).
- In v2.0.0, studio selection means primary type `Album` with an explicit empty `secondaryTypes` array. Any secondary type is excluded, including Live, Compilation, Soundtrack and Demo. This depends on MusicBrainz classification and does not prove how an album was recorded. Missing or malformed secondary-type metadata on an Album rejects coverage instead of treating unknown groups as studio albums; resolve the provider metadata/response and retry. Owned excluded groups affect neither count. v1.19.0 discards secondary types and counts every Album group ([#798](https://github.com/iuliandita/digarr/issues/798)). Counts may decrease after upgrade; existing recommendations remain unchanged. No migration is added; rollback restores broader coverage.
- In v2.0.0, Gap-Fill waits for all queued coverage lookups; any failure fails the manual or subscription job with the original error, without advancing any selected artist's rotation cursor or submitting partial candidates. The whole slice remains eligible for retry. Subscriptions save the error and retain their previous result count. Genuine empty coverage still succeeds and advances the cursor. A persistent lookup failure can hold the selected slice; resolve the provider error and retry. v1.19.0 instead swallows failures and marks all selected artists checked ([#797](https://github.com/iuliandita/digarr/issues/797)). This adds no schema migration or repair of existing cursor values; rollback restores swallowed failures.
- The shared pagination also applies to artist album lists, release matching, reconciliation and Release Radar. Large catalogs can take longer or fail when a later page is unavailable. No schema migration or stored-row rewrite is added; rollback restores first-page truncation.
- An artist MusicBrainz does not know (HTTP 404) returns `200` with no MusicBrainz album groups instead of `500`; other MusicBrainz failures still return an error ([#898](https://github.com/iuliandita/digarr/issues/898))
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

In v2.0.0, Last.fm returns the requested offset window by slicing its provider page and, when needed, reading the next page with the same limit. Each attempt reads at most two pages and preserves the first response's provider-reported `total`. If either required read fails, the existing Plex fallback or source-error status applies without returning a partial Last.fm window. Results can change between provider requests; this is not a snapshot.

v1.19.0 returns whole Last.fm pages, so offsets 0 and 1 with limit 5 repeat the same results ([#794](https://github.com/iuliandita/digarr/issues/794)). Older clients must keep `limit` fixed and advance `offset` in multiples of `limit`; that workaround remains compatible in v2.0.0. No schema migration is added; rollback restores the old page behavior.

**GET /api/v1/listening/recent-tracks** query params:
- `limit` - 1-50 (default 5)

Response: `{ tracks, hasSource, source, status }`. `hasSource` is `false` when no scrobble-capable source is connected (UI should hide the tile). `source` identifies the last successful source attempt, including an empty result.

Both listening endpoints return `status`: `not_configured` means no eligible source or application settings; `empty` means attempts succeeded but returned no entries; `error` means no entries were available and at least one attempted source failed; `ok` means entries were returned, including a successful fallback after another source failed. Existing fallback priorities are unchanged. Raw upstream errors are not returned. ListenBrainz artist-statistics HTTP 204 responses count as empty success.

Plex accepts artist and track IDs from bare rating keys or canonical metadata paths. Entries missing usable IDs are skipped. A page with in-range tracks but no usable entries emits a count-only server warning; the response remains `empty` if no other source returns tracks. These dashboard requests do not create job records.

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
- Cancelled jobs can appear in unfiltered results, but `status=cancelled` is not accepted as a filter
- Missing job detail returns `404` with `application/json` body `{ "error": "Job not found" }`

Pipeline job `sourceResults` describe each source's discovery contribution. Configured listening sources without `similarArtists` report `{ "status": "skipped", "reason": "unsupported_capability" }`. Supported sources not queried because of an explicit discovery mode or an empty seed list use `explicit_run` or `no_seeds`; absent connections use `not_configured`. Successful similarity lookups use `ok` with an `artists` count, including zero. Any failed seed lookup uses `error` with the redacted upstream message, even when other seeds return candidates. Profile collection and library sync are separate operations. Existing job records retain their recorded outcomes.

Source health samples the 20 most recent pipeline/quick-discover runs with source results from the last 24 hours. Within that sample, `/api/v1/jobs/health` counts only `ok` and `error` attempts for each source; successful zero-artist lookups count as `ok`. Skips do not count as successes or errors, and sources with no attempts are omitted from `sources`. Zero errors yields `ok`, an error rate below 50% yields `degraded`, and 50% or more yields `failing`. Skipped runs still occupy the sample; the query does not pull in older attempts to replace them. Individual job records retain their skip reasons. v1.19.0 counts skips as failures; this is corrected in v2.0.0 ([#769](https://github.com/iuliandita/digarr/issues/769)).

---

## Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/settings` | Yes | Get settings (partial secret masking; see notes) |
| PATCH | `/api/v1/settings` | Yes | Update settings (admin for global, any user for own connections) |
| GET | `/api/v1/settings/plex/sections` | Yes | List music libraries using the current user's saved Plex connection |
| POST | `/api/v1/settings/test/:service` | Admin, or own Plex connection | Test service connection |
| POST | `/api/v1/settings/test-webhook` | Admin | Send a synthetic notification to one channel |

**Testable services**: `lidarr`, `listenbrainz`, `lastfm`, `ai`, `plex`, `jellyfin`, `emby`, `subsonic`, `discogs`, `spotify`, `oidc`, `tidal`

Settings notes:
- `GET /api/v1/settings/plex/sections` returns `{ "sections": [{ "key": "3", "title": "Music" }] }` using only the current user's saved URL and token, including for non-admins. An unconfigured connection returns `{ "sections": [] }`; an upstream failure returns `502` problem+json with secret-redacted detail capped at 300 characters. It never changes the saved section or falls back to shared admin credentials.
- In v2.0.0, global `preferences.fanartApiKey` and legacy `preferences.webhookUrl` are masked as `***` when nonempty for admins and omitted for non-admins. This applies to GET and successful PATCH responses, including scheduler-warning responses; stored values are not modified by projection. Sending `***` for either scalar secret preserves the saved value (or leaves it absent), while a new value replaces it and an empty string clears it. API clients must treat the mask as a placeholder rather than a usable credential. Existing top-level and channel masking stays in place. v1.19.0 exposes global fanart values to non-admins and both scalar secrets to admins ([#793](https://github.com/iuliandita/digarr/issues/793)); review any previously shared responses for exposure. Settings responses still contain connection metadata and should be reviewed before sharing.
- Plex listener mapping is per user: `plexAccountId` is a positive integer or `null` in PATCH. The server verifies the selected account and derives `plexAccountName` and `plexMachineIdentifier`; clients cannot supply those identity fields. GET returns the stored mapping. Changing the Plex URL or token without selecting an account clears the mapping.
- The Plex probe returns `accounts: [{id, name}]` and `machineIdentifier` alongside music-library `sections`. Non-admins may probe their own Plex connection, never shared admin credentials. Other service probes stay admin-only. Listening requests require an explicit mapped account and reject mismatched history rows; library sync does not require listener mapping. Plex top-artist analysis requires complete history for the requested period and fails if it exceeds 5,000 entries or 25 pages. Recent-track requests intentionally return only their requested sample. The probe accepts `accountId` (number or explicit `null`); omission uses the saved listener, while `null` tests library-only access.
- Non-admin users can update only their own connection fields; global setting changes return `403`
- `preferences.scheduleCron`, `preferences.digestCron`, and `preferences.playlistSchedule` must be valid cron expressions or `""` (clears the schedule); an invalid expression returns `400` without saving anything
- Service probes require admin access when user-session auth is active, except for probing the current user's own Plex connection
- TIDAL client credentials and the TIDAL probe are global, admin-managed settings. TIDAL is *additionally* a per-user OAuth connection: each user authorizes their own account using the admin-registered app via `/api/v1/auth/oauth/tidal/initiate`
- `GET /api/v1/settings` returns `_tidalAppConfigured` (boolean), a read-only capability flag telling non-admins whether an admin has registered a TIDAL app, so the UI can enable the Connect button without exposing the credentials. Underscore-prefixed keys are derived flags, never stored settings, and are ignored on `PATCH`
- Successful service probes return `200` with a required `message` plus optional metadata:
  `{ "message": "Connected", "version": "1.2.3", "latencyMs": 42 }`
- Failed service probes return `application/problem+json`: `400` for missing or unknown input,
  `403` for non-admin callers, and `502` when the upstream service probe fails
- The `502` body's `detail` field carries the upstream failure message (secrets redacted,
  capped at 300 chars) so the caller can see e.g. which model name the provider rejected
- Send a JSON object for probes: `{}` uses saved credentials where supported. Missing, empty, malformed, or non-object payloads return `400` problem+json with type `/problems/probe-invalid-input` before saved credentials are read. Access checks run first. Where supported, non-empty connection and credential strings override saved values. Empty strings (including URLs, API keys, tokens, usernames, passwords, provider, and model) fall back to saved values, so a successful probe may test the previous configuration rather than the empty values supplied. For Lidarr, omitted `skipTlsVerify` uses the saved value, defaulting to false when unset. Explicit `true` or `false` overrides it; other supplied types return `400` without running a probe.
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
- Channel IDs must be unique within `preferences.channels`; duplicate IDs return `400` without saving. Digest delivery positions are server-owned, omitted from settings responses, and cannot be edited through PATCH. Disabling a channel or its digest subscription pauses its position; removing and re-adding the same ID resumes it. A new ID starts from the current cadence. Endpoint/type edits under the same ID keep the position.
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

In v2.0.0, the browser requests destructive-operation confirmation before uploading the file, then sends `?confirm=true`. A key mismatch requires a second explicit confirmation before retrying the same file with `?confirm=true&force=true`. Canceling either dialog sends no restore request for that step. Cookie authentication, CSRF protection, backup validation, and restore transaction behavior are unchanged.

Restore accepts an optional legacy `data.oidcTokens` array for compatibility:
an absent or empty array is silent, while nonempty rows are never restored and
add `Ignored 1 legacy OIDC token record.` or
`Ignored N legacy OIDC token records.` to `warnings`.

Default JSON exports are consistent snapshots of persistent application state and required artist dependencies, including album blocks, library snapshots/overrides, health state, recording cache, and slskd jobs. `?includeCaches=true` adds optional artist metadata and a `-with-caches` filename suffix. Automatic snapshots also include that metadata. Ephemeral sessions, pending authorizations, rate limits, and migration history are excluded. Retain the matching encryption key separately; exact schema rollback requires a native consistent database backup. See [backup boundaries](guides/switching-backends.md#backup-boundaries-and-recovery).

Restore replaces included tables in one transaction. Unsafe partial backups return `422` with `{ "code": "partial_backup_conflict", "error": "...", "affectedTables": ["albumBlocks"] }` before any deletes. This covers omitted dependent destination state and unresolved artist references; `force=true` cannot bypass it. Safe legacy partial files remain accepted. Take a complete destination backup first and prefer a fresh database. Required automatic-backup failures stop startup before migrations; the explicit override is documented in the recovery guide.

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
| 409 | `target_not_empty` | A copy-managed destination table has data and `overwrite` is false, including targets without users. In v2.0.0, checks run before target migrations and again under target table locks before any copy deletes ([#775](https://github.com/iuliandita/digarr/issues/775)). |
| 409 | `same_database` | Source and target identify the same database. |

A missing pre-migration table is compatible with a fresh or older target; inspection or lock failures abort. Schema migrations still run outside the copy transaction, and explicit overwrite still clears excluded sessions/rate limits outside it. Stop source and destination writers through cutover and take complete backups before replacing an existing target. No new schema migration is added by the destination-guard correction.

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
