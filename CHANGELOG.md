# Changelog

All notable user-facing changes are documented here.

## Unreleased

## v0.26.0 - 2026-04-13

### Changed

- Discovery Modes now live on their own page under the Discover menu, keeping the main Discover view focused on recommendation review

### Fixed

- Shipped ListenBrainz radio modes no longer appear as "not shipped yet", and unavailable cards now explain why they are blocked
- Manual discovery-mode runs now return a `jobId` immediately, so the UI can track the accepted job instead of showing a blind success toast
- ListenBrainz Artist Radio now resolves artist-name seeds to MusicBrainz IDs before the run is accepted, so invalid free-text seeds fail up front instead of dying silently in the background
- Discovery-run feedback now surfaces quick job failures to the user instead of only logging them server-side

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

- Full multilingual UI support across 15 shipped locales, with visible language switchers before and after login
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
