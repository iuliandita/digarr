# Roadmap

> Updated: 2026-10-16 | Current: v2.0.1
>
> Priorities change with feedback. This is current intent, not a promise.

## Current release

v2.0.0 fixes discovery filtering, album coverage and approval, saved playlist exports, setup, and recovery. OIDC identities now use exact issuer/subject pairs; existing SSO installations require verified recovery after migration. v2.0.1 fixes the automatic pre-migration backup for databases one release behind. Read the [upgrade procedure](OPERATIONS.md#upgrading-from-v1190-to-v200) before updating.

Digarr already supports artist and album recommendations, scheduled discovery, playlists, multi-user accounts, and library sync with Lidarr, Plex, Jellyfin, Emby, and Subsonic. The interface and AI discovery output support 15 languages. Next priorities are better recommendations, usable playlists, and clear reports of what reached each target. Security and reliability remain release requirements.

## Shipped highlights

- Unreleased: the built-in [MCP endpoint](MCP.md) exposes owner-scoped recommendations, approvals, scans, discovery modes, and playlists using personal API tokens. Client configuration is available after token creation.
- Album coverage paginates complete catalogs and excludes secondary release types; Gap-Fill failures retain the selected slice for retry.
- Quick Discover seeds follow owner-scoped filters; individual, bulk, and automatic album approval retain the recommended release.
- Saved playlists refresh their bound remote destinations, search connected local libraries, and report unmatched exports without substituting tracks.
- Per-channel digest positions retain failed delivery windows; complete persistent-state backups reject unsafe partial restores.
- First-account creation precedes the browser setup wizard; configured admin bootstrap completes before HTTP opens.
- Settings saves respect user/admin permissions, mask secret-bearing preferences, and retain explicit configuration failures.
- Exact OIDC issuer/subject matching includes a dry-run recovery helper for verified legacy identities.
- The pre-migration backup reads only the tables and columns the database already has, so upgrades from the previous release no longer need the backup override.
- v2.0.0 publishes separate signed Alpine and Debian container inventories with explicit amd64 scope. See the [release assets](https://github.com/iuliandita/digarr/releases/tag/v2.0.0) and [verification instructions](../deploy/docker/README.md#verifying-image-signatures).

See [v2.0.1](../CHANGELOG.md#v201---2026-10-16) and [v2.0.0](../CHANGELOG.md#v200---2026-10-15) for the full changes and migration requirements.

## Known integration limitations

The community Unraid template corrections remain pending in [Selfhosters PR #697](https://github.com/selfhosters/unRAID-CA-templates/pull/697). Follow the [Unraid workarounds](guides/unraid.md#step-2-configure-the-container) until the published template is verified. The optional Debian fallback retains upstream HIGH vulnerabilities without an available fix; Alpine remains the default. See [current limitations](OPERATIONS.md#known-limitations).

TIDAL Favorite Artists is experimental. Authorization, refresh, and favorite-artist retrieval have not been tested with a live account. This is an accepted release limitation, with [community testing requested](AUTHENTICATION.md#tidal-feedback). The Experimental badges stay until these flows are verified.

## Release history

[CHANGELOG.md](../CHANGELOG.md) records shipped changes by version. Copyable README and Compose version examples must match the release before tagging. Immutable deployment pins update separately after image publication; see the [release checks](MAINTENANCE.md#limits-and-release-checks).

## Unreleased

- Review and approve an artist's missing studio albums together, with individual album selection and visible partial failures ([#976](https://github.com/iuliandita/digarr/issues/976)).
## Unreleased

- Per-user scrobbler write-back sends exact-track approvals to ListenBrainz or Last.fm, with a separate ListenBrainz opt-in for manually generated playlists (scheduled runs never send) and explicit encrypted Last.fm connection consent (#977). This remains unreleased; live provider validation is separate from automated checks.
- Customizable dashboard (#995): account-saved card visibility, order, size, source-page switches, merged decision and listening views, and reset.

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
