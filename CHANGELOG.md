# Changelog

All notable user-facing changes are documented here.

Releases that have been promoted to the `:stable` Docker channel carry a `(stable)` marker after the version heading. Promotion happens after a release has been live for at least seven days with no follow-up patch.

## v1.0.0-rc.9 - 2026-06-20

Feature release: two new discovery modes, preview volume, smarter rejection feedback.

### Added

- Two new discovery modes. **Artist Relationships** discovers collaborators, band members, and aliases from the MusicBrainz relationship graph (filterable by relationship type). **Labels** discovers other artists on the same record labels as your seeds, via a connected Discogs account.
- A volume control on the audio preview bar. Your chosen level is remembered across sessions and applies to both the global preview and per-card track previews.
- Bulk rejection can now apply a shared reason (and an optional permanent block) to every selected recommendation at once.

### Changed

- Recommendation scoring now learns from why you reject. Marking artists "tried it, didn't like it" or "wrong genre or style" downweights that genre in future scans; "maybe later" stays neutral.

### Fixed

- A discovery scan that fails after it has started is now correctly recorded as failed instead of appearing stuck in "running".
- Emby playlist requests now time out cleanly instead of potentially hanging on a slow server.

## v1.0.0-rc.8 - 2026-06-19

Authorization hardening release candidate.

### Security

- The target list (`GET /api/v1/targets`) no longer exposes other users' targets to non-admins. Each account now sees only its own targets; admins keep the full cross-user view. Previously a non-admin could read every user's target name, type, and connection URL/host (secrets were already masked).
- Closed several authorization and IDOR gaps so non-admins can no longer reach admin-scoped data or actions through unguarded read endpoints.
- Patched a CORS advisory by updating the HTTP framework (hono) to 4.12.26. Digarr did not use the vulnerable wildcard-credentials configuration, but the dependency is updated as a precaution.

### Added

- The approve dialog now loads its quality/metadata profiles and root folders from a dedicated non-admin endpoint that returns only the names and paths it needs, without leaking Lidarr free-space or library-structure details.

### Fixed

- The "Seed Genres" control is now hidden from non-admin users, matching the server-side permission (it always returned a permission error for them before).

## v1.0.0-rc.7 - 2026-06-17

Startup resilience release candidate.

### Fixed

- The app no longer crash-loops when Postgres is still starting up (SQLSTATE 57P03 "not yet accepting connections"). The initial DB connection now retries with exponential backoff (1s to 30s cap) until Postgres finishes recovery, and the HTTP server only starts after the database is reachable.

## v1.0.0-rc.6 - 2026-05-29

Dependency and toolchain maintenance release candidate.

### Changed

- Completed the Bun 1.3.14 alignment across the runtime image, CI workflows, and the release build matrix (slim and alpine variants), so the build and runtime stages no longer straddle two Bun versions.
- Bumped every npm dependency to its latest version, including a major step for the esbuild build tool (0.27 to 0.28).
- Reworked the dependency overrides from exact version pins to caret floors, so the security minimums no longer cap forward upgrades.
- Widened Dependabot coverage so it surfaces major updates for build tooling, groups all packages, and groups the Docker and GitHub Actions ecosystems.

## v1.0.0-rc.5 - 2026-05-28

Dependency and CI maintenance release candidate.

### Changed

- Updated the Bun runtime base image to 1.3.14 and refreshed the production dependency group.
- Refreshed pinned CI actions (docker/login-action, docker/metadata-action, docker/build-push-action, github/codeql-action, actions/stale).

### Fixed

- The Dependabot bun.lock sync workflow now authenticates its PR-head fetch with basic auth, so npm dependency updates regenerate the lockfile and pass CI instead of failing the frozen-lockfile check.

## v1.0.0-rc.4 - 2026-05-13

Popular album approval release candidate.

### Added

- Recommendation approval now includes a Popular albums option that uses Spotify popularity to monitor the top 3 album releases when adding an artist to Lidarr.
- Today's Pick now exposes the same approval monitoring menu as Discover for all, new, selected, popular, or unmonitored album adds.

## v1.0.0-rc.3 - 2026-05-05

Recommendation clearing fix release candidate.

### Fixed

- Clear All now rejects pending recommendations in API-sized batches instead of requesting an oversized `limit=10000` page, fixing the 400 response from the recommendations list endpoint.

## v1.0.0-rc.2 - 2026-05-05

Spotify OAuth fix release candidate.

### Fixed

- Spotify connection setup now decrypts the pending callback credentials before exchanging the authorization code, fixing `oauth_error=token_exchange_failed` redirects on Kubernetes and other deployments with field-level encryption enabled.

## v1.0.0-rc.1 - 2026-05-05

Dashboard layout polish release candidate.

### Changed

- Dashboard Listening History and Recent Activity now sit beside Recently Approved above the fold, while Subscription Pulse is grouped with Taste Profile lower on the page.

## v1.0.0-rc.0 - 2026-05-03

Release candidate for the v1 line. This consolidates the v1 audit follow-ups across API contracts, security hardening, CI release safety, accessibility, i18n, Docker/Kubernetes deployment defaults, and UI polish.

### Added

- `:stable` Docker channel support and a manual stable-promotion workflow, so release candidates and fresh releases can ship without moving the recommended self-hosting channel.
- Probe success metadata for service test routes and expanded API documentation coverage for the v1 endpoint surface.
- Warning theme token coverage across all shipped themes.

### Changed

- Docker release automation keeps prerelease tags off floating stable-style channels and creates GitHub prereleases automatically for prerelease tags.
- Dashboard, discovery, mobile navigation, recommendation hover controls, touch targets, and focus-visible states were tightened for the v1 candidate.
- AI provider settings copy now describes privacy behavior based on the configured host instead of making a blanket provider claim.

### Fixed

- DNS rebinding and pinned-IP handling for outbound HTTP checks, including AI base URL validation.
- Problem-details responses for auth failures and validation for numeric route inputs.
- Hardcoded English strings in navigation and health-check UI paths.
- Bandcamp scraping sanitization for encoded and incomplete HTML tags.
- Kubernetes app/database selector isolation, pod termination timing, shell script robustness, foreign-key index coverage, and release/security scan pinning.

## v0.44.0 - 2026-04-26

