# Roadmap

> Updated: 2026-10-15 | Current: v1.19.0
>
> Priorities change with feedback. This is current intent, not a promise.

## Current release

v1.19.0 adds optional genre priorities and playlist generation outcomes. It improves source-relative taste evidence, discovery seed selection, artist matching, and listening-history and preview failure explanations.

Digarr already supports artist and album recommendations, scheduled discovery, playlists, multi-user accounts, and library sync with Lidarr, Plex, Jellyfin, Emby, and Subsonic. The interface and AI discovery output support 15 languages. Next priorities are better recommendations, usable playlists, and clear reports of what reached each target. Security and reliability remain release requirements.

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

Unreleased: [#807](https://github.com/iuliandita/digarr/issues/807) restores Plex history parsing and saved library names, adds an unusable-history warning, and clarifies Release Radar's supported providers. Audition hints also distinguish pending artists and generation, and its empty-queue message describes pending recommendations (#748, #752). Bulk album approval now uses album targets and preserves selected-release monitoring (#756). Recovery backups now include persistent state and reject unsafe partial restores before writes (#757). Media-server playlist exports now skip unmatched tracks and report omissions in Job History (#758). Saved Lidarr probes retain their TLS setting (#759), and key rotation includes per-user preference secrets (#760). Automatic album approval now preserves release identity and uses album targets (#761). Digest delivery retains failed windows independently per channel (#762). Unreadable database secret files now stop startup with an explicit configuration error (#763). Partial playlist configs now receive defaults and invalid values are rejected (#764). Saved playlist exports retain remote IDs and require explicit recovery for uncertain creation (#765). Local playlist priority now searches the owner's connected libraries with scoped lookups and catalog fallbacks (#767). The release workflow now prepares separate signed Alpine and Debian container SBOMs with explicit amd64 coverage; publication awaits the next release (#768). System Health now excludes normal source skips from failure rates while preserving the recent-run sample and individual Job History outcomes (#769). Dashboard listening-source failures now retain the last successful matching-query history with retry guidance (#770). Helm-generated PostgreSQL URLs encode raw components without changing bundled server values (#772). Runtime startup and backend-copy connections preserve exact database identifiers, with explicit upgrade precautions for previously misread names (#773, #834). Deezer subscription failures now reach Job History and the subscription row with Settings/reconnect guidance while genuine empty feeds remain successful (#774). Backend migration now protects all populated copy-managed destination tables, with a locked recheck before replacement (#775). Spotify playlist imports and subscriptions now paginate and honor their saved artist cap, with explicit incomplete-read and access limits (#779). Embedded-backend migration guidance now includes clearing file-backed PostgreSQL settings (#781); the email-schema comment matches explicit OIDC linking (#780). Initial setup now requires an account before the browser wizard and saves requested connections/targets atomically with retryable failure (#783). Browser backup restore now asks for replacement consent before upload and sends explicit API confirmation, with a separate key-mismatch override (#784). Configured initial-admin creation now completes before HTTP and fails startup on incomplete or failed first-boot credentials, while existing accounts and manual registration are preserved (#785). External Unraid bootstrap help remains tracked separately (#843). Bulk rejection now rejects permanent `not_right_now` requests before updates, matching individual rejection while preserving nullable bulk reasons (#786). Rejection cooldowns now use the run owner across scans, Quick Discover similar results, and subscriptions, with unowned legacy records isolated from account runs (#788). Genre feedback summaries distinguish actual rejections from other acted-on outcomes without changing approval rates or scoring (#789). Pipeline cancellation stops new storage/target work at safe checkpoints and retains ownership through settlement, preserving completed outcomes (#790, #850). The default-off net-new album discovery flag now persists through user and admin-global preference APIs (#791); the non-admin save notice remains separate (#792). See the [unreleased changelog](../CHANGELOG.md#unreleased).

TIDAL Favorite Artists is experimental. Authorization, refresh, and favorite-artist retrieval have not been tested with a live account. This is an accepted release limitation, with [community testing requested](AUTHENTICATION.md#tidal-feedback). The Experimental badges stay until these flows are verified.

## Release history

[CHANGELOG.md](../CHANGELOG.md) records shipped changes by version. Release automation opens a deployment-pin update after publishing an image; maintainers review and merge it before treating those examples as updated.

## Next priorities

Planned direction, in this order. Make recommendations easier to hear and use before adding more integrations.

1. **First useful listen.** Make discovery-only and existing-library setup paths clearer, document recipes using existing subscription presets, and evaluate setup friction and the shipped Audition failure explanations. Extend the replayable recommendation-quality baseline with human listening review, including niche genres and non-English artist names, before changing ranking.
2. **Preserve recommended tracks.** Start with one recording-aware source and retain the recommended recording through review, playlist generation, and export. Show unresolved matches instead of silently substituting another song by the artist. Artist and album approval remain available.
3. **Explain playlist outcomes.** Build on the shipped local per-artist generation outcomes to show submitted items, partial output, and failures for each target. Distinguish submitted tracks from verified delivery when a target supports verification. Strict local-generation matching and complete-release import checks remain required. Media-server exports now reject unmatched search results and report skipped counts in Job History; per-target reports in playlist details and read-back verification remain future work.
4. **Control exploration and repetition.** Make familiar versus adventurous discovery understandable using existing controls first. Add recently played track exclusions where reliable history is available, with an explicit history window and missing-data behavior. Recording-level exclusions depend on preserving track identities; permanent blocks still take precedence.

Delivery reports can improve while preserving track identities. Compare ranking and repetition changes with the baseline; more tracks do not prove better recommendations.

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
