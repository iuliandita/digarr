# Configuration and operations

These notes describe v1.19.0. Start with the [README](../README.md) for installation. Most connection, playlist, notification, and maintenance settings live in the web UI; public origin and the environment settings below require a restart.

## Known limitations in v1.19.0

These are existing app behaviors, tracked separately from this documentation update:

| Area | What to expect |
|------|----------------|
| Bulk album approval | Uses artist targets. Lidarr requests no album monitoring or search. Approve individual albums to acquire the selected release. [#756](https://github.com/iuliandita/digarr/issues/756). |
| Automatic album approval | Uses the configured artist monitoring scope, defaulting to all albums. [#761](https://github.com/iuliandita/digarr/issues/761). |
| Media-server playlists | Navidrome, Jellyfin, Emby, and Plex can substitute unmatched tracks. Inspect the exported playlist. [#758](https://github.com/iuliandita/digarr/issues/758). |
| Local playlist generation | `local` is accepted as a source priority but no media-library lookup is wired into generation. Use Spotify/Deezer and the MusicBrainz fallback. Export destination matching is separate. [#767](https://github.com/iuliandita/digarr/issues/767). |
| Debian container SBOM | Debian images and build provenance remain signed, but there is no signed Debian container SBOM. [#768](https://github.com/iuliandita/digarr/issues/768). |
| Scheduled exports | Regeneration replaces local tracks but creates another remote playlist; repeated runs can accumulate same-name copies. [#765](https://github.com/iuliandita/digarr/issues/765). |
| Playlist API config | Supplied config objects need both `size` and `trackSourcePriority`; partial objects are not merged with defaults. [#764](https://github.com/iuliandita/digarr/issues/764). |
| Application JSON backups | Partial exports omit recovery state; restoring users also deletes omitted user-owned rows through cascading foreign keys. Automatic backup failure does not stop migrations. Back up the destination and prefer a fresh database. [#757](https://github.com/iuliandita/digarr/issues/757). |
| Encryption-key rotation | The script omits per-user preferences. Re-save and independently verify affected credentials before retiring the old key. [#760](https://github.com/iuliandita/digarr/issues/760). |
| Saved-settings probes | Send a JSON object. Lidarr TLS verification does not fall back to its saved setting. [#759](https://github.com/iuliandita/digarr/issues/759). |
| Digest delivery | A successful channel advances the shared bookmark; failed channels do not retry that window independently. Crash duplicates remain possible. [#762](https://github.com/iuliandita/digarr/issues/762). |
| File-backed secrets | Unreadable files are treated as unset; verify mounts and read permissions. [#763](https://github.com/iuliandita/digarr/issues/763). |
| System Health sources | Normal skips, including unconfigured sources and unsupported discovery capabilities, count toward the source failure rate. Check individual Job History outcomes before concluding there is an outage. [#769](https://github.com/iuliandita/digarr/issues/769). |
| Listening-history cache | Rejected Digarr requests retain cached entries. A Digarr HTTP 200 response carrying `status: "error"` can replace them with an empty error state after a provider failure. [#770](https://github.com/iuliandita/digarr/issues/770). |
| Helm database credentials | Chart-generated connection URLs do not encode credentials. Use URI-unreserved chart values, or a complete encoded DSN for a user-managed database. [#772](https://github.com/iuliandita/digarr/issues/772). |
| TIDAL | Experimental; no live-account authorization, refresh, or favorite-artist retrieval validation. See [app setup and feedback](AUTHENTICATION.md#tidal-app-setup). |

## Unattended setup

For unattended first boot, set `AI_PROVIDER` and `AI_MODEL`, plus `DIGARR_INITIAL_USERNAME` and a `DIGARR_INITIAL_PASSWORD` of at least 12 characters. Add listening services and targets in Settings or supply supported environment settings. See [`.env.example`](../.env.example) for local development and [`deploy/docker/.env.example`](../deploy/docker/.env.example) for Compose.

## Playlists and notifications

Add playlist destinations in Settings > Targets, then select those targets in each playlist. Digarr keeps the generated playlist locally if an export fails; admins can inspect the error in Job History. Spotify exports need a connected account with playlist permissions.

The global scheduling switch is API-only in v1.19.0; there is no web UI control. Scheduling requires an admin to enable it with `PATCH /api/v1/settings` and `{ "preferences": { "playlistEnabled": true } }`; it defaults to false. Each playlist also needs `enabled: true` and a schedule. Manual generation works independently of the global switch.

Generation currently searches Spotify and Deezer, with MusicBrainz as a final fallback. Although `local` is an accepted source priority, it performs no media-library lookup ([#767](https://github.com/iuliandita/digarr/issues/767)).

Destination matching is separate from local generation. Navidrome, Jellyfin, Emby, and Plex currently fall back to the first search result when no exact artist/title match exists, so they can export a different track ([known limitation](https://github.com/iuliandita/digarr/issues/758)); inspect the remote playlist.

Playlist details show the latest generation status, selected/resolved/included artist counts, and artists with no match, unavailable providers, lookup errors, or tracks excluded by the size limit. Search results must match the requested artist before selection.

MusicBrainz recordings are a final fallback for artists with an MBID. They supply real titles and recording IDs, not playable audio; M3U/XSPF exports link to MusicBrainz pages, and remote targets must resolve tracks again. When no resolver can run, generation records an unavailable outcome rather than inventing titles. Local outcome counts do not verify remote delivery or playback.

Regeneration replaces the local track list, but each export creates a new remote playlist. Digarr does not retain remote playlist IDs for later updates; scheduled runs can accumulate same-name copies ([#765](https://github.com/iuliandita/digarr/issues/765)).

Audition playlists choose one track per pending artist without approving recommendations, and can refresh on demand or on a schedule. They are separate from the Audition preview queue in Discover, which plays short previews in the browser. The Discover queue retains a dismissible summary of unavailable previews, including missing links, empty or failed lookups, browser blocking, and playback failures. Starting a new queue resets that summary; retrying an item replaces its previous outcome. An embed starting is not proof of a successful listen.

Admins can add webhook, ntfy, Telegram, and Apprise channels in Settings > Connections > Notifications, with scan-complete and scheduled-digest subscriptions per channel. Private-network destinations are blocked by default; the per-channel LAN option permits private IPv4 destinations for self-hosted services. It does not override your container or Kubernetes network policy.

A digest uses one shared delivery bookmark. It advances when any channel succeeds, so a failed channel does not independently retry that window. A crash after sending but before saving can duplicate a digest ([#762](https://github.com/iuliandita/digarr/issues/762)).

## Library health

Library Health offers scheduled sync and `Sync Now`. Failed album fetches preserve the previous library snapshot. Admins can inspect failures in Job History.

## Large Lidarr libraries

Lidarr's artist API returns the entire library in a single response with no pagination, so a very large library can take well over a minute to serialize. Digarr allows 120 seconds for that fetch; the time needed depends on Lidarr and library size. If library sync still reports a timeout, raise `DIGARR_LIDARR_TIMEOUT_SECONDS` and restart Digarr. The timeout applies only to the full-library fetch; every other Lidarr call keeps a short timeout so an unreachable Lidarr still fails fast.

## MusicBrainz mirrors

To use your own MusicBrainz mirror, set these environment variables and restart Digarr:

```dotenv
DIGARR_MUSICBRAINZ_URL=http://musicbrainz:5006/ws/2
DIGARR_MUSICBRAINZ_INTERVAL_MS=100
```

Replace `musicbrainz` with your mirror's hostname as reachable from Digarr. No mirror is bundled: containers need access to your existing mirror's network; local development can use `localhost` if the mirror runs on the same host. Use the full web-service base URL, including `/ws/2` (and any reverse-proxy path). This applies to all MusicBrainz lookups across users, discovery, library sync, and playlist imports. It is configured through the environment only. The Compose examples load these variables from their `.env` file; for Kubernetes, add them to the app container's environment.

The default remains `https://musicbrainz.org/ws/2` with one request per second. Your mirror can use a shorter interval, including `0` for no delay; requests still run one at a time. Public MusicBrainz hosts require at least `1000` milliseconds. Invalid URLs or intervals prevent startup. URLs must use HTTP or HTTPS without credentials, query parameters, or fragments. Redirects are refused, so point directly at the final endpoint. There is no automatic fallback to the public service if your mirror fails.

## Local and OpenAI-compatible AI

For Open WebUI, choose **OpenAI-Compatible** and use a base URL ending in `/api`, such as `http://<open-webui-host>:<port>/api`. Digarr sends requests to Open WebUI's documented `/api/chat/completions` route. Other compatible servers can use their server root or a base ending in `/v1`. If a local model needs longer to load or generate, set `DIGARR_AI_TIMEOUT_SECONDS` to a suitable value, such as `180`, and restart Digarr; the override applies to both connection tests and recommendation requests.

## Connecting Plex listeners

In Settings > Connections > Your Connections, enter your Plex server URL and token, test the connection, select the music library and Plex listener, and save. Each Digarr user selects their own listener on the same shared server. Digarr uses that listener's playback history for recent and frequent artists, and Plex similarity metadata for discovery when available. Lidarr and a scrobbling service are optional; existing Charts and other sources can supplement Plex.

A listener selection is required for listening-based discovery. Existing Plex connections continue to sync their libraries, but need this selection before contributing listening history. Changing the server or token clears the selection.

Digarr verifies the server identity and rejects history belonging to a different account instead of mixing profiles. A server or token that cannot expose the account list or playback history can still be used for library sync; Plex similarity data depends on the library's metadata agent.

History analysis allows at most 5,000 entries (25 pages) per requested period. If that period cannot be read completely within the limit, top-artist analysis reports a failure instead of returning partial totals; choose a shorter period or another listening source.

## Importing slskd downloads into Lidarr

For a linked slskd target, set **Download root as seen by Lidarr** to the completed-downloads folder that Lidarr can read, such as `/downloads`. Mount the same completed files into Lidarr or configure its path mapping. slskd stores each remote directory under its final folder name; multi-disc folders must be complete and unambiguous before import.

Digarr waits for every queued file to succeed, asks Lidarr to identify the files, and refuses rejected, partial, or ambiguous releases. It imports by moving the files and only reports completion after Lidarr's album tracks have files. Releases are limited to 500 files and 20 GiB, with paths no longer than 2,048 characters. Failed work retries after a one-hour cooldown using the same job; older duplicate failures remain as superseded history. Standalone slskd targets do not import into Lidarr.

If Digarr stops after submitting a download or import but before saving its confirmation, the next run may retry it or report a failure even though the external service accepted it. Check slskd transfers and Lidarr before retrying manually.

## Backup & restore

Digarr provides application-level backup and restore through the admin UI (Settings > Administration) or API.

**Manual backup:** use `POST /api/v1/admin/backup?includeCaches=true` to include artists referenced by recommendations and artist blocks. The default export omits those artists and cannot recover referenced rows into an empty database. Even the cache-inclusive JSON omits album blocks, library snapshots/overrides, and slskd jobs; use a consistent database backup for complete recovery. See [backup boundaries and recovery](guides/switching-backends.md#backup-boundaries-and-recovery).

**Restore:** `POST /api/v1/admin/restore?confirm=true` accepts backup JSON or a multipart `file` upload. It replaces the included tables in a transaction; it does not merge a backup into existing account data. Clearing users also cascades deletion into omitted user-owned tables, including album blocks and library state; omitted tables are not guaranteed to survive ([#757](https://github.com/iuliandita/digarr/issues/757)). Take a complete destination backup first and prefer restoring into a fresh database. An encryption-key mismatch returns `409` without restoring. Restore with the original key, or explicitly add `&force=true` and re-enter the affected credentials afterward.

**Legacy OIDC data:** Older backups may contain an obsolete `oidcTokens` table. An empty table is ignored; nonempty rows are skipped with a warning and are never restored.

**Auto-backup before migrations:** When Digarr detects pending database migrations on startup, it attempts a backup to `DIGARR_BACKUP_DIR` (default: `./backups/`). It keeps the last 14 auto-backups, counted by migration runs rather than days. Copy backups off the server as well; a local volume does not protect against disk loss. Automatic backups have the same omissions as default JSON exports, and failure does not block migrations. Verify a usable, complete database backup before upgrading. Disable automatic attempts with `DIGARR_AUTO_BACKUP=false`.

**Upgrading to v1.19.0:** this release adds no database migrations relative to v1.18.0, so that upgrade creates no pre-migration automatic backup. Take a complete database backup before updating.

**Upgrading from before v1.18.0:** Startup migrations add Plex listener identity fields and consolidate duplicate slskd retry jobs, retaining superseded rows and accumulated attempts. Keep a pre-upgrade backup. Existing Plex connections need a listener selection for history; linked slskd targets need a completed-download path visible to Lidarr. See [Plex setup](#connecting-plex-listeners) and [slskd imports](#importing-slskd-downloads-into-lidarr).

**Kubernetes / Helm note:** Auto-backup needs a writable `/app/backups` volume. The bundled Helm chart and raw manifests use `emptyDir` by default, which is lost when the pod is replaced. Enable `backups.persistence.enabled=true` in Helm, or provide persistent storage in custom manifests.

**Downgrading:** never run an older image against a migrated database without establishing compatibility. The [OIDC rollback procedure](AUTHENTICATION.md#rollback-across-the-oidc-token-storage-migration) explains how to prepare an older-schema backup in a separate database.

## Data hygiene

Admin tools available under Settings > Administration > Data Hygiene:

- **Clear Image Failures:** reset failed image cache entries so Digarr can retry them
- **Rebuild Genre Cache:** regenerate cached genres from artist tags
- **Re-score Recommendations:** recalculate your recommendations with your current weights, preserving saved score evidence and album modifiers. Rows with incompatible evidence or concurrent changes are skipped.
- **Dedupe Repair:** merge duplicate recommendations
- **AI Reasoning Audit:** review and repair stored reasoning; this cannot guarantee that AI claims are correct
- **Purge Sessions:** clean out expired login sessions
