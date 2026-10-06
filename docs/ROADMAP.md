# Roadmap

> Updated: 2026-10-06 | Current: v1.19.0
>
> Priorities change with feedback. This is current intent, not a promise.

## Current release

v1.19.0 adds optional genre priorities and playlist generation outcomes. It improves source-relative taste evidence, discovery seed selection, artist matching, and listening-history and preview failure explanations.

Digarr already supports artist and album recommendations, scheduled discovery, playlists, multi-user accounts, and library sync with Lidarr, Plex, Jellyfin, Emby, and Subsonic. The interface and AI discovery output support 15 languages. The next priorities are recommendation quality, useful listening output, and clear delivery outcomes. Security and reliability remain release requirements.

## Shipped highlights

- Optional genre priorities with preference-group ordering and browsing. Confidence scoring stays unchanged.
- Playlist generation outcomes separate selected, resolved, and included artists, with exact artist matching and configured fallback sources.
- Source-relative taste evidence and genre-aware AI profiles preserve distinct interests and sparse-history uncertainty.
- Equal-weight seed rotation and library backfill keep discovery seed budgets useful.
- Listening-history states and unavailable preview reasons explain empty results and failures.
- Replayable recommendation-quality reports exercise the production prompt; subjective fit remains advisory.

See [v1.19.0](../CHANGELOG.md#v1190---2026-10-06) for details.

## Known integration limitation

TIDAL Favorite Artists is experimental. Authorization, refresh, and favorite-artist retrieval have not been tested with a live account. This is an accepted release limitation, with [community testing requested](../README.md#tidal-feedback). The Experimental badges stay until these flows are verified.

## Also shipped in v1.19.0

- Equal-weight discovery seed rotation, identity-safe library mixing and filled seed budgets. [#743](https://github.com/iuliandita/digarr/issues/743).
- Playlist generation coverage with per-artist dispositions and exact artist matching before choosing tracks. [#744](https://github.com/iuliandita/digarr/issues/744), [#745](https://github.com/iuliandita/digarr/issues/745).
- Combine source-relative artist evidence without treating global popularity or starred-list position as personal listening counts; preserve raw values and evaluate input invariants across varied tastes. [#741](https://github.com/iuliandita/digarr/issues/741).
- Name and catalog-alias validation before genre-based artist resolution. Ambiguous matches remain unresolved.
- Maintenance rescoring that preserves saved score evidence, applies the current user's weights only to their rows, and skips incompatible or concurrently changed rows.
- Cleaning imported genre lists before listening-profile weighting and coverage reporting.
- Optional genre-priority ordering for focused and eclectic preferences, with separate preference-group browsing and unchanged confidence scores. Broader automatic ranking changes still require evaluation across varied profiles.

- Retain artist-level genre context and honest source-weight labels in AI profiles; evaluate several equal interests and sparse history without forcing a dominant genre. [#739](https://github.com/iuliandita/digarr/issues/739).
- Explain unavailable previews in the existing Discover Audition queue. [#729](https://github.com/iuliandita/digarr/issues/729).
- Capability-aware discovery reporting, including unsupported sources and successful empty lookups. [#722](https://github.com/iuliandita/digarr/issues/722).
- Preserve legitimate AI comparisons to listening-profile artists while retaining a limited shared-name confusion check. [#719](https://github.com/iuliandita/digarr/issues/719).
- Distinguish empty listening history from unconfigured accounts and fetch failures. [#721](https://github.com/iuliandita/digarr/issues/721).

## Release history

[CHANGELOG.md](../CHANGELOG.md) records shipped changes by version. Release automation opens a deployment-pin update after publishing an image; maintainers review and merge it before treating those examples as updated.

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

## Recommendation evaluation

The [evaluation guide](RECOMMENDATION-QUALITY.md) describes production-prompt cases and replayable contract reports. Recommendation fit, catalog identity, previews, and delivery still need separate human and end-to-end evaluation before ranking changes.
