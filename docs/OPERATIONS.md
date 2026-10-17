# Configuration and operations

These notes describe v2.0.1. Start with the [README](../README.md) for installation. Most connection, playlist, notification, and maintenance settings live in the web UI; public origin and the environment settings below require a restart.

<a id="known-limitations-in-v1190"></a>

## Known limitations

| Area | What to expect |
|------|----------------|
| TIDAL | Experimental; authorization, refresh, and favorite-artist retrieval have no live-account validation. See [app setup and feedback](AUTHENTICATION.md#tidal-app-setup). |
| Debian fallback | The pre-release audit retains 43 HIGH findings across eight unique upstream vulnerabilities without an available fix. Alpine remains the default; the Debian/glibc variant remains an optional fallback. See [#863](https://github.com/iuliandita/digarr/issues/863). This is not a clean image-scan result. |
| Unraid store | [Selfhosters PR #697](https://github.com/selfhosters/unRAID-CA-templates/pull/697) remains open as of October 15, 2026, despite passing hosted lint and independent review. Personal companion corrections are merged; use the [published-store workarounds](guides/unraid.md#step-2-configure-the-container) until the community template is updated and verified. |
| Release inventories | The release workflow prepares separate Alpine and Debian container SBOMs covering amd64, attached to each variant's index digest at both registries. Publication and signed attestations still require release-time verification; arm64 inventory coverage is not established. See [verification and coverage](../deploy/docker/README.md#verifying-image-signatures). |
| Saved playlist exports | Replacement may leave partial remote contents and cannot roll back external writes. Uncertain creation, inaccessible IDs, and changed destinations require explicit recovery. Use one app replica. See [playlists and notifications](#playlists-and-notifications). |
| Album coverage | Coverage requires complete, valid MusicBrainz Album metadata with no secondary types. Failed lookups fail the selected Gap-Fill slice without advancing its cursor; persistent provider errors can hold it until resolved. Existing cursor values are not repaired. |
| Digest delivery | Positions are per channel, but a crash after sending and before saving can duplicate a digest. Earlier windows lost by the legacy shared bookmark cannot be reconstructed. |
| Database identifiers | Runtime startup and backend copies preserve exact encoded names; external Drizzle Kit commands retain their own parser. Confirm the actual database before changing an old installation's unusual identifiers. See [upgrade precautions](guides/switching-backends.md#database-identifier-upgrades). |

Manual subscription runs keep the HTTP request open through execution before returning `202`, unlike import requests. After a timeout or source error, check subscription run history and Job History before retrying. A timed-out request may have stored recommendations.

Removing a permanent artist block does not clear an earlier rejection cooldown, which defaults to 90 days from rejection. Unblocking can therefore leave the artist ineligible until that cooldown expires. See [artist blocks](API.md#artist-blocks).

The owner-scoping fix in #788 adds no schema migration or stored-row rewrite. After upgrading, artists suppressed only by another account's or an unowned rejection can become eligible again. Keep the normal database backup and matching encryption key before upgrade; this query change needs no additional backup format. Rolling back restores the shared cooldown behavior. Legacy unowned recommendations remain unowned.

## Job History and stuck jobs

Pipeline cancellation stops new storage units and automatic target work at safe checkpoints. It finishes operations already in flight, records their results, and retains successful writes and additions. An actual target or database failure remains a failure even when cancellation was requested. Interrupted storage marks its batch failed; the pipeline job is cancelled after successful cleanup. The running flag stays true until active work and awaited bookkeeping settle, with a terminal event afterward. Cleanup failures report an error and retain the original failure instead of reporting successful cancellation ([#790](https://github.com/iuliandita/digarr/issues/790), [#850](https://github.com/iuliandita/digarr/issues/850)).

Cancellation accepted by `cancelled: true` is still in progress. Once final success bookkeeping has begun, the API declines cancellation with `cancelled: false` and `Pipeline finishing`; wait for completion. The queue is cleared either way. There is no 15-second forced unlock: a hung operation keeps the pipeline busy. Resolve the service/database problem or deliberately restart the process, then inspect retained recommendations and target outcomes before retrying. No schema migration or row rewrite is added; normal backup procedures are unchanged, and rollback restores the old cancellation behavior.

v1.19.0 can continue writes and additions after its backstop clears the running indicator, and can still report completion. On every version, follow the [migration prerequisites](guides/switching-backends.md#prerequisites) and wait for all active jobs and writers; pipeline settlement alone does not establish whole-application quiescence. See [pipeline cancellation](API.md#pipeline) for the API behavior.

Admins can inspect Job History for failures and partial results; the Failures only filter hides routine runs, and library sync rows name their source. The stuck detector checks at startup and every five minutes. It marks a running job `stuck` when its elapsed time exceeds these fixed limits:

| Job type | Time limit |
|----------|------------|
| Pipeline | 10 minutes |
| Quick discovery or subscription | 5 minutes |
| Target or playlist | 2 minutes |
| Library sync | 90 minutes |

This label does not stop the job or prove that it has stopped making progress. A slow, healthy run can cross the limit; check its progress before retrying.

## Boolean environment settings

`DIGARR_DISABLE_REGISTRATION`, `DIGARR_ALLOW_INSECURE_COOKIES`, `PROXY_AUTH_ENABLED`, and `SKIP_TLS_VERIFY` accept `true`, `false`, `1`, or `0`, in any letter case. Any other value stops startup with an error naming the variable. Earlier releases read every unrecognized value, including `TRUE`, as `false`; check these variables before upgrading. An empty value keeps the default.

## Unattended setup

Keep first-boot access restricted until the intended admin account is verified. Migrations and configured initial-admin creation finish before HTTP opens. With no users, set both `DIGARR_INITIAL_USERNAME` and a `DIGARR_INITIAL_PASSWORD` of at least 12 characters, or leave both unset for manual registration. A partial pair, short password, or database failure stops startup. Existing users bypass these bootstrap settings without password or role changes; keep one app instance per database.

For unattended service setup, also set `AI_PROVIDER` and `AI_MODEL`. This separate initializer still runs after HTTP opens; it no longer controls whether the initial admin is created. Add listening services and targets in Settings or supply supported environment settings. See [`.env.example`](../.env.example) for local development and [`deploy/docker/.env.example`](../deploy/docker/.env.example) for Compose.

Before upgrade, review both bootstrap variables and retain a consistent database backup, matching encryption key, and previous image. If first boot stops, correct the pair or intentionally unset both for restricted manual registration, verify database availability, and restart. If another account already exists, verify who owns it; bootstrap never replaces it. This correction adds no schema migration. Rollback restores the previous startup race and weak/partial-credential skip behavior; keep access restricted, and use a compatible image and its matching backup if other migrations have run.

## Playlists and notifications

Add media-server playlist destinations in Settings > Targets, then select those targets in each playlist. A successful Spotify connection attempts to create a user-owned Spotify Playlist target automatically; select that target in the playlist. The Add Target dialog does not offer Spotify. If the target is missing after connecting, ask an admin to inspect the logs and create it through the targets API.

Digarr keeps the generated playlist locally if an export fails; admins can inspect the error in Job History. Spotify exports need a connected account with playlist permissions. Regeneration fails and keeps the previous tracks when the selected artists yield no tracks, when more than half of them hit track-source errors, or when the playlist has no owner; the failed job records the per-artist resolution. An empty selection, such as no approvals yet, still produces an empty playlist.

The global scheduling switch is API-only; there is no web UI control. Scheduling requires an admin to enable it with `PATCH /api/v1/settings` and `{ "preferences": { "playlistEnabled": true } }`; it defaults to false. The Playlists page shows "Schedule paused" when scheduling is off and at least one enabled playlist has a schedule; with the switch off, no scheduled playlist regenerates. Check `GET /api/v1/playlists/scheduler` (`enabled`) to confirm the global switch. Each playlist also needs `enabled: true` and a schedule. Manual generation works independently of the global switch.

Playlists created in the web UI search local libraries, then Spotify, then Deezer. API playlists without a config search only Spotify; explicit `trackSourcePriority` controls which sources are tried. Spotify search requires that user's stored Spotify OAuth connection. Deezer search needs no account. MusicBrainz is the final fallback for artists with an MBID.

The `local` priority uses only the playlist owner's saved connections, in order: Jellyfin, Emby, Subsonic/Navidrome, then Plex. Jellyfin/Emby retain the configured user and library; Plex retains the configured music section, or its existing first-visible-music-section default. Searches inspect at most 25 candidates per provider and artist. The first connection returning usable tracks for the exact normalized artist supplies that artist's tracks; results are not combined across libraries. An empty result, missing file paths, or a failed lookup tries the next local connection before the next configured catalog source. Jellyfin, Emby, and Subsonic honor the saved operator TLS verification setting. Shared Lidarr settings and export targets do not supply generation credentials. Ownerless legacy playlists have no local or Spotify connection.

Local results require real titles, artist credits, and server-reported file paths. These paths refer to the media server's filesystem; Digarr does not copy audio or verify that an exported M3U/XSPF player can access them. A user without permission to read paths may fall back to another source. Returning tracks does not verify playback. No new database migration or connection setting is required; rollback restores generation without local lookup and retains existing connections and generated tracks.

Destination matching is separate from local generation. Navidrome, Jellyfin, Emby, and Plex require an exact title and credited artist after case and whitespace normalization. They skip unmatched tracks and items without a usable title. A partial export marks the playlist job failed with added/skipped counts in Job History after all selected targets are attempted; local tracks and successful remote playlists remain available. Saved playlists reject empty generations and zero matches before remote writes, preserving the existing remote playlist. Jellyfin and Emby replacements add the new tracks in batches of 100 before removing the entries that existed beforehand; a failed update can leave the old entries plus some new ones, and the next successful update removes the extras. Separate create-only recommendation exports retain their existing empty-result behavior. These results do not verify remote playback.

Playlist details show the latest generation status, selected/resolved/included artist counts, and artists with no match, unavailable providers, lookup errors, or tracks excluded by the size limit. Search results must match the requested artist before selection.

MusicBrainz recordings are a final fallback for artists with an MBID. They supply real titles and recording IDs, not playable audio; M3U/XSPF exports link to MusicBrainz pages, and remote targets must resolve tracks again. When no resolver can run, generation records an unavailable outcome rather than inventing titles. Local outcome counts do not verify remote delivery or playback.

Regeneration replaces local tracks and refreshes the same remote playlist through a saved per-target binding. Creation reserves the binding first and checkpoints the returned ID before follow-up writes. If the response or checkpoint is lost, further creation stops for explicit recovery. A later population failure retains the ID for retry. Replacement has no remote rollback and may leave partial contents. Spotify and Navidrome propagate renamed playlists; Jellyfin, Emby, and Plex retain the existing remote name. Use one app replica: the in-process guard covers manual generation, cron, and recovery, but does not serialize replacement across replicas.

Bindings survive target disable/deselection and application backups. Deleting a local playlist or target removes its local bindings, never the remote playlists. Older versions did not save remote IDs, so the first export after upgrading creates one new playlist; existing copies are not adopted by name. Destination account/server changes stop exports. Spotify verifies the current account; Jellyfin/Emby verify server and configured user. Navidrome checks endpoint, authenticated username, and playlist owner; a rebuilt server preserving all of these plus the playlist ID cannot be distinguished. Plex binds the server and token fingerprint, so changing its token requires recovery even if the account is unchanged. Verified same-account credential rotation works for the other providers.

For a failed or changed destination, inspect Job History and `GET /api/v1/playlists/:id/exports`. Check the remote playlists before using `POST /api/v1/playlists/:id/exports/:targetId/reset` with `{ "acknowledgePossibleDuplicate": true }`. This API-only action forgets the binding, not the remote playlist; delete an unwanted remote copy yourself or deliberately retain it before the next export creates another. Missing/inaccessible remote IDs never trigger automatic recreation. Backups cannot undo writes already accepted by external services.

Audition playlists choose one track per pending artist without approving recommendations, and can refresh on demand or on a schedule. Their detail hint describes pending artists; other strategies describe approved recommendations. Generate a playlist before downloading its tracks. These playlists are separate from the Audition preview queue in Discover, which plays short previews in the browser. That queue selects pending recommendations even when a preview is unavailable. The Discover queue retains a dismissible summary of unavailable previews, including missing links, empty or failed lookups, browser blocking, and playback failures. Starting a new queue resets that summary; retrying an item replaces its previous outcome. An embed starting is not proof of a successful listen.

Admins can add webhook, ntfy, Telegram, and Apprise channels in Settings > Connections > Notifications, with scan-complete and scheduled-digest subscriptions per channel. Private-network destinations are blocked by default; the per-channel LAN option permits private IPv4 destinations for self-hosted services. It does not override your container or Kubernetes network policy.

Each digest channel has its own saved delivery position. Only its confirmed successful send or an empty activity window advances it. Failed channels retry from their saved start on the next scheduled run, with totals covering the longer interval; successful channels keep their own shorter interval. The first window start is saved before sending, so a failed first attempt survives a restart.

Disabling a channel or removing its digest subscription pauses its position. Removing a channel retains its position; reusing that ID resumes it, while a new ID starts from the current cron cadence. Editing an endpoint or type under the same ID keeps its position. Duplicate IDs are rejected on save; existing ambiguous IDs are skipped. The old shared position seeds existing channels once on upgrade, including when scheduling is disabled; previously lost windows cannot be reconstructed.

Delivery remains at least once: a crash after sending but before saving can duplicate a digest. Keep one app replica; the overlap guard is process-local. A consistent application backup includes the positions. Older JSON files without them bootstrap from their saved legacy position at startup or the next live tick after restore. See the [digest upgrade procedure](guides/switching-backends.md#digest-delivery-migration) before updating an existing database.

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

In Settings > Connections > Your connections, enter your Plex server URL and token, test the connection, select the music library and Plex listener, and save. Each Digarr user selects their own listener on the same shared server. Digarr uses that listener's playback history for recent and frequent artists, and Plex similarity metadata for discovery when available. Lidarr and a scrobbling service are optional; existing Charts and other sources can supplement Plex.

Settings reloads music-library names from your saved Plex connection. If Plex is unavailable or the selected library no longer exists, the saved section ID remains visible; loading the names does not change your selection.

A listener selection is required for listening-based discovery. Existing Plex connections continue to sync their libraries, but need this selection before contributing listening history. Changing the server or token clears the selection.

Digarr verifies the server identity and rejects history belonging to a different account instead of mixing profiles. A server or token that cannot expose the account list or playback history can still be used for library sync; Plex similarity data depends on the library's metadata agent.

History analysis allows at most 5,000 entries (25 pages) per requested period. If that period cannot be read completely within the limit, top-artist analysis reports a failure instead of returning partial totals; choose a shorter period or another listening source.

Plex history IDs can arrive as bare rating keys or `/library/metadata/<id>` paths. Entries without usable artist and track IDs are skipped, including plays of removed media. If a page contains in-range tracks but none are usable, Digarr logs a count-only warning. Dashboard listening requests do not create Job History entries; inspect the container logs when Plex has plays but the dashboard is empty.

Release Radar currently requires ListenBrainz, Spotify, or Last.fm for artist seeds, even when Plex listening works. It looks up new releases through MusicBrainz.

## Importing slskd downloads into Lidarr

For a linked slskd target, set **Download root as seen by Lidarr** to the completed-downloads folder that Lidarr can read, such as `/downloads`. Mount the same completed files into Lidarr or configure its path mapping. slskd stores each remote directory under its final folder name; multi-disc folders must be complete and unambiguous before import.

Digarr waits for every queued file to succeed, asks Lidarr to identify the files, and refuses rejected, partial, or ambiguous releases. It imports by moving the files and only reports completion after Lidarr's album tracks have files. Releases are limited to 500 files and 20 GiB, with paths no longer than 2,048 characters. Failed work retries after a one-hour cooldown using the same job; older duplicate failures remain as superseded history. Standalone slskd targets do not import into Lidarr.

If Digarr stops after submitting a download or import but before saving its confirmation, the next run may retry it or report a failure even though the external service accepted it. Check slskd transfers and Lidarr before retrying manually.

## Database connection settings

These apply to an external PostgreSQL server (`DATABASE_URL` or `DB_HOST`); embedded PGlite ignores them. Restart Digarr after changing them.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_PORT` | `5432` | Port used when the connection is assembled from `DB_HOST`, `DB_USER`, `DB_NAME`, and the password. Ignored when `DATABASE_URL` is set. |
| `DB_POOL_MAX` | `20` | Maximum connections in the application pool. Keep it below the server's `max_connections` minus other clients. |
| `DB_CONNECT_TIMEOUT_MS` | none for the application pool; `10000` for a backend-migration target | Milliseconds to wait for a new connection. Unset means the application pool waits without a limit, so a dead server can stall requests; set a value such as `10000` to fail fast. |

Individual queries are capped at 30 seconds server-side regardless of these settings.

## Backup & restore

Download application-level backups through Settings > Administration or the API.

Select a JSON backup and confirm that its included data will replace the destination data. Selecting a file or canceling the dialog sends no upload. The accepted restore sends `confirm=true`; an encryption-key mismatch opens a second warning and adds `force=true` only after **Restore Anyway**. Take a complete destination backup first and retain the matching encryption key. Restore can invalidate your session when users are replaced; sign in again afterward. The server's transaction, partial-backup safeguards, and key-mismatch checks remain unchanged; this UI correction adds no schema migration.

**Manual backup:** `POST /api/v1/admin/backup` takes a consistent snapshot of persistent application state, including artist dependencies, album blocks, library snapshots/overrides, playlists, and slskd jobs. `?includeCaches=true` also includes optional artist metadata; the filename then ends in `-with-caches`. Retain the matching encryption key separately. Sessions, pending authorizations, rate limits, and migration history are excluded; use a native database backup for exact rollback. See [backup boundaries and recovery](guides/switching-backends.md#backup-boundaries-and-recovery).

**Restore:** `POST /api/v1/admin/restore?confirm=true` accepts backup JSON or a multipart `file` upload. It replaces included tables in a transaction; it does not merge a backup into existing account data. Before clearing data, it checks omitted dependent tables and artist references. An unsafe partial backup returns `422 partial_backup_conflict` with affected table names and leaves the destination unchanged, even with `force=true`. Legacy partial files remain usable when dependencies exist and omitted destination state is unaffected. Restore does not fetch missing artists. Sessions and pending authorizations are invalidated when their users are replaced.

Take a complete destination backup first and prefer restoring into a fresh database. An encryption-key mismatch returns `409` without restoring. Restore with the original key, or explicitly add `&force=true` and re-enter the affected credentials afterward.

**Legacy OIDC data:** Older backups may contain an obsolete `oidcTokens` table. An empty table is ignored; nonempty rows are skipped with a warning and are never restored.

**Auto-backup before migrations:** On an existing database with pending migrations, Digarr attempts a backup to `DIGARR_BACKUP_DIR` (default: `./backups/`). It keeps the last 14 auto-backups, counted by migration runs rather than days. Files are named `pre-migrate-<UTC timestamp to the second>-<from>-<to>.json` and readable only by the app user (mode `0600`); a backup directory Digarr creates is `0700`, while an existing directory or volume keeps its permissions. A write that fails partway leaves no file behind, so it never counts as the latest backup or toward the 14. Copy backups off the server as well; a local volume does not protect against disk loss.

Automatic backups include the persistent application snapshot and optional metadata. The snapshot reads only the tables and columns the database already has, so an older schema that lacks what the new release adds still produces a backup. The file lists the omitted tables and columns under `absentSchema`. Restoring it never clears an omitted table, so a restore into a database that already holds rows in one (for example saved playlist exports after the upgrade) is refused as a partial-backup conflict; restore into a fresh database. A directory, snapshot-read, or write failure stops startup before migrations and logs one line saying so. Keep previous backups until a new one is written. Fresh databases skip this step. If the snapshot fails, take and verify a native consistent database backup, retain its exact encryption key and previous image, then fix the cause. `DIGARR_AUTO_BACKUP=false` bypasses the safety check, so only set it for a failure you understand and only for that upgrade.

### Upgrading from v1.19.0 to v2.0.0

This upgrade runs three migrations:

- **0052** adds `settings.digest_delivery_positions` for independent per-channel retry windows.
- **0053** adds `playlist_exports` to retain remote playlist IDs. Migration itself does not modify remote playlists; the first later export creates a binding rather than adopting an old playlist by name.
- **0054** adds `users.oidc_issuer` and replaces subject-only uniqueness with exact issuer/subject uniqueness. Legacy subjects keep a null issuer and are intentionally unbound. Local passwords and sessions remain usable; SSO-only users need [verified operator recovery](AUTHENTICATION.md#recovering-legacy-oidc-bindings). Verify the historical issuer and stored subject, never an email match or merely the current issuer setting.

1. Stop every app instance and other writers. Record the previous image and configuration, retain the exact `DIGARR_ENCRYPTION_KEY` separately, and keep a working local-admin login or session.
2. Take a native consistent backup: `pg_dump -Fc` for PostgreSQL, or an archive/snapshot of the entire stopped PGlite data volume. Verify restoration into a separate database or data directory with the previous compatible image and original key before upgrading. A readable archive listing alone does not verify recovery. Follow the [complete backup procedures](../deploy/docker/README.md#back-up-and-update).
3. v2.0.1 and later write the JSON pre-migration snapshot against the v1.19.0 schema without an override. v2.0.0 as released fails it (missing the fields and table added by 0052, 0053, and 0054); only if you are installing v2.0.0, and only after the native backup and separate restore are verified, set `DIGARR_AUTO_BACKUP=false` for this one upgrade. Investigate any other backup failure.
4. Start the new version once to run migrations. If legacy OIDC bindings exist, stop the app again and use the recovery helper's locked dry run, then `--apply`, for each verified identity. Keep every process off a PGlite directory while the helper uses it. Leave unverifiable accounts unbound.
5. If you set the override, re-enable automatic backups by removing it or setting `DIGARR_AUTO_BACKUP=true`. Restart, check `/health` for the intended version/backend, and verify local login, recovered SSO, saved connections, playlist outcomes, and digest scheduling. Keep the original backup and image until recovery is verified.

If admin settings responses from v1.19.0 were shared, review them for exposed fanart credentials or legacy webhook URLs and replace exposed credentials with their provider. v2.0.0 masks these values for admins and omits them for other users; upgrading does not revoke earlier exposure.

New JSON exports and backend copies preserve issuer/subject pairs and playlist bindings. Older JSON files remain partial and may be refused with `422 partial_backup_conflict` before writes, even when forced; old issuer-less subjects require recovery again. JSON exports exclude migration history and cannot restore an older schema.

For rollback, stop writers and restore the previous image's matching native backup into a **separate database or data directory**, using the original encryption key and configuration. Never start an older subject-only binary against migrated identities: identical subjects may now belong to different issuers. Older images also do not maintain export bindings and may create remote copies again. External playlist writes and notification sends cannot be rolled back; later application writes require a separately reviewed recovery.

**Recommendation owner backfill (migration 0055):** Recommendations stored without an owner, from single-user releases before per-user recommendations, are assigned to the first admin (the first user when no admin exists). Afterward only their owner can approve, reject, or bulk-update them; previously any signed-in user could. The migration only updates `recommendations.user_id`, adds no columns, and is safe to re-run. The automatic pre-migration backup covers it. Older images can still read the migrated database, but they again let every user act on these rows. To undo the ownership change exactly, restore the native or pre-migration backup into a separate database with the previous image.

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
