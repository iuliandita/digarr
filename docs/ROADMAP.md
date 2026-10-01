# Roadmap

> Updated: 2026-10-01 | Current: v1.18.0
>
> Priorities change with feedback. This is current intent, not a promise.

## Current release

v1.18.0 adds Plex listening history and Audition playlists. It fixes slskd searches and verified Lidarr imports, Plex playlist exports, saved-target connection tests, and notification credential rotation.

Digarr already supports artist and album recommendations, scheduled discovery, playlists, multi-user accounts, and library sync with Lidarr, Plex, Jellyfin, Emby, and Subsonic. The interface and AI discovery output support 15 languages. The next priorities are recommendation quality, useful listening output, and clear delivery outcomes. Security and reliability remain release requirements.

## Shipped highlights

- Plex listening history with a per-user listener selection. Shared-library sync works independently.
- Audition playlists with one resolved track per pending artist, generated on demand or on a schedule.
- Plex playlist export and saved-target connection-test fixes.
- slskd search and retry fixes, complete-release checks, and verified Lidarr imports. Linked targets require a completed-download path visible to Lidarr.

See [v1.18.0](../CHANGELOG.md#v1180---2026-09-20) for details.

## Known integration limitation

TIDAL Favorite Artists is experimental. Authorization, refresh, and favorite-artist retrieval have not been tested with a live account. This is an accepted release limitation, with [community testing requested](../README.md#tidal-feedback). The Experimental badges stay until these flows are verified.

## Next priorities

Planned direction, in this order. Each step should improve the path from a recommendation to a useful listen before we expand the catalog of integrations.

1. **First useful listen.** Make discovery-only and existing-library setup paths clearer, document recipes using existing subscription presets, and explain when Audition cannot find a playable preview. Establish a repeatable recommendation-quality baseline, including niche genres and non-English artist names, before changing ranking.
2. **Preserve recommended tracks.** Start with one recording-aware source and retain the recommended recording through review, playlist generation, and export. Show unresolved matches instead of silently substituting another song by the artist. Artist and album approval remain available.
3. **Explain playlist outcomes.** Show matched and unmatched items, partial output, and failures for each target. Distinguish submitted tracks from verified delivery when a target supports verification. Existing strict matching and complete-release import checks remain required.
4. **Control exploration and repetition.** Make familiar versus adventurous discovery understandable using existing controls first. Add recently played track exclusions where reliable history is available, with an explicit history window and missing-data behavior. Recording-level exclusions depend on preserving track identities; permanent blocks still take precedence.

Outcome reporting can progress alongside track identity work. New ranking and repetition behavior must be evaluated against the baseline; a fuller playlist alone is not evidence of better recommendations.

## Exploring

These need a feasibility and usefulness evaluation before a feature commitment.

- Optional playback feedback from supported servers, with trustworthy track identity and a clear distinction between a deliberate skip and a playback failure.
- Optional acoustic similarity through an audio-analysis companion for existing-library rediscovery. Evaluate resource limits, failure isolation, and recommendation quality; metadata-only discovery must keep working.
- Continuously refreshed discovery queues in existing music clients, after track identity and history-aware selection are established. Target capabilities determine feasibility.

## Future

Good ideas with no timeline yet.

- Additional graph-based discovery modes
- Odesli / song.link resolution, when it improves listening or matching
- Apple Music / iTunes metadata enrichment
- Taste DNA / shareable profile
- Interactive API docs (Swagger/Scalar UI)

## Experiments

Low confidence. Would build only with real demand.

- Festival lineup scanner
- Blended household discovery / party mode
- Listening-history time analysis beyond recent-play exclusions
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
