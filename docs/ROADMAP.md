# Roadmap

> Updated: 2026-07-15 | Current: v1.13.0
>
> Priorities change with feedback. This is current intent, not a promise.

## Where We Are

All five v1 exit criteria now pass. Digarr is feature-complete for a v1 release, and the first full library-sync stack is now shipped across Lidarr, Plex, Jellyfin, Emby, and Subsonic; slskd is a separate approval and acquisition target. Multilingual support is fully shipped: all UI strings are translated across 15 locales, and AI-assisted discovery output follows the user's selected language. Deezer OAuth connect with four authenticated data sources (favorites, followed, Flow, playlists) shipped in v0.22.0. Discovery mode expansion is complete: the runnable modes are ListenBrainz (Artist Radio, User Radio, Tag Radio, Similar Users Quick/Deep), Release Radar, Library Gap-Fill, Similar Artist Web, Artist Relationships (MusicBrainz collaboration/membership/alias graph), Labels (co-label artists via Discogs), Charts (global/regional chart movement via Last.fm), Deezer Flow (the personalized Deezer artist feed), Spotify Saved Albums (artists from the albums you saved on Spotify), and Subsonic Starred (artists similar to the ones you starred on your Subsonic server), all surfaced from Discover -> Discovery Modes instead of embedded on the main Discover page. Manual discovery-mode runs preflight Artist Radio seeds and appear in Jobs as soon as the backend accepts them, so fast failures are no longer silent. Album-level discovery substrate shipped in v1.0.0: albums are a first-class recommendation unit with a `kind` discriminator, album blocks, an album scoring modifier, single-album Lidarr approval (`addAlbum`), a kind filter and Albums nav on Discover, and full i18n. All three producers are now live: release-radar new-release discovery (v1.1.0) emits `kind='album'` recommendations for new releases from artists you already track, Library Gap-Fill (v1.2.0) recommends the studio albums you are missing from those same tracked artists, and net-new album discovery (v1.3.0) promotes a specific album the AI suggests by a new-to-you artist into a first-class album recommendation, gated behind a default-off toggle. Release-radar now surfaces all new releases per artist in a single scan. Current focus is notification-channel expansion and product polish around review and library operations.

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

### Recommendation quality and UX

- UX polish around recommendation review, playback, and library operations

## Exploring

Ideas we're considering. If any of these matter to you, open an issue or discussion.

### Discovery

- Deeper listening-source data (TIDAL favorites; Spotify saved albums shipped in v1.9.0)
- Contextual discovery-mode presets
- Additional graph-based discovery modes

### Integrations

- Additional notification channels beyond Discord-formatted and generic JSON webhooks
- Odesli / song.link resolution
- Apple Music / iTunes metadata enrichment

## Future

Good ideas with no timeline yet.

- Taste DNA / shareable profile
- Audition playlists ("try before you add") -- the artist-level audition queue is shipped (see Shipped Highlights); a track-level playlist variant is still open
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
Release reminder: after publishing a new app image, run `bun scripts/sync-deploy-digests.ts <tag>` -- it rewrites the pinned digests and version tags across the k8s/Helm/Unraid deploy files plus the example pins in the compose files and README.
v1.13.0 packages the current `develop`/`:nightly` highlights below.

