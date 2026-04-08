# Changelog

All notable user-facing changes are documented here.

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
