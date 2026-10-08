# Roadmap

> Updated: 2026-10-07 | Current: v1.19.0
>
> Priorities change with feedback. This is current intent, not a promise.

## Current release

v1.19.0 adds optional genre priorities and playlist generation outcomes. It improves source-relative taste evidence, discovery seed selection, artist matching, and listening-history and preview failure explanations.

Digarr already supports artist and album recommendations, scheduled discovery, playlists, multi-user accounts, and library sync with Lidarr, Plex, Jellyfin, Emby, and Subsonic. The interface and AI discovery output support 15 languages. Next, we want better recommendations, usable playlists, and clear reports of what reached each target. Security and reliability remain release requirements.

## Shipped highlights

- Optional genre priorities with preference-group ordering and browsing. Confidence scoring stays unchanged.
- Playlist generation outcomes separate selected, resolved, and included artists, with exact artist matching and configured fallback sources.
- Source-relative taste evidence and genre-aware AI profiles preserve distinct interests and sparse-history uncertainty.
- Equal-weight seed rotation and library backfill keep discovery seed budgets useful.
- Listening-history states and unavailable preview reasons explain empty results and failures.
- Evidence-preserving maintenance rescoring and cleaned listening-profile genre lists.
- Replayable recommendation-quality reports exercise the production prompt; listener fit needs separate human review.

See [v1.19.0](../CHANGELOG.md#v1190---2026-10-06) for details.

## Known integration limitation

TIDAL Favorite Artists is experimental. Authorization, refresh, and favorite-artist retrieval have not been tested with a live account. This is an accepted release limitation, with [community testing requested](AUTHENTICATION.md#tidal-feedback). The Experimental badges stay until these flows are verified.

## Release history

[CHANGELOG.md](../CHANGELOG.md) records shipped changes by version. Release automation opens a deployment-pin update after publishing an image; maintainers review and merge it before treating those examples as updated.

## Next priorities

Planned direction, in this order. Make recommendations easier to hear and use before adding more integrations.

1. **First useful listen.** Make discovery-only and existing-library setup paths clearer, document recipes using existing subscription presets, and evaluate setup friction and the shipped Audition failure explanations. Extend the replayable recommendation-quality baseline with human listening review, including niche genres and non-English artist names, before changing ranking.
2. **Preserve recommended tracks.** Start with one recording-aware source and retain the recommended recording through review, playlist generation, and export. Show unresolved matches instead of silently substituting another song by the artist. Artist and album approval remain available.
3. **Explain playlist outcomes.** Build on the shipped local per-artist generation outcomes to show submitted items, partial output, and failures for each target. Distinguish submitted tracks from verified delivery when a target supports verification. Strict local-generation matching and complete-release import checks remain required; media-server exports still have a [first-result substitution limitation](https://github.com/iuliandita/digarr/issues/758).
4. **Control exploration and repetition.** Make familiar versus adventurous discovery understandable using existing controls first. Add recently played track exclusions where reliable history is available, with an explicit history window and missing-data behavior. Recording-level exclusions depend on preserving track identities; permanent blocks still take precedence.

We can improve delivery reports while preserving track identities. Compare ranking and repetition changes with the baseline; more tracks do not prove better recommendations.

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
