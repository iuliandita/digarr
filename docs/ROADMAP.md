# Roadmap

> Updated: 2026-04-09 | Current: v0.20.0
>
> Priorities change with feedback. This is current intent, not a promise.

## Where We Are

All five v1 exit criteria now pass. Digarr is feature-complete for a v1 release. Current focus is on refining the shipped media-server support and expanding discovery integrations.

## v1 Goals

### New User Can Reach First Value -- Pass

Setup wizard, Spotify playlist import, CSV import, and guided empty states get new users to their first recommendations without friction.

### Core Discovery Is Resilient -- Pass

External source failures degrade gracefully. Image and metadata fallbacks cover the major fragile paths. The app gives useful results even when Spotify is unavailable.

### Operators Have Safety Rails -- Pass

Backup/restore, pre-flight migration checks, auto-backup before upgrades, and data hygiene repair tools are all in place.

### Background Work Is Observable -- Pass

Admin job tracking surface with health endpoint, run history, stuck-task detection, and actionable error messages.

### Critical Workflows Have Release Protection -- Pass

End-to-end browser test suite (Playwright) covering setup, login, scan, approve/reject, subscriptions, and playlists. CI gates on critical workflow failures.

## Planned

Committed direction, roughly in priority order.

### Discovery

- Deezer favorites import
- Deeper ListenBrainz integration (weekly jams, radio, fresh releases, similar users)

### Integrations

- slskd / Soulseek as a download target

### UX

- Permanent artist blacklist ("never show again" beyond cooldown)
- Rejection reasons
- Preview volume control

## Exploring

Ideas we're considering. Feedback welcome -- open an issue or discussion if any of these matter to you.

### Discovery

- Release radar / genre-scoped new releases
- Label-based discovery
- Artist relationship discovery
- Genre extraction from listening data (for non-library installs)
- Deeper listening-source data (Spotify saved albums, TIDAL favorites, Deezer flow)
- music-map.com as a similar-artist source

### Integrations

- Prowlarr integration
- Odesli / song.link resolution
- Apple Music / iTunes metadata enrichment

### UX

- Contextual / seasonal discovery presets
- Notification digest

## Future

Good ideas with no timeline yet.

- Album-level discovery (not just artists)
- Taste DNA / shareable profile
- Audition playlists ("try before you add")
- Interactive API docs (Swagger/Scalar UI)
- Multi-language UI (translated static strings, AI translation for dynamic content)

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
- Native desktop client (Linux/Mac/Windows) -- PWA install already covers most of this
- Native mobile apps (Android/iOS) -- PWA is already installable; native value is mostly reliable push notifications

## Recently Shipped

### v0.20.0

- Emby support for library sync and playlist push
- Setup wizard Emby connection flow with auto-created playlist target

### v0.19.0 -- v0.19.2

- Per-user listening source connections (ListenBrainz, Last.fm) instead of shared globals
- Hermetic settings route tests that no longer depend on public external APIs

### v0.18.0 -- v0.19.0

- Album coverage service and API with persistent album overrides
- Album coverage badge on recommendation cards
- Unreconciled album rows in library reconciliation review
- Album sync coverage summary in the admin Library Sources panel
- Helm chart version aligned with app version

### v0.17.0 -- v0.18.0

- Album-level library sync for Lidarr, Plex, and Jellyfin
- Per-source album sync counts in the admin Library Sources panel
- Atomic artist+album snapshot writes for source syncs
- Album reconciliation pipeline with MusicBrainz release-group matching

### v0.16.0 -- v0.17.0

- Plex and Jellyfin library sync
- Reconciliation review page with correct/ignore actions and rerun support
- Setup wizard first-sync guidance and admin library sources/status surface
- Library-aware pipeline integration with regression, integration, and browser coverage

### v0.15.0 -- v0.16.0

- Background job tracking with admin UI, health endpoint, and stuck-task detection
- E2E browser test suite (Playwright) with CI gates
- Backup and restore (atomic, encrypted, natural-key upserts)
- Upgrade safety: pre-flight migration check, auto-backup, keeps last 5
- Data hygiene tools: rebuild genres, re-score, dedupe repair, AI audit, purge sessions
- Security hardening (two full audit rounds)
- API docs: rate limits, OIDC notes, decades query param

### v0.13.0 -- v0.14.0

- Spotify playlist one-click import
- Generic CSV artist import (flexible column detection, up to 500 artists)
- Reworked pipeline progress with stage descriptions, elapsed timer, stall detection
- Improved empty states across Dashboard, Discover, Subscriptions
- Decade filtering moved server-side
- Unified audio playback (preview + top tracks never overlap)
- PWA install prompt
- Artist image fallback chain (Lidarr -> fanart.tv -> musicinfo.pro)
- Deezer track resolution for auto-playlists
- Preview proxy with rate limiting and SSRF protection

### Earlier Highlights

- Era/decade filtering, top tracks on cards, mood discovery
- OIDC/SSO authentication, per-user credentials, reverse proxy auth
- Multi-arch Docker images, Docker Hub, Unraid template
- API reference, Synology guide, Docker Desktop guide
