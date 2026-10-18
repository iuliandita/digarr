# Roadmap

> Updated: 2026-10-18 | Current: v2.0.1
>
> Priorities change with feedback. This is current intent, not a promise.

## Current release

v2.0.1 fixes the automatic pre-migration backup for databases one release behind. v2.0.0 moved OIDC to exact issuer/subject identities; read the [upgrade procedure](OPERATIONS.md#upgrading-from-v1190-to-v200) before updating from v1.19.0. Changes on `develop` that are not released yet are listed in the [CHANGELOG](../CHANGELOG.md#unreleased) and ship in the `:nightly` image.

Known gaps and integration limitations are tracked in [OPERATIONS.md](OPERATIONS.md#known-limitations).

## Current focus

Make recommendations easier to hear and act on before adding more integrations. Security and reliability remain release requirements.

1. **First useful listen.** Clearer setup paths for discovery-only and existing-library installs, documented recipes using the existing subscription presets, and human listening review (including niche genres and non-English artist names) before any ranking change.
2. **Preserve recommended tracks.** Keep the recommended recording through review, playlist generation and export, and show unresolved matches instead of substituting another song by the same artist.
3. **Explain playlist outcomes.** Show what was submitted, skipped or failed for each target, and tell submitted tracks apart from verified delivery where a target supports it.
4. **Control exploration and repetition.** Make familiar versus adventurous discovery understandable with existing controls first, then add recently played exclusions where reliable history exists.

Ranking changes are compared against the [recommendation-quality baseline](RECOMMENDATION-QUALITY.md); more tracks do not prove better recommendations.

## Not planned

These keep coming up. They are out of scope unless something fundamental changes.

- A built-in music player. Digarr is the discovery layer in front of your player and media server; previews cover auditioning.
- Its own downloader, tagger or audio analyzer. Acquisition stays with Lidarr and slskd, and audio similarity comes from optional external services such as AudioMuse-AI.
- More acquisition targets (Prowlarr, yt-dlp, Qobuz or TIDAL downloaders). Lidarr and slskd are the acquisition boundary.
- Apple Music or Qobuz as sources: no usable official API access for this project.
- Spotify browser-cookie authentication as a way around Spotify's app limits.
- Sending rejects or blocks to scrobblers as dislikes. They stay local.
