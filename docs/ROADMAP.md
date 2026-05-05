# Roadmap

> Updated: 2026-05-05 | Current: v1.0.0-rc.2
>
> Priorities change with feedback. This is current intent, not a promise.

## Where We Are

All five v1 exit criteria now pass. Digarr is feature-complete for a v1 release, and the first full library-sync stack is now shipped across Lidarr, Plex, Jellyfin, Emby, and slskd. Multilingual support is fully shipped: all UI strings are translated across 15 locales, and AI-assisted discovery output follows the user's selected language. Deezer OAuth connect with four authenticated data sources (favorites, followed, Flow, playlists) shipped in v0.22.0. Discovery mode expansion is nearly complete: the currently runnable modes are ListenBrainz (Artist Radio, User Radio, Tag Radio, Similar Users Quick/Deep), Release Radar, and Similar Artist Web, now surfaced from Discover -> Discovery Modes instead of embedded on the main Discover page. Labels and Artist Relationships remain planned and stay visible there as unavailable cards with explicit blocking reasons until they have real integrations. Manual discovery-mode runs now preflight Artist Radio seeds and appear in Jobs as soon as the backend accepts them, so fast failures are no longer silent. Current focus is the remaining two discovery modes, download-target breadth, and UX polish around review and playback.

## v1 Goals

### New User Can Reach First Value - Pass

Setup wizard, Spotify playlist import, CSV import, and guided empty states get new users to their first recommendations without friction.

### Core Discovery Is Resilient - Pass

External source failures degrade gracefully. Image and metadata fallbacks cover the major fragile paths. The app gives useful results even when Spotify is unavailable.

### Operators Have Safety Rails - Pass

Backup/restore, pre-flight migration checks, auto-backup before upgrades, and data hygiene repair tools are all in place.

### Background Work Is Observable - Pass

Admin job tracking surface with health endpoint, run history, stuck-task detection, and actionable error messages.

### Critical Workflows Have Release Protection - Pass

End-to-end browser test suite (Playwright) covering setup, login, scan, approve/reject, discovery modes, subscriptions, and playlists. CI gates on critical workflow failures.

## Planned

Committed direction, roughly in priority order.

### Discovery

- Label-catalog discovery mode implementation
- Artist-relationship discovery mode implementation

### UX

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
- Native desktop client (Linux/Mac/Windows) - PWA install already covers most of this
- Native mobile apps (Android/iOS) - PWA is already installable; native value is mostly reliable push notifications

## Shipped Highlights

For release-by-release detail, see [CHANGELOG.md](../CHANGELOG.md).
Release reminder: after publishing a new app image, update the pinned digests in `deploy/k8s/deployment.yaml`, `deploy/helm/digarr/values.yaml`, and `deploy/unraid/digarr.xml`.

- Discovery modes now live on their own page, ship ListenBrainz radio coverage plus Release Radar and Similar Artist Web, and can be saved as subscriptions
- Permanent per-user artist blocking and structured rejection reasons shipped in v0.44.0, with a Settings > Blocked management tab and blocklist filtering across pipeline, subscriptions, and quick-discover
- Multilingual support is fully shipped across 15 locales, including locale-aware AI output and stricter translation-quality checks
- Library operations now cover Lidarr, Plex, Jellyfin, Emby, and `slskd`, with artist and album sync, reconciliation review, persistent Library Health snapshots, and better sync visibility
- Operations and safety now include backup/restore, pre-flight migration checks, auto-backups, job history, stuck-task detection, and browser-test release gates
- Integration work added Deezer OAuth feeds, Emby support, linked `slskd` targets, and broader playlist export coverage
- TheAudioDB is now the primary artist-image source ahead of the Lidarr/SkyHook + fanart.tv + musicinfo.pro chain, with a token-bucket rate limiter and an optional SSRF-guarded image proxy. Recommendation cards expose a Wikidata-sourced artist description and external-link pills (Wikipedia, official site, Discogs, MusicBrainz), cached per locale
- API surface migrated to `/api/v1/*` with mutation routes returning `204 No Content`, probe failures expressed as HTTP status plus `application/problem+json`, and cursor pagination on six list endpoints. Old `/api/*` paths 308-redirect with `Deprecation` and `Sunset` headers through 2026-07-19
- Deep-audit remediation closed across 13 phases (v0.27.x through v0.40.x): auth-surface hardening and first-admin guards, full SSRF sweep including NAT64/Teredo and outbound IP pinning, pipeline isolation with atomic writes, DB index and upsert fixes, dual-key encryption rotation, Kubernetes PSS-restricted with dedicated SA and PDB, Docker hardening with BuildKit cache, cosign keyless signing plus SLSA v1.0 provenance via Sigstore OIDC, Zod validation on every write route, AI provider reliability (Anthropic prompt caching, retry/backoff, Zod-validated outputs, promptfoo eval gate), i18n completeness at 15 locales, component-test plus E2E plus a11y coverage hitting WCAG AA contrast, and a docs/architecture sweep with release-surface consolidation

Release-level detail lives in [CHANGELOG.md](../CHANGELOG.md); this doc keeps
the feature-level summary and the upcoming milestones only.