- v1.13.0 adds an Audition queue for continuous preview playback: an Audition button on the Discover toolbar queues the loaded pending recommendations that have previews, in score order; the global preview bar gains previous/next and position controls. Deezer advances when its clip ends, Spotify reuses a persistent supported iframe controller and advances only after real playback completes, and YouTube retains a bounded 30-second fallback. If a browser blocks Spotify autoplay, the queue stays on the current usable embed instead of silently advancing; once manually activated, later Spotify entries reuse the same controller. Preview-less items are skipped, and playing anything else or stopping deactivates the queue. Artist-level v1 ("try before you add"). Full i18n across 15 locales
- The scheduled notification digest now persists a last-sent bookmark, so restarts or downtime no longer double-report or drop a window; delivery is at-least-once
- Discover can reject every loaded pending recommendation below a chosen score threshold in one reviewed action, while preserving higher-scored candidates for normal review
- Cross-provider search now includes experimental TIDAL results when an admin configures TIDAL client credentials; unconfigured installs keep the source disabled
- AI provider failures are now first-class observable (v1.12.0): a dead provider surfaces in scan progress warnings, job history records the real provider error, connection-test failures show the upstream message, and saving AI settings re-probes the persisted config. Provider hardening landed alongside: shared LLM output parsing for OpenAI/Gemini, secret redaction in error snippets, and Ollama model validation in test connection
- Zero-external-database operation shipped in v1.11.0: embedded PGlite backend (no separate PostgreSQL container), an admin-gated in-app migration tool between PGlite and PostgreSQL with verified atomic copy, a Subsonic (Navidrome/Airsonic/Gonic) listening + library source, self-service account email, and an OIDC account-takeover fix (subject-only identity matching, GHSA-w643-583p-vm6m)
- Album-level discovery substrate shipped in v1.0.0: albums are a first-class recommendation unit (`kind` discriminator on recommendations, `album_blocks` forever-block layer, album scoring modifier, `addAlbum` single-album Lidarr approval, kind filter + Albums nav on Discover, full i18n across 15 locales). All three producers now populate it with `kind='album'` recommendations: the release-radar new-release producer (v1.1.0) for new releases from tracked artists, Library Gap-Fill (v1.2.0) for the studio albums you are missing from those tracked artists, and net-new album discovery (v1.3.0) for a specific album the AI suggests by a new-to-you artist, gated behind a default-off toggle. Release-radar now surfaces all new releases per artist in a single scan. The empty Albums view explains that normal scans remain artist-focused and links directly to all three album-producing paths.
- Scheduled notification digest: alongside the per-batch webhook, a periodic roll-up of recent activity (discovered/added/runs) on a user-set cron schedule, configured in Settings, applied at runtime without a restart, reusing the existing SSRF-protected webhook + Discord formatting, full i18n across 15 locales (v1.10.0)
- Subsonic Starred is now a runnable discovery mode: your starred Subsonic artists seed similar-artist recommendations on demand from Discover -> Discovery Modes, reusing the existing Subsonic connection and honoring Skip TLS Verify, full i18n across 15 locales
- Spotify Saved Albums is now a runnable discovery mode: the albums you saved on Spotify seed artist recommendations on demand from Discover -> Discovery Modes, reusing the existing Spotify OAuth connection (the `user-library-read` scope was already granted for Liked Songs, so no re-consent), full i18n across 15 locales (v1.9.0)
- Deezer Flow is now a runnable discovery mode: the personalized Deezer artist feed (previously reachable only as a standing subscription) can be fired on demand from Discover -> Discovery Modes like any other mode, needs only the existing Deezer OAuth connection, full i18n across 15 locales (v1.8.0)
- Charts discovery mode seeds from global or regional chart movement (via Last.fm) rather than the similarity/relationship graph every other mode uses -- a distinct freshness/popularity axis, runnable and savable as a subscription like any mode, full i18n across 15 locales (v1.7.0)
- Discovery-only installs (no Lidarr) derive a genre profile from native listening-source metadata and local caches. The #403 follow-up shipped Plex/Jellyfin/Emby/Discogs mappings plus a bounded background MusicBrainz warmer with optional Last.fm fallback; library installs keep their library genre reference.
- Discovery modes now live on their own page, ship the full set (ListenBrainz radio coverage, Release Radar, Similar Artist Web, Artist Relationships via the MusicBrainz graph, and Labels via Discogs), and can be saved as subscriptions
- Preview volume control in the global preview bar, persisted across sessions
- Permanent per-user artist blocking and structured rejection reasons shipped in v0.44.0, with a Settings > Blocked management tab and blocklist filtering across pipeline, subscriptions, and quick-discover
- Multilingual support is fully shipped across 15 locales, including locale-aware AI output and stricter translation-quality checks
- Library operations now cover Lidarr, Plex, Jellyfin, Emby, Subsonic, and `slskd`, with artist and album sync, reconciliation review, persistent Library Health snapshots, and better sync visibility
- slskd download targets reached album-level acquisition parity with Lidarr in v1.5.0: album recommendations can be approved straight to slskd (the `addAlbum` capability queues a download job for the chosen release group through the existing slskd search/match/import pipeline)
- Operations and safety now include backup/restore, pre-flight migration checks, auto-backups, job history, stuck-task detection, and browser-test release gates
- Integration work added Deezer OAuth feeds, Emby support, linked `slskd` targets, and broader playlist export coverage
- TheAudioDB is now the primary artist-image source ahead of the Lidarr/SkyHook + fanart.tv + musicinfo.pro chain, with a token-bucket rate limiter and an optional SSRF-guarded image proxy. Recommendation cards expose a Wikidata-sourced artist description and external-link pills (Wikipedia, official site, Discogs, MusicBrainz), cached per locale
- API surface migrated to `/api/v1/*` with mutation routes returning `204 No Content`, probe failures expressed as HTTP status plus `application/problem+json`, and cursor pagination on six list endpoints. Old `/api/*` paths 308-redirect with `Deprecation` and `Sunset` headers through 2026-07-19
- Deep-audit remediation closed across 13 phases (v0.27.x through v0.40.x): auth-surface hardening and first-admin guards, full SSRF sweep including NAT64/Teredo and outbound IP pinning, pipeline isolation with atomic writes, DB index and upsert fixes, dual-key encryption rotation, Kubernetes PSS-restricted with dedicated SA and PDB, Docker hardening with BuildKit cache, cosign keyless signing plus SLSA v1.0 provenance via Sigstore OIDC, Zod validation on every write route, AI provider reliability (Anthropic prompt caching, retry/backoff, Zod-validated outputs, promptfoo eval gate), i18n completeness at 15 locales, component-test plus E2E plus a11y coverage hitting WCAG AA contrast, and a docs/architecture sweep with release-surface consolidation

Release-level detail lives in [CHANGELOG.md](../CHANGELOG.md); this doc keeps
the feature-level summary and the upcoming milestones only.
