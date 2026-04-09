# Changelog

All notable user-facing changes are documented here.

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
- API smoke tests, Playwright browser tests, and CI gates for critical workflows
- Application-level backup and restore with encrypted field handling

### Changed

- Startup now performs a pre-flight migration check and auto-backup before applying schema changes

## v0.15.0 - v0.15.5 - 2026-04-04

### Added

- Data hygiene tools for genre rebuilds, rescoring, dedupe repair, AI reasoning audit, and session cleanup

### Fixed

- Security and resilience hardening across auth, backup/restore, scoring, webhooks, and deployment manifests
