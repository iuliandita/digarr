# Roadmap

> Updated: 2026-04-14 | Current: v0.26.7
>
> Priorities change with feedback. This is current intent, not a promise.

## Where We Are

All five v1 exit criteria now pass. Digarr is feature-complete for a v1 release, and the first full library-sync stack is now shipped across Lidarr, Plex, Jellyfin, Emby, and slskd. Multilingual support is fully shipped: all UI strings are translated across 15 locales, and AI-assisted discovery output follows the user's selected language. Deezer OAuth connect with four authenticated data sources (favorites, followed, Flow, playlists) shipped in v0.22.0. Discovery mode expansion is nearly complete: the currently runnable modes are ListenBrainz (Artist Radio, User Radio, Tag Radio, Similar Users Quick/Deep), Release Radar, and Similar Artist Web, now surfaced from Discover -> Discovery Modes instead of embedded on the main Discover page. Labels and Artist Relationships remain planned and stay visible there as unavailable cards with explicit blocking reasons until they have real integrations. Manual discovery-mode runs now preflight Artist Radio seeds and appear in Jobs as soon as the backend accepts them, so fast failures are no longer silent. Current focus is the remaining two discovery modes, download-target breadth, and UX polish around review and playback.

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

End-to-end browser test suite (Playwright) covering setup, login, scan, approve/reject, discovery modes, subscriptions, and playlists. CI gates on critical workflow failures.

## Planned

Committed direction, roughly in priority order.

### Discovery

- Label-catalog discovery mode implementation
- Artist-relationship discovery mode implementation

### UX

- Permanent artist blacklist ("never show again" beyond cooldown)
- Rejection reasons
- Preview volume control

## Exploring

Ideas we're considering. If any of these matter to you, open an issue or discussion.

### Discovery

- Genre extraction from listening data (for non-library installs)
- Deeper listening-source data (Spotify saved albums, TIDAL favorites, Deezer flow)
- Contextual discovery-mode presets
- Additional graph-based discovery modes

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

## Shipped Highlights

For release-by-release detail, see [CHANGELOG.md](../CHANGELOG.md).
Release reminder: after publishing a new app image, update the pinned digests in `deploy/k8s/deployment.yaml` and `deploy/helm/digarr/values.yaml`.

- Discovery modes now live on their own page, ship ListenBrainz radio coverage plus Release Radar and Similar Artist Web, and can be saved as subscriptions
- Multilingual support is fully shipped across 15 locales, including locale-aware AI output and stricter translation-quality checks
- Library operations now cover Lidarr, Plex, Jellyfin, Emby, and `slskd`, with artist and album sync, reconciliation review, persistent Library Health snapshots, and better sync visibility
- Operations and safety now include backup/restore, pre-flight migration checks, auto-backups, job history, stuck-task detection, and browser-test release gates
- Recent integration work added Deezer OAuth feeds, Emby support, linked `slskd` targets, and broader playlist export coverage

### v0.25.0

- Settings > Targets now supports creating `slskd` download targets, including an optional linked Lidarr target for combined approvals
- Linked `slskd` targets now run a background wanted-release worker with import-verified completion, plus admin sync and active-job endpoints

### v0.23.0

- Deeper ListenBrainz radio discovery: Artist Radio, User Radio, and Similar Users (Deep) modes
- Artist Radio and Similar Users subscription feed types for scheduled LB discovery
- Existing Similar Users mode renamed to Similar Users (Quick)

### v0.22.0

- Deezer OAuth2 connect flow and four authenticated data sources (favorites, followed, Flow, playlists)
- Deezer subscription adapter for scheduled discovery from Deezer feeds
- Integration capabilities table on Settings and README

### v0.21.0

- Broad multilingual UI support across 15 shipped locales, with remaining long-tail copy cleanup tracked as follow-up work
- Visible pre-login and authenticated language switchers with persisted per-user locale preference
- Localized auth/setup flows, high-traffic pages, and locale-aware AI reasoning for mood discovery, quick discover, and full scans
- Translation maintenance scripts, strict locale-catalog completeness checks, and browser coverage for language switching

### v0.20.3

- Discovery modes on the dedicated `/discover/modes` page, with runnable executors for ListenBrainz, Release Radar, and Similar Artist Web
- Labels and Artist Relationships now marked unavailable until they have real implementations
- Save discovery mode forms as subscriptions for recurring runs
- Discovery-mode runs and subscriptions now enforce availability server-side and keep the selected provider/fallback execution path
- Browser coverage for manual discovery-mode runs and discovery-mode subscription creation

### v0.20.2

- Tightened API contract validation for search, jobs, and query-token auth paths
- Split mocked API route tests from browser E2E coverage and isolated Playwright runs on a dedicated database
- Added DB pool controls, hot-path indexes, and replay-safe guards for older migrations

### v0.20.1

- Hardened outbound metadata fallback requests against redirects and private-host SSRF paths
- Fixed Emby and Jellyfin connection tests to validate configured user access
- Carried TLS skip settings through playlist export paths and tightened docs around shipped support

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
