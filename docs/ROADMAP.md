# Roadmap

> Updated: 2026-09-19 | Current: v1.17.0
>
> Priorities change with feedback. This is current intent, not a promise.

## Current release

v1.17.0 adds SSO linking for existing local accounts and support for MusicBrainz mirrors. It fixes incomplete Emby syncs, preserves library snapshots after album-fetch failures, and reports playlist export failures. Spotify exports preserve the selected tracks.

Digarr already supports artist and album recommendations, scheduled discovery, playlists, multi-user accounts, and library sync with Lidarr, Plex, Jellyfin, Emby, and Subsonic. The interface and AI discovery output support 15 languages. Current work focuses on review, library operations, and connection reliability.

## Development channel

Available in `:nightly`, pending a tagged release:

- Plex listening history with a per-user listener selection. Shared-library sync works independently.
- Audition playlists with one resolved track per pending artist, generated on demand or on a schedule.
- Plex playlist export and saved-target connection-test fixes.
- slskd search and retry fixes, complete-release checks, and verified Lidarr imports. Linked targets require a completed-download path visible to Lidarr.

See [Unreleased](../CHANGELOG.md#unreleased) for details.

## Known integration limitation

TIDAL Favorite Artists is experimental. Authorization, refresh, and favorite-artist retrieval have not been tested with a live account. This is an accepted release limitation, with [community testing requested](../README.md#tidal-feedback). The Experimental badges stay until these flows are verified.

## Exploring

Ideas we're considering. If any of these matter to you, open an issue or discussion.

### Discovery

- Contextual discovery-mode presets
- Additional graph-based discovery modes

### Integrations

- Odesli / song.link resolution
- Apple Music / iTunes metadata enrichment

## Future

Good ideas with no timeline yet.

- Taste DNA / shareable profile
- Interactive API docs (Swagger/Scalar UI)

## Experiments

Low confidence. Would build only with real demand.

- Festival lineup scanner
- Blended household discovery / party mode
- Playback-behavior feedback loop
- Listening-history time analysis
- Human-curated subscription sources
- Beatport discovery (electronic music)
- Social / collaborative discovery
- Advanced analytics export
- Navidrome WASM plugin
- TUI client (terminal UI for discovery and approval)
- Native desktop client (Linux/Mac/Windows) - PWA install already covers most of this
- Native mobile apps (Android/iOS) - PWA is already installable; native value is mostly reliable push notifications

## Release history

[CHANGELOG.md](../CHANGELOG.md) records shipped changes by version. Release automation opens a deployment-pin update after publishing an image; maintainers review and merge it before treating those examples as updated.