UX release. Rejecting a recommendation now opens a structured picker with six fixed reasons (already own, wrong style, not interested, tried it didn't like it, maybe later, other) plus a "Don't show again" checkbox that promotes the rejection to a permanent per-user blacklist. Settings gets a new Blocked tab to view, search, and unblock entries. The new blocklist filters the pipeline, subscriptions, and quick-discover independent of the existing rejection cooldown, so unblocking does not bypass the cooldown.

### Added

- Permanent per-user artist blacklist (`artist_blocks` table) keyed on `(user_id, artist_id)` with cascade FKs and unique upsert semantics
- Structured rejection reasons (6 fixed + freeform "Other") captured via a bottom-sheet/modal picker on the existing reject action
- `Settings > Blocked` tab with debounced name search, cursor pagination, and unblock-with-undo toast
- `POST /api/v1/artist-blocks`, `GET /api/v1/artist-blocks`, `DELETE /api/v1/artist-blocks/:artistId` routes (auth required, scoped to the calling user)
- `rejection_reason` and `rejection_reason_text` columns on `recommendations` so the reason persists with the rejection record
- Pipeline filter, subscription runner, and quick-discover all honour the blocklist as an independent layer above the rejection cooldown
- 28 new i18n keys translated across all 15 shipped locales
- Backup/restore round-trips include `artist_blocks`
- Server-side Zod validation enforces UI invariants (`not_right_now` is incompatible with permanent; `reasonText` only valid when `reason='other'`)

### Changed

- `POST /api/v1/recommendations/:id/status` with `status: 'rejected'` now accepts optional `reason`, `reasonText`, and `permanent` fields; legacy callers that omit them continue to work unchanged
- `StoreDb` interface gains `getBlockedMbids(userId)`; production wiring and all test mocks updated
- New `Digarr` signature theme added to the theme picker (cool slate-navy + muted moss + warm-dim crimson)

## v0.43.0 - 2026-04-23

Dashboard fix release. ListenBrainz `range=week/month/year` returned the previous full calendar period, not the current or rolling window the UI implied; the dashboard tile showed March's top artist when asked about April. The single Listening tile is split into two endpoints with explicit semantics.

### Changed

- `GET /api/v1/listening/recent` is replaced by two endpoints:
  - `GET /api/v1/listening/top-artists` (ListenBrainz primary, Last.fm fallback) accepts `this_week`, `this_month`, `this_year`, `all_time` ranges with `offset`+`limit` pagination. Last.fm `7day`/`1month`/`12month`/`overall` periods are mapped as best-effort approximations.
  - `GET /api/v1/listening/recent-tracks` (Last.fm primary, then ListenBrainz listens, Jellyfin, Emby) returns a `hasSource` flag so the UI can hide the tile when no scrobble source is connected.
- Dashboard splits into Listening History (four range chips + prev/next pagination) and Recent Activity (hidden when `hasSource=false`).
- i18n keys added across all 15 locales; stale week/month/listening keys removed.
- Back-compat maps the old `range=week|month|year` to the new `this_*` values so bookmarked URLs keep working.

### Added

- `getTopArtistsPaged` and `getListens` on the ListenBrainz client; `getTopArtistsPaged` on the Last.fm client with page-based pagination.

## v0.42.0 - 2026-04-20

Metadata enrichment release. TheAudioDB becomes the primary artist-image source ahead of the existing Lidarr/SkyHook + fanart.tv + musicinfo.pro chain, and recommendation cards now carry a short Wikidata-sourced bio plus external-link pills (Wikipedia, official site, Discogs, MusicBrainz).

### Added

- TheAudioDB is now the primary source for artist images, with the existing Lidarr/SkyHook, fanart.tv, and musicinfo.pro chain as fallback. A Postgres-backed token-bucket rate limiter keeps AudioDB traffic under the free-tier budget and survives process restarts.
- Recommendation cards expose a short artist description and external links (Wikipedia, official site, Discogs, MusicBrainz) sourced from Wikidata. Responses are cached per locale for 30 days with a 24h negative cache on SPARQL misses.
- Settings > Recommendations: TheAudioDB premium API key (optional), image-proxy toggle, and Wikidata enable toggle.
- Optional image proxy route (`GET /api/v1/media/image-proxy`) hides the client IP from the TheAudioDB CDN when enabled. Allowlisted to AudioDB hosts, SSRF-guarded, off by default.
- Library health check "Artists missing Wikidata enrichment" backfills descriptions and external links in bulk at a polite 1 rps.

## v0.41.0 - 2026-04-19

Phase 9 of the deep-audit remediation: API hygiene. The entire HTTP surface moves to `/api/v1/*`; legacy `/api/*` paths respond with `308 Permanent Redirect` + `Deprecation` + `Sunset` headers (sunset 2026-07-19). Mutation routes now return `204 No Content` instead of `{ok:true}`-family JSON bodies. The probe endpoint reports probe failure via HTTP status codes (502/504 + problem+json) rather than a `success:false` body flag. Six list endpoints opt into cursor pagination via `?limit=N&cursor=OPAQUE`.

### Changed (breaking)

- `/api/*` -> `/api/v1/*`. Old prefix 308-redirects for one release, removed in the next major. Clients that post-date RFC 7538 (2015+) handle 308 POST bodies correctly. Re-register OIDC callback URLs at your IdP. Update any webhook targets that point at `/api/` paths.
- Mutation endpoints (auth password change, logout; settings update; subscription/target/playlist/user CRUD; library overrides/reconcile; setup complete; slskd accept; OAuth disconnect) return `204 No Content` with empty body. Two endpoints retain a body: `PATCH /api/v1/auth/me/locale` returns `{preferredLocale}`; `POST /api/v1/auth/change-password` returns `{token}`.
- `POST /api/v1/settings/test/:service` returns `200 {message}` on success; `502 Bad Gateway` with `application/problem+json` on failure. The `success` field is gone; read the HTTP status. `POST /api/v1/settings/test-webhook` returns `204` on success and problem+json on failure.

### Added

- `readPagination(c)` accepts `?limit` + `?cursor` on subscriptions, targets, batches, users, playlists, and analytics/batches endpoints. Absence of both query params preserves the legacy naked-array response.
- `src/server/helpers/pagination-cursor.ts` - opaque base64url-encoded `{id, ts}` cursor. Malformed cursors are treated as a fresh request.
- `src/server/middleware/api-version.ts` - 308 redirect with `Deprecation: true` and `Sunset: Sat, 19 Jul 2026 00:00:00 GMT`.

## v0.40.6 - 2026-04-19

Closes the last Phase 2 SSRF gap from the deep audit (item 2.3). NAT64 (RFC 6052, `64:ff9b::/32`) and Teredo (RFC 4380, `2001::/32`) encode arbitrary IPv4 inside IPv6, so an attacker controlling DNS for an IPv6 hostname could previously tunnel webhook/probe traffic back into RFC1918 space. `isPrivateIp` now rejects both prefixes.

### Security

- `src/core/validation.ts` rejects NAT64 and Teredo IPv6 prefixes when screening webhook targets and other outbound hosts. The companion test assertions are flipped from `false` to `true`.

## v0.37.5 - 2026-04-18

Phase 10 of the deep-audit remediation: AI/LLM hardening. Anthropic and OpenAI now respect `baseURL` so proxy deployments work; Gemini, Ollama, and OpenAI-compatible providers retry with exponential backoff and honour `Retry-After`; Ollama's timeout is configurable via `DIGARR_AI_TIMEOUT_SECONDS`; the mood endpoint wraps user input in `<user_query>` delimiters with control-character sanitation. Every recommendation response is now Zod-validated, Anthropic requests use tool-use + prompt caching (`cache_control: { type: 'ephemeral' }` on a static prelude), and per-request token usage lands in `job_runs.metadata.aiUsage`. Promptfoo fixtures ship as an advisory eval gate.

### Added

- `DIGARR_AI_TIMEOUT_SECONDS` env var overrides the per-provider request timeout (Ollama defaults to 120 s, others 30 s).
- `src/core/providers/retry.ts` - shared `fetchWithRetry` helper distinguishes 429 (honours `Retry-After`), 5xx (exp-backoff), and 4xx-not-429 (non-retriable via p-retry `AbortError`).
- `AiRecommendationItemSchema` + `validateAiRecommendations()` replace the ad-hoc per-field filter. Items that fail schema validation are dropped.
- Anthropic prompt caching: the ~40-line system prelude is sent as a cached ephemeral block; listener profile moves to the user turn for per-request variability.
- `lastUsage` per-provider property surfaces `inputTokens`, `outputTokens`, and (for Anthropic) `cacheReadInputTokens` / `cacheCreationInputTokens`. The pipeline and quick-discover job paths merge `aiUsage` into `job_runs.metadata`.
- `promptfooconfig.yaml` + `prompts/recommendation.txt` with 10 neighbour-assertion fixtures across genres. `.github/workflows/evals.yml` runs them on `workflow_dispatch`; results are advisory (`continue-on-error: true`).

### Changed

- Anthropic and OpenAI provider constructors accept an optional `baseUrl`; the SDK receives it as `baseURL`. Threaded through the provider registry from settings.
- OpenAI uses `response_format: { type: 'json_schema' }` with the shared recommendations schema and `max_completion_tokens: 4096` (was `max_tokens`, now deprecated).
- Anthropic requests force-call the `emit_recommendations` tool with the recommendations JSON schema as `input_schema`; parses tool-use output directly and falls back to text parsing when the block is absent (proxy deployments).
- Gemini adds a sanitised `responseSchema` to its `generationConfig` (dropping `$schema`, `additionalProperties`, and other JSON-Schema fields Gemini rejects).
- Mood endpoint wraps user input in `<user_query>...</user_query>` and restates the task after the closing tag. Control characters and attempted nested `<user_query>` tags are stripped before wrapping.
- `parseRecommendationResponse` strips `<think>...</think>` blocks from reasoning-model output before the bracket-depth parser runs. `unwrapRecommendationArrayPayload` does the same before JSON.parse.

### Security

- Settings test endpoint (`POST /api/settings/test/:service`) now carries an inline comment documenting that the route-wide `resolveAdmin` check already blocks legacy-token callers from reaching the stored-apiKey fallback - the previously-unclear admin gate is preserved and made explicit.

## v0.32.3 - 2026-04-18

Phase 5 of the deep-audit remediation: supply chain and release integrity. Forgejo demoted to CI-only so GitHub is the sole release surface. SLSA v1.0 build provenance attestations now ride alongside cosign signatures on every published image. Image digests are kept in lockstep across `deploy/k8s/deployment.yaml`, `deploy/helm/digarr/values.yaml`, and `deploy/unraid/digarr.xml` by a new sync script, with a CI assertion that fails the release pipeline on drift. Buildx now caches across runs via GitHub Actions cache, and the docker job is gated on a `production` environment with required reviewer.

### Added

- `actions/attest-build-provenance@v4.1.0` produces SLSA v1.0 build-provenance attestations for both GHCR and Docker Hub on every release. Attestations are pushed to the registry referrers API and to the GitHub attestations API.
- `scripts/sync-deploy-digests.ts` fetches the multi-arch manifest digest from ghcr.io and rewrites all three deploy artefacts. Run it post-release as `bun scripts/sync-deploy-digests.ts vX.Y.Z`.
- `verify-digest-sync` job in `.github/workflows/release.yml` asserts that the Kubernetes manifest, Helm chart values, and Unraid template all carry the same `sha256:` digest. The release pipeline fails on drift.
- Docker job gated on `environment: production` with `iuliandita` as required reviewer; tag pushes now block at the publish step until acknowledged.
- Buildx now uses `cache-from: type=gha` / `cache-to: type=gha,mode=max`, cutting cold-cache build time on subsequent releases.

### Changed

- Forgejo no longer publishes release artefacts. `.forgejo/workflows/release.yml` deleted; the GitHub release workflow is canonical.
- `.forgejo/workflows/ci.yml` annotated with mirror-origin comments on every `actions/checkout` step so future Dependabot bumps to `.github/` can be mirrored manually without ambiguity.
- SBOM step in the release workflow routes the image arg through `IMAGE_REF` env, matching the pattern used by the `Resolve tag` step.
- Unraid template (`deploy/unraid/digarr.xml`) carries an explicit digest-pin comment, kept in sync with the other deploy files by the sync script.

## v0.31.7 - 2026-04-18

Phase 4 of the deep-audit remediation: database-layer correctness and performance. Six missing foreign-key indexes added, three check-then-write upsert races closed, N+1 loops in backup restore and hygiene batched into chunked statements, per-row JS genre aggregation pushed into SQL via `unnest`, and `DIGARR_ENCRYPTION_KEY_NEXT` dual-key rotation landed with a runbook. Three migrations; no user action required beyond standard deploy.

### Fixed

- `upsertLibrarySyncState`, `upsertOverride`, and `upsertAlbumOverride` no longer race under concurrent writes. Rewritten as atomic `INSERT ... ON CONFLICT DO UPDATE` with the three natural-key unique indexes migrated to `NULLS NOT DISTINCT` so shared-cursor rows (nullable `user_id`) participate in conflict matching.
- `preferencesSchema` no longer accepts arbitrary unknown keys. `.passthrough()` replaced with `.strict()` on both the outer and `scoringWeights` objects, closing a storage-bloat surface where a hostile admin client could inflate the `preferences` jsonb indefinitely.
- Backup key-mismatch detection now flags `settings.preferences.fanartApiKey` alongside top-level sensitive columns so a restore into a different-key deployment surfaces every field that may be unreadable.
- `getGenreArtists` deep_cuts view no longer wraps `artistMetadata.nameNormalized` in `lower()`. The column is already lowercased at write time; the wrapper defeated any btree index on it.

### Performance

- Six missing foreign-key indexes added: `genres(parent_genre_id)`, `recommendation_batches(subscription_id)`, `job_runs(user_id)`, `job_runs(batch_id)`, `slskd_jobs(target_id)`, `slskd_jobs(recommendation_id)`. Postgres does not auto-index FK columns; cascades and joins previously degraded to sequential scans as row count grew.
- GIN indexes on `artists.genres[]` and `artists.tags[]` so array-membership queries like `genres @> ARRAY['indie']` can use an index instead of a sequential scan.
- `pg.Pool` defaults: `max=20` (up from the libpg default of 10), `idleTimeoutMillis=30s`, server-side `statement_timeout=30s`. Caps runaway queries at the connection level.
- Backup restore batches rows (1000 per chunk) using `ON CONFLICT DO UPDATE` with an `excluded.*` set clause. Round-trips for a 10k-row restore drop from 10k to ~10.
- Hygiene `rebuildGenres` batches inserts (2000 per chunk). `rescoreRecommendations` replaces per-row `UPDATE` with `UPDATE ... FROM unnest(ids, scores)` chunked at 5000; two array parameters regardless of row count.
- `getTopGenresForUser` and `getGenreFeedbackHistory` push their genre tallies into SQL via `unnest` + `GROUP BY` instead of materializing every row in JS and reducing.

### Added

- `DIGARR_ENCRYPTION_KEY_NEXT` environment variable enables dual-key rotation mode. `decryptField` tries primary -> NEXT -> legacy; writes always use the primary. See [docs/runbooks/encryption-key-rotation.md](docs/runbooks/encryption-key-rotation.md) for the 3-deploy procedure.
- `scripts/rotate-encryption-key.ts` re-encrypts every `enc:v1:` value (including nested jsonb paths and `targets.config`) with the current primary key. Safe to re-run; idempotent.

## v0.30.5 - 2026-04-18

Phase 3 of the deep-audit remediation: 15 correctness bugs closed across pipeline, OAuth, scheduler, backup, recommendations, and rate-limit surfaces, plus a hono CVE bump. No user action required; all fixes are internal to the running deployment.

### Fixed

- Auto-approve no longer marks a recommendation as `added_to_lidarr` when the Lidarr target's `addArtist` actually failed. The status now keys off the Lidarr result's `success` flag; a Lidarr failure surfaces as `add_failed` even when a secondary target (Emby, slskd, playlist) succeeded. Lidarr is treated as the authoritative downloader for status purposes.
- CSV import and export share a formula-injection guard (`cellSafe` / `parseCell`) that strips leading `= + - @ \t \r` characters and applies RFC 4180 quote handling. Import additionally tokenizes rows with a proper quoted-field parser instead of a naive split on commas.
- OAuth `clientSecret` is now always encrypted at rest, including during the pre-auth pending window. Only `accessToken` stays plaintext when it is a pending marker, because the LIKE-prefix state lookup requires it. Existing encrypted rows are unaffected.
- OAuth token refresh preserves `clientId`, `clientSecret`, and `scopes` instead of nulling them out on every refresh. Rows previously reduced to `{accessToken, refreshToken, expiresAt}` after the first refresh are now restored on the next successful refresh.
- Shutdown handling: the slskd cron, library sync cron, library health cron, and stuck-detector cron are now captured as handles and `.stop()`'d on SIGTERM/SIGINT, alongside the pipeline and playlist schedulers.
- `imageFailedAt` insert-path priority now matches the update path: artist with an `imageUrl` always clears the negative cache, regardless of the `imageFailed` flag.
- `PipelineOrchestrator._currentUserId` resets in the `finally` block so subsequent non-pipeline emits don't inherit a stale userId.
- Admin reasoning-generation prompts interpolate `artistName` through `JSON.stringify` to neutralize artist-name injection into the prompt structure.
- Recommendation status filters (`?status=foo,bar,...`) are allowlisted against `VALID_STATUSES` before hitting the DB. Unknown tokens (including SQL-looking payloads) are dropped instead of being passed to `inArray`.
- Jellyfin playlist `searchTrack` now logs transport errors with the artist and track context, instead of swallowing them silently with a `catch {}`.
- Login pays the scrypt cost for missing usernames too (a pre-computed `DUMMY_PASSWORD_HASH` is verified in the `user == null` branch), closing a timing-based user-enumeration oracle.
- Backup restore (`POST /api/admin/restore`) now requires `?confirm=true` in addition to `?force=`. The `data` object schema is strict: unknown keys are rejected, closing a prototype-pollution surface that `.passthrough()` previously left open.

### Changed

- Rate-limit middleware shares one `setInterval` prune loop across all limiter instances via a module-level registry, instead of each instance owning its own. Exposes `__shutdownRateLimiter()` for test cleanup.
- `hono` pinned >=4.12.14 (GHSA-458j-xx4x-4375, medium HTML-injection in `hono/jsx` SSR; Digarr does not use that path but the dep-scan gate required it).
- Vestigial `BatchStats.scored` field dropped from the `batches` query type; the orchestrator, webhook payload, and jobs API already used `discovered`.

## v0.29.3 - 2026-04-18

Phase 2 of the deep-audit remediation: SSRF hardening for outbound HTTP and Last.fm api-key redaction in error logs.

### Fixed

- Webhook and outbound HTTP callers now pin the resolved IP after DNS lookup to defeat DNS-rebinding TOCTOU attacks. HTTPS callers preserve SNI via a bracketed-host fallback; HTTP callers rewrite the hostname to the pinned address while setting the `Host` header back to the original value.
- `isPrivateIp` covers more reserved ranges (link-local v6, loopback variants, cloud-metadata IPs) and normalizes bracketed IPv6 hosts before evaluation. Webhook SSRF allowlists tightened accordingly.
- OIDC test endpoint and other admin-adjacent test URL helpers are now gated behind the admin role, closing a bypass where an authenticated non-admin could probe arbitrary hosts via the test path.
- Last.fm API keys (and other sensitive query params like `apikey`, `key`, `token`, `secret`, `password`) are redacted from `HttpError` messages, `redactUrlForLog` output, and blocked-redirect error paths. A URL-parser-failure fallback (`redactQueryStringFallback`) handles malformed inputs that break `new URL()`.

### Changed

- Zod schemas migrated to the `z` namespace import across all `src/server/schemas/*` modules and matching tests, settling on a single import style.

## v0.28.5 - 2026-04-17

Security-critical release: closes the three-step unauthenticated admin-takeover chain identified in the deep audit, plus surrounding auth-surface hardening. All authenticated users should keep working without action; the tightenings only affect new registrations and newly-rotated passwords.

### Fixed

- CIDR matching now supports IPv6 with a strict parser. The prior IPv4-only implementation silently passed IPv6 addresses through an integer-only check, allowing an IPv6 address like `2400:beef::1` to match an unrelated `2400:cb00::/32` CIDR and bypass proxy-auth trust boundaries. The new parser validates each family independently and rejects leading-zero octets (CVE-2021-29923 class).
- `PROXY_AUTH_TRUSTED_PROXIES` entries are validated at boot. Unbounded ranges (`0.0.0.0/0`, `::/0`, plus every textual variant that normalizes to `/0`) are refused so a misconfigured deployment fails loudly instead of silently trusting the internet.
- Session tokens are no longer cached in an in-memory per-user map. Proxy-auth previously reused any active session for the resolved user, which could hand a password-mode session's raw token back via `/api/auth/status` when the same user had also signed in through the proxy. Each proxy-auth request now mints a fresh session pinned to an httpOnly, SameSite=Lax cookie.
- `/api/auth/status` no longer echoes session tokens to the client. Authenticated callers rely on the cookie for follow-up requests; the response exposes `authenticated`, `userId`, and `isAdmin` instead.
- First-admin bootstrap is now serialized via a unique partial index on `users(is_admin) WHERE is_admin = true`. Two concurrent setup or registration requests can no longer both succeed as admin; the losing request is resolved to the existing admin or retried as a non-admin. The migration auto-demotes extra admins (keeping the oldest) with a `RAISE NOTICE` when applied against a database that previously accumulated duplicates.
- OIDC callbacks sanitize the `preferred_username` claim (allowlist `[A-Za-z0-9._-]`, 50-char cap) so an untrusted IdP cannot inject arbitrary characters into usernames that flow into filesystem, SQL, or UI contexts.
- Verbose OIDC error messages no longer leak into the login-screen URL fragment. Short stable codes (`config`, `oidc_failed`) replace them; detail stays in the server log.
- Auth middleware returns `503 re-run setup` for the degenerate state where setup is flagged complete but no users exist (orphaned DB state). Callers no longer retry against a dead deployment indefinitely.

### Changed

- OIDC email-verified auto-link is now opt-in. A new `OIDC_TRUST_EMAIL_VERIFIED` environment variable (default `false`) must be set to `true` before an OIDC sign-in will automatically link to an existing local account on matching `email_verified=true` claim. `docs/AUTHENTICATION.md` documents the threat model (single-tenant IdPs safe to enable, public issuers not).
- `/api/auth/status` no longer exposes `version` or `proxyAuthEnabled` to unauthenticated callers. Those fields moved to a new auth-gated `GET /api/auth/meta` endpoint. `oidcEnabled` stays public so the login screen can still render the OIDC sign-in button.
- Password minimum length is now 12 characters across registration and password changes. Existing users with shorter passwords continue to log in; the new minimum only applies when a password is set or rotated.
- Hono bumped to 4.12.14 to pick up GHSA-458j-xx4x-4375 (medium-severity HTML injection in `hono/jsx` SSR; Digarr does not use that path, but the upstream CI scan blocks without the fix).

## v0.27.12 - 2026-04-16

### Fixed

- Library sync no longer aborts when MusicBrainz returns a transient error (HTTP 503, timeouts, network blips). The affected artist or album is left unreconciled and retried on the next sync run. A warning with the failure count appears on the Library Sources panel so the user knows some data was skipped. Applies to all library sources (Plex, Jellyfin, Emby, Lidarr) since they share the same reconciler. Fixes #115.

### Changed

- The MusicBrainz client now retries transient failures (5xx, 429, network errors) up to 3 times with exponential backoff plus jitter, honoring `Retry-After` when provided. This absorbs short MB hiccups before the graceful-degrade path kicks in.

## v0.27.11 - 2026-04-15

### Fixed

- Self-hosted Plex, Jellyfin, Emby URLs behind reverse proxies on a LAN are no longer rejected as SSRF targets. The "URL resolves to a private/internal IP" block treated the user's own media server like an untrusted webhook destination, which broke split-horizon DNS deployments (public hostname resolving to a private IP) and every direct-LAN setup.
- Self-hosted AI base URLs are accepted for the same reason. Local Ollama at the default `http://localhost:11434` and any OpenAI-compatible endpoint on a private address now work without tripping the private-IP guard on connect or at request time.

### Changed

- The private-IP guard stays in place for user-configurable outbound URLs that can plausibly be adversarially set (webhooks, OIDC issuer, metadata fallback, fanart.tv, musicinfo.pro). It's only relaxed on admin-owned service URLs where private IPs are the expected default.

## v0.27.10 - 2026-04-14

Batch 8b of the 0.27.x hardening sweep: Zod validation extended to the remaining write routes.

### Added

- Zod schemas for subscriptions, playlists, recommendations, pipeline, setup, OAuth, and jobs write routes. Reusable croner-verified `cronSchema` and enum types for statuses, sort orders, export formats, and job types.
- Array size caps at the schema layer: deezer-playlist import max 100, bulk recommendations max 500, `selectedAlbumIds` max 200, `targetIds` max 50. Prevents a single payload from starving the worker.

### Changed

- Strict PATCH on subscriptions and playlists rejects unknown keys with 400 instead of silently dropping them.
- Jobs list query: out-of-range `limit` / `offset` returns 400 instead of clamping.
- OAuth `redirectUri` restricted to `http(s)` at the schema boundary; `javascript:` / `data:` URIs rejected before they can reach auth-URL rendering.
- Dead code removed: `ALLOWED_UPDATE_FIELDS` sets in subscriptions and playlists; `parseOptionalInteger` helper in recommendations.

## v0.27.9 - 2026-04-14

Batch 8a of the 0.27.x hardening sweep: Zod validation on the highest-risk write/admin endpoints.

### Added

- `zod@4`, `@hono/zod-validator`, and `drizzle-zod` dependencies. New `src/server/schemas/` foundation with `zJson` / `zQuery` / `zParam` helpers returning a consistent `{ error, code: 'validation_failed', details: [...] }` shape on 400. `error` stays human-readable for the existing frontend; `code` is the stable machine identifier.
- 15 invalid-input regression tests in `tests/server/routes/validation.test.ts`.

### Changed

- `POST /api/auth/register`, `POST /api/auth/change-password`, `POST` + `PATCH /api/users`, `POST` + `PATCH` + `DELETE /api/targets`, `PATCH /api/settings`, and `POST /api/admin/restore` now validate input with Zod before touching business logic. Login stays on the manual handler so its `credentialsRequired` error remains i18n'd in 15 locales.
- Targets: `type` constrained to the `TARGET_TYPES` enum, `config.url` forced to `http(s)`, PATCH `.strict()` rejects unknown keys.
- `/api/settings` preferences: enums and `[0, 1]` ranges enforced at the edge. Unknown top-level keys still silently dropped to preserve allowlist semantics.
- `/api/admin/restore`: backup envelope validated before `restoreBackup` runs. Non-array table payloads, missing envelope keys, and wrong types all 400 out at the edge.

## v0.27.8 - 2026-04-14

Batch 7 of the 0.27.x hardening sweep: SHA-pinned runner images and keyless cosign signing.

### Added

- Cosign keyless signing in `.github/workflows/release.yml` via `sigstore/cosign-installer@v4.1.1` (SHA-pinned). Signs each pushed image at both ghcr.io and docker.io by immutable digest using Sigstore OIDC, so there are no private keys, no secret rotation, and the signing identity is the workflow run itself.
- `cosign attest` binds the existing SPDX SBOM to the image digest.
- README verification recipe with `cosign verify` and `cosign verify-attestation` showing the `certificate-identity-regexp` + `certificate-oidc-issuer` flags that pin the signer to this repo's `release.yml`.

### Changed

- SHA-pinned every runner and base image: `oven/bun:1.3.11` (4 + 2 occurrences in Forgejo CI and release workflows), `postgres:17-alpine` (2 occurrences), the Dockerfile builder FROM and its default `RUNTIME_IMAGE` ARG, and both bun-slim and bun-alpine matrix variants in the GitHub release workflow. Closes SEV-009 (mutable-tag exposure).

## v0.27.7 - 2026-04-14

Batch 6 of the 0.27.x hardening sweep: Kubernetes posture - ServiceAccount, PodDisruptionBudget, Pod Security Standards restricted.

### Added

- Dedicated ServiceAccount on both the Helm chart and raw manifests, with `automountServiceAccountToken: false` as defense-in-depth on top of the existing pod-level flag. New `serviceAccount.*` values let operators swap in a pre-existing SA for IRSA / Workload Identity.
- PodDisruptionBudget template in the Helm chart, gated on `podDisruptionBudget.enabled && replicaCount > 1` so the default (replicas=1) behavior is unchanged. Commented example in `deploy/k8s/poddisruptionbudget.yaml`.
- Pod Security Standards namespace template with `enforce=restricted`. Helm `NOTES.txt` emits the equivalent `kubectl label` command.

### Changed

- Postgres StatefulSet container securityContext now drops `ALL` capabilities and sets pod-level `runAsNonRoot: true` explicitly so the bundled Postgres passes PSS restricted.
- `values.schema.json` extended with `serviceAccount` and `podDisruptionBudget` blocks.

## v0.27.6 - 2026-04-14

i18n batch 6: finish component coverage and extend translator into the library sync.

### Fixed

- Hardcoded English strings translated in `preview-player`, `streaming-links` (PLAY / STOP and the Spotify embed iframe title), `mood-prompt-bar` toasts, `album-picker` (close + empty state), `genre-grid` empty state, `hint` (3 aria-labels + dismiss), `library-first-sync-banner` (dismiss + MusicBrainz rate-limit body), `bottom-nav` aria-label, `discover` undo-toast, and `admin/upgrade-section` loading fallback.
- Library-sync `Syncing {source}...` SSE progress messages translate via a translator threaded through the orchestrator into `SyncOptions`. Graceful English fallback when no translator is provided.

### Added

- 3 new keys (`firstSyncBanner.title`, `firstSyncBanner.body`, `librarySync.message.syncingSource`) plus translations across all 14 shipped locales. Catalog parity restored.

## v0.27.5 - 2026-04-14

i18n batch 5: pipeline progress messages, card-stack / approve-dialog coverage, and a machine-translation quality pass.

### Fixed

- Pipeline progress SSE messages from `orchestrator.ts` and `resolve.ts` no longer leak English into non-English UIs. A small `src/core/i18n/translator.ts` gives the server-side paths a locale-aware `getMessages(locale)` with `{0}` interpolation, threaded through via the existing `responseLocale` plumbing.
- `targetActionLabel(type, name, t)`, the `ApproveDialog` button and loading state, card-stack approve / reject / view-details labels and aria-labels, prev/next nav aria-labels, and the "No more recommendations" empty state all translate.
- Source-score chips (`consensus`, `popularity`, `similarity`, `aiConfidence`, `genreOverlap`, `feedbackBoost`) now map to the existing `analytics.source.*` keys instead of falling through to the raw key.
- Bad machine translations corrected across 11-13 locales for `recommendation.match`, `pipeline.stage.score`, and `pipeline.runningFor`, which previously read as "sports match" or "physical running" instead of compatibility / execution senses. The `recommendation-card` chip variable was also shadowing the i18n `t` function; renamed.

### Added

- 43 new i18n keys in `en.ts` covering card-stack nav, preview player, streaming PLAY / STOP, mood-discover toasts, album picker, genre grid, hint dismiss, mobile nav, target actions, and pipeline messages, plus translations across all 14 shipped locales.
- PLAY / STOP added to the `i18n-check` allowlist (intentionally identical across locales; render as icon-style labels).

## v0.27.4 - 2026-04-14

Full SSRF sweep of the remaining outbound-URL surfaces.

### Security

- CGNAT range (`100.64.0.0/10`) added to `isPrivateIp`.
- LIKE-injection escape on `findPendingOAuthByState`: attacker-controlled OAuth state can no longer widen the suffix match via `%` or `_`.
- OIDC DNS rebinding hardened. `OidcService` passes a custom fetch to `openid-client` that resolves DNS per request, rejects private IPs, and pins the resolved IP for `http://` via the Host header.
- URL validation at write paths: `POST /api/setup/complete` validates `embyUrl`; `PATCH /api/settings` validates `aiBaseUrl`; user-scoped Plex / Jellyfin / Emby URLs validated for admins too; `POST /api/settings/test/ai` validates `body.baseUrl`.
- Client-level `publicIpOnly: true` on the Plex, Jellyfin, Emby, and fanart HTTP clients.
- `OllamaProvider` and `OpenAICompatibleProvider` now run `validatePublicServiceUrl` before every `getRecommendations()` and `testConnection()` call.

### Added

- `src/core/url-safety.ts` houses `validatePublicServiceUrl`. Kept out of `src/core/validation.ts` so the React bundle does not pull `node:dns/promises` into the browser module graph. `src/core/notifications.ts` re-exports `isPrivateIp` / `isPrivateUrl` for backward compatibility with its existing callers.

## v0.27.3 - 2026-04-14

Hotfix for broken manual scans.

### Fixed

- Manual scans from the UI no longer fail with "Pipeline orchestrator requires librarySync, userId, and library StoreDb methods". `POST /api/pipeline/run` now passes `librarySync: deps.librarySync` through to `orchestrator.run()`; the scheduled-run and discovery-mode paths were already correct. The `as unknown as PipelineDeps` cast in the manual-trigger path had hidden the missing field at compile time. Fixes #105.

### Changed

- `.github/ISSUE_TEMPLATE/bug.yml` Environment field split into required structured inputs (digarr version, deployment method, host OS, Postgres version) plus an optional browser field, so future bug reports are actionable instead of arriving as `_No response_`.

## v0.27.2 - 2026-04-14

### Security

- `oidc_tokens.accessToken`, `refreshToken`, and `idToken` are now covered by a new `SENSITIVE_OIDC` encryption field map. Previously the table had two gaps: `ENCRYPTED_FIELD_MAP` used the wrong field set (`SENSITIVE_OAUTH`, which lists `clientSecret` that `oidc_tokens` does not have while omitting `idToken`), and there was no query-helper module to force encryption on future writes. No rows are currently persisted (the OIDC flow returns tokens to the caller without storing them), so this is a preventive fix.
- New `src/db/queries/oidc-tokens.ts` with `getOidcTokensByUserId`, `upsertOidcTokens`, and `deleteOidcTokensByUserId`, all transparently encrypted via `encryptFields` / `decryptFields`.
- Migration `0025_oidc_tokens_user_unique.sql` marks `oidcTokens.userId` as `.unique()` so `upsertOidcTokens()`'s `ON CONFLICT (user_id)` target is valid. The table is empty, so no duplicates exist.

### Added

- 17 new crypto round-trip tests covering `encryptField` / `decryptField` (simple, unicode, 10 KB), fresh-IV property, idempotency, null / undefined preservation, wrong-key throw behavior, malformed-prefix tolerance, legacy plaintext pass-through, and `getKeyFingerprint` stability. `crypto.ts` previously had zero direct unit tests (only indirect coverage via backup tests).

## v0.27.1 - 2026-04-14

Six data-safety fixes from the deep audit.

### Fixed

- `analyze.ts` now uses `Promise.allSettled` over listening sources instead of `Promise.all`. A single flaky Last.fm / ListenBrainz / Spotify call no longer aborts the entire pipeline run. Activity merge is deterministic (first fulfilled source wins).
- Pipeline `store` adds optional `upsertArtistAndRecommendation` to `StoreDb`. Production wiring runs artist upsert and recommendation insert inside a single DB transaction, so a crash in the middle no longer leaves an orphan artist row.
- Backup restore (`POST /api/admin/restore`) no longer swallows errors into `warnings[]`. Errors bubble up; the admin route returns HTTP 500 instead of 200-with-empty-`tablesRestored`, so silent restore failures are no longer possible.
- `artistMetadata.bulkUpsert` and `recordingArtistCache.insertCachedRecordingArtists` chunk at 5000 rows. The prior single-INSERT path crashed above ~9362 rows due to Postgres's 65535 bind-parameter ceiling.
- `!Number.isFinite(id)` guards added on `batches/:id`, `recommendations/:id` (2 handlers), `subscriptions/:id` (4 handlers), and `targets/:id` (3 handlers). Bad IDs now return 400 instead of 500, matching the pattern already in place for `artists/:id`, `jobs/:id`, and `users/:id`.

### Added

- `DbOrTx` type in `src/db/index.ts` so query helpers can accept either `Database` or an in-flight Drizzle transaction. Used by `upsertArtist` and `insertRecommendation`.

## v0.27.0 - 2026-04-14

### Security

- `trivy-version: "0.69.3"` pinned on both `trivy-fs` and `trivy-image` scan steps in `.github/workflows/security.yml`. `aquasecurity/trivy-action@v0.35.0` previously resolved the latest trivy binary at runtime and was not pinned, which exposed the workflow to the compromised trivy v0.69.4-v0.69.6 releases distributed during the 2026-03-19 to 2026-03-23 window (CVE-2026-33634, credential-stealing malware). `security.yml` ran ~100 times during that window; `DOCKERHUB_TOKEN` and any other secrets exposed to those runs should be rotated as a precaution.

## v0.26.7 - 2026-04-14

### Fixed

- Legacy shared-token auth can no longer write user locale, password, or preference settings that are meant for session-authenticated users only
- Docker, Helm, raw Kubernetes, CI, and issue-template defaults were audited and brought back in line with the current release surface

### Changed

- Top-level docs and roadmap docs were tightened to reduce duplicated release detail and point readers at the changelog for per-release history
- Dev helper scripts were simplified and cleaned up for more predictable local setup and teardown behavior

## v0.26.6 - 2026-04-14

### Fixed

- Backup restore now resets serial sequences after replaying explicit row ids, so later inserts do not fail with duplicate-key errors
- User identity lookups now enforce unique non-null email and OIDC subject values at the database level
- Linked `slskd` workers now accept Lidarr's paginated wanted-release payloads instead of assuming a top-level array, fixing repeated sync failures against current Lidarr builds

## v0.26.5 - 2026-04-13

### Fixed

- Large library syncs now batch `library_artists` and `library_albums` inserts instead of sending a single oversized statement that can exceed database host-parameter limits
- Library sync batching now sizes inserts against SQLite-compatible parameter ceilings so the write path stays safe across current and future database backends

## v0.26.4 - 2026-04-13

### Fixed

- Remaining shared UI forms, dialogs, and admin surfaces now use locale catalogs instead of hardcoded English copy
- Settings and subscription server errors now resolve through the active request locale instead of leaking raw English into localized screens
- Shipped locale catalogs now pass stricter translation-quality checks, including same-as-English detection and corrected native orthography for languages that use accents or diacritics

## v0.26.3 - 2026-04-13

### Changed

- Settings now exposes `Job History` and `System Health` as first-class tabs in the shared settings shell, and the dashboard no longer carries the full system-health block at the top
- Settings > Targets now mirrors the connections-style admin controls more closely, including inline editing, enabled/shared state, linked Lidarr context, and visible test results

### Fixed

- Discover > Subscriptions now uses the same content width as the other primary app pages
- Library Health now persists the latest scan snapshot, shows last-sync timing, auto-rescans on the configured library-sync interval, and keeps a manual `Sync Now` action
- Jobs health now includes library-sync status so the new system-health tab can surface it alongside pipeline, subscription, playlist, and source state
- Fresh databases now skip pre-migration auto-backups until the app tables exist, avoiding noisy startup warnings during first boot and Playwright setup

## v0.26.2 - 2026-04-13

### Fixed

- Completing setup no longer leaves the app in an unauthenticated zero-user state; public setup routes still work, but registration or login is required once setup is finished
- Settings now preserve unset secrets instead of masking them as saved credentials, so service status no longer shows false connected states
- Settings now show Deezer and Emby service icons, and more admin-facing copy is routed through shipped locale keys

### Changed

- README multilingual docs now list all shipped languages and note that translations are machine-generated pending community fixes
- API docs, roadmap notes, and both CI pipelines were updated to match the current setup and i18n checks

## v0.26.1 - 2026-04-13

### Fixed

- Shipped ListenBrainz radio modes no longer appear as "not shipped yet", and unavailable cards now explain why they are blocked
- Manual discovery-mode runs now return a `jobId` immediately, so the UI can track the accepted job instead of showing a blind success toast
- ListenBrainz Artist Radio now resolves artist-name seeds to MusicBrainz IDs before the run is accepted, so invalid free-text seeds fail up front instead of dying silently in the background
- Discovery-run feedback now surfaces quick job failures to the user instead of only logging them server-side
- Discovery-mode availability reasons now fall back to the original message when a locale-specific alias is missing

## v0.26.0 - 2026-04-13

### Changed

- Discovery Modes now live on their own page under the Discover menu, keeping the main Discover view focused on recommendation review

## v0.25.0 - 2026-04-13

### Added

- Settings > Targets now supports creating `slskd` download targets, including an optional linked Lidarr target for combined approvals
- Linked `slskd` targets now run a background wanted-release worker with import-verified completion, plus admin sync and active-job endpoints

### Fixed

- Combined `slskd` approvals can now target an explicit Lidarr destination instead of guessing when multiple Lidarr targets exist
- Recommendation cards now surface partial target failures when Lidarr succeeds but the follow-up `slskd` step fails

## v0.24.4 - 2026-04-12

### Fixed

- Discovery mode cards, field labels, availability notices, and monitoring options now use the active locale across all shipped languages
- Job and system health "last run" relative times now follow the active locale instead of always showing English `ago`

## v0.24.3 - 2026-04-12

### Fixed

- Stored API tokens are now validated against an authenticated auth endpoint instead of the public setup status route
- Recommendation approval and export routes now reject invalid `batchId` values, and approval to an unknown target now returns a clear `400` instead of a false success
- Non-admin users can no longer save private or internal Plex, Jellyfin, or Emby URLs that would later be used for server-side requests
- OIDC connection tests are now admin-only and reject private or internal issuer URLs

### Changed

- OpenAI and OpenAI-compatible providers now share the same wrapped JSON response unwrapping helper
- README, API docs, contributing notes, and screenshots were refreshed to match the current setup and integration surface

## v0.24.2 - 2026-04-12

### Fixed

- Translate all remaining hardcoded English strings across 12 UI areas (settings admin, search reasons, mood bar, genre cards, service status, job history, album coverage, integration table, analytics sources)
- Add proper translations for all 89 new keys across all 15 supported languages

## v0.24.1 - 2026-04-12

### Fixed

- Translate all hardcoded English strings across the main UI surfaces (navigation, dashboard, discover, settings, analytics, job history, playlists, subscriptions, setup wizard, search, genre detail, library health, user management)

## v0.24.0 - 2026-04-12

### Added

- **Tag Radio discovery mode** (`lb-tag-radio`): discover artists by genre/style tags via ListenBrainz radio. Supports multiple tags with per-tag weights, raw LB syntax, and popularity filtering.
- **Tag Radio subscription feed**: recurring tag-based artist discovery via the ListenBrainz adapter.
- **Recording-artist cache**: persistent cache for MusicBrainz recording-to-artist lookups, improving performance on repeat tag radio runs.

## v0.23.0 - 2026-04-12

### Added

- Artist Radio discovery mode seeded from any artist via ListenBrainz radio API
- User Radio discovery mode that generates radio from a user's top listened artist
- Similar Users (Deep) discovery mode that samples top artists from taste-matched ListenBrainz users
- Artist Radio and Similar Users subscription feed types for scheduled ListenBrainz discovery
- Renamed existing Similar Users mode to Similar Users (Quick) for clarity

## v0.22.0 - 2026-04-12

### Added

- Deezer OAuth2 connect flow with server-side credentials (DEEZER_APP_ID / DEEZER_APP_SECRET)
- Authenticated Deezer data sources: favorites, followed artists, Flow recommendations, and playlist import
- Deezer subscription adapter with four feed types for scheduled discovery
- One-click import buttons for Deezer favorites and followed artists on the Settings page
- Integration capabilities table on the Settings Connections tab and in the README
- 19 new i18n keys across all 15 locales for Deezer UI and subscription feeds

## v0.21.1 - 2026-04-12

### Fixed

- Locale catalogs now read naturally across the shipped languages instead of leaving large English fallback blocks in genre browsing, job history, library reconciliation, and common UI actions
- Register and voice are more consistent across translations, including Romanian formal UI copy and less literal machine-translated wording in multiple locales
- Translation copy around pull-to-refresh, queueing, playlist actions, and "you're all caught up" states now fits the app context better across languages

## v0.21.0 - 2026-04-11

### Added

- Broad multilingual UI support across 15 shipped locales, with visible language switchers before and after login
- Persisted per-user locale preference plus localized auth, setup, dashboard, discover, settings, analytics, subscriptions, and library surfaces
- Translation maintenance tooling and browser coverage for language switching and localized flows

### Fixed

- Manual full scans now propagate the resolved UI locale into AI discovery, so generated reasoning matches the active interface language
- Interactive discovery requests now prefer the explicit request locale over stale saved locale state, so immediate language switches do not leak old-language AI output

### Changed

- AI-assisted discovery now separates `promptLocale` from `responseLocale`, so mood and quick-discover prompts can stay language-aware while the returned reasoning follows the selected UI locale
- Translation catalogs are now explicit and complete per locale instead of silently inheriting missing keys from English

## v0.20.4 - 2026-04-11

### Fixed

- Settings preference updates now merge partial values safely instead of dropping stored defaults or restarting schedulers on unrelated saves
- Backup restore now recreates the backed-up state cleanly by clearing included tables before re-importing data
- Similar Artist subscriptions now respect the configured result limit consistently
- Setup no longer exposes pre-auth connection-test routes, OIDC only auto-links verified emails, and private-host webhook guards now catch IPv4-mapped IPv6 bypasses

### Changed

- Playlist target matching now uses a shared scoring helper across Plex, Jellyfin, and Emby
- README, contributing guidance, Synology docs, screenshots, and roadmap text were tightened for clarity and release accuracy

## v0.20.3 - 2026-04-11

### Added

- Discovery modes on the dedicated `/discover/modes` page, with runnable ListenBrainz, Release Radar, and Similar Artist Web flows
- Discovery-mode subscriptions that reuse the existing subscription runner, scheduler, job history, and browser coverage

### Fixed

- Manual discovery-mode runs now return immediately with a 202 response instead of blocking on the full run
- Discovery-mode routes now reject unavailable modes explicitly instead of allowing silent no-op runs
- Discovery-mode subscriptions now persist the selected provider/fallback execution context so scheduled runs match the manual form

### Changed

- Labels and Artist Relationships remain visible in the discovery-mode catalog, but are explicitly marked unavailable until they have real executors
- Release Radar no longer exposes the unused `includeReissues` toggle
- README, API docs, and roadmap docs are aligned with the shipped discovery-mode surface

## v0.20.2 - 2026-04-10

### Fixed

- Search and job API query validation now match the documented contract, including limits, offsets, and allowed job types
- Query-token auth is now limited to the documented SSE and preview-audio endpoints
- Playlist ordering now follows stored track positions consistently

### Changed

- CI now separates mocked API route contract tests from browser E2E coverage, and the browser suite runs against an isolated Playwright database
- PostgreSQL pool sizing and SSL behavior can now be configured explicitly through environment variables
- Hot recommendation, playlist, subscription, target, and session query paths now have supporting indexes, and older migrations are safer to re-run

## v0.20.1 - 2026-04-09

### Fixed

- Emby and Jellyfin connection tests now validate the configured user library scope instead of only checking server info
- Playlist export to Emby and Jellyfin now respects TLS-skip settings, and Emby track matching prefers exact title and artist hits
- Metadata fallback HTTP requests now block redirects, reject private hosts at request time, and keep no-content delete responses typed honestly

### Changed

- Provider and admin config typing is stricter at shared boundaries
- API, README, roadmap, and issue template docs are aligned with shipped Emby support and local tooling rules

## v0.20.0 - 2026-04-09

### Added

- Emby media server support with library sync and playlist push capabilities
- Per-user Emby connection management in setup wizard
- Emby album coverage and reconciliation features

### Changed

- Updated Helm chart version alignment with app version
- Improved library sync robustness for all media server types

## v0.19.2 - 2026-04-09

### Changed

- Listening sources (ListenBrainz, Last.fm) are now scoped to individual users instead of shared global settings

### Fixed

- Settings route tests no longer hit public ListenBrainz and Last.fm APIs, fixing a flaky 5s timeout that blocked the v0.19.1 release build

## v0.19.0 - 2026-04-09

### Added

- Album coverage service and API surface, with persistent album overrides
- Album coverage badge on recommendation cards showing owned/missing counts
- Unreconciled album rows in the library reconciliation review
- Album sync coverage summary in the admin Library Sources panel

### Changed

- Helm chart version now tracks the app version (single number per release)

## v0.18.0 - 2026-04-08

### Added

- Album-level library sync for Lidarr, Plex, and Jellyfin
- Per-source album sync counts in the admin Library Sources panel
- MusicBrainz-backed album reconciliation during library sync

### Changed

- Library sync writes artist and album snapshots atomically to avoid partial source updates

## v0.17.1 - 2026-04-08

### Fixed

- Playlist-only approval targets now work correctly

## v0.17.0 - 2026-04-07

### Added

- Plex and Jellyfin library sync alongside Lidarr
- Library reconciliation review with correct and ignore override flows
- Library sync status surfaces in the admin UI and setup wizard

### Changed

- Pipeline and quick-discover flows can use the library cache when available

## v0.16.0 - 2026-04-06

### Added

- Admin job history and health endpoints for pipeline, subscription, target, and playlist work
- API route tests, Playwright browser tests, and CI gates for critical workflows
- Application-level backup and restore with encrypted field handling

### Changed

- Startup now performs a pre-flight migration check and auto-backup before applying schema changes

## v0.15.0 - v0.15.5 - 2026-04-04

### Added

- Data hygiene tools for genre rebuilds, rescoring, dedupe repair, AI reasoning audit, and session cleanup

### Fixed

- Security and resilience hardening across auth, backup/restore, scoring, webhooks, and deployment manifests
