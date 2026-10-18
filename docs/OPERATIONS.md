# Configuration and operations

These notes describe v2.0.1. Start with the [README](../README.md) for installation. Most connection, playlist, notification, and maintenance settings live in the web UI; public origin and the environment settings below require a restart.

<a id="known-limitations-in-v1190"></a>

## Known limitations

| Area | What to expect |
|------|----------------|
| TIDAL | Experimental; authorization, refresh, and favorite-artist retrieval have no live-account validation. See [app setup and feedback](AUTHENTICATION.md#tidal-app-setup). |
| Debian fallback | The pre-release audit retains 43 HIGH findings across eight unique upstream vulnerabilities without an available fix. Alpine remains the default; the Debian/glibc variant remains an optional fallback. Both images drop every setuid/setgid bit, so the affected mount and su helpers cannot elevate privileges. See [#863](https://github.com/iuliandita/digarr/issues/863). This is not a clean image-scan result. |
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

Admins can inspect Job History for failures and partial results; the Failures only filter hides routine runs, and library sync rows name their source. After an outage, the Integrations list under Settings > System > Health shows each integration's last success and last error from the past 30 days of recorded jobs, so you can see what is still broken without reading runs one by one. It sends no probe traffic; an integration only updates when a job uses it ([API](API.md#jobs-admin)). The stuck detector checks at startup and every five minutes. It marks a running job `stuck` when its elapsed time exceeds these fixed limits:

| Job type | Time limit |
|----------|------------|
| Pipeline | 10 minutes |
| Quick discovery or subscription | 5 minutes |
| Target or playlist | 2 minutes |
| Library sync | 90 minutes |

This label does not stop the job or prove that it has stopped making progress. A slow, healthy run can cross the limit; check its progress before retrying.

## Connections and artist images

Settings > Connections lists saved server integrations and Your connections, including incomplete saved credentials. Use Add connection to search the grouped picker, select a service, and open its existing setup form. Save moves it into the list; Disconnect returns it to the picker. Missing server services appear in an extra admin group. Server rows are read-only for non-admins; their own connection forms remain editable.

The admin-only Show experimental integrations switch sits at the bottom of the picker. It controls the AudioMuse-AI connection, TIDAL app/personal rows, TIDAL and Bandcamp search-source choices, and experimental discovery-mode choices. It does not revoke credentials, stop scheduled jobs, or reject direct API requests. The setting defaults to off for new and upgraded installations. On first startup after upgrade, a missing preference is initialized to on only for saved TIDAL app credentials or any user's TIDAL OAuth connection. A completed legacy setup with only Bandcamp stays off; enable the toggle to reach Bandcamp search. An explicit saved choice always wins and survives restarts.

Artist images holds the TheAudioDB key, Fanart.tv key, image proxy, metadata fallback URL, and Wikidata switch previously under Recommendations > Advanced. Saves keep the existing API keys and scopes: Fanart.tv and the fallback URL remain personal preferences; AudioDB, proxy, and Wikidata remain server settings. Admins edit this row; members see it read-only. A partial-save notice distinguishes a successful personal write from a failed server write. Recommendations now saves scoring, genre, discovery, and approval preferences only.

This adds a boolean in the existing preferences JSON, with no schema migration. Existing backups remain readable. A normal application backup preserves the setting; an older image ignores it, and upgrading again preserves an explicit choice. No environment variables, container defaults, storage paths, or companion templates change.

## AudioMuse-AI audio similarity

AudioMuse-AI is an optional, experimental discovery source. Minimum supported version: **AudioMuse-AI v3.6.4**. Its API is unversioned; the adapter and synthetic response fixtures were checked against [v3.6.4](https://github.com/NeptuneHub/AudioMuse-AI/tree/v3.6.4) (commit `3564511de3c0b8d537afb1ff3aa11f06ec064af0`). No live AudioMuse-AI instance was available for validation.

1. Run AudioMuse-AI separately, connect its media server, finish setup, and analyze/index the music library. Digarr does not analyze or upload audio. Only artists in that index can be queried or returned, so this signal cannot discover music outside AudioMuse's indexed library. Before MusicBrainz resolution, Digarr removes names matching the user's library (including unreconciled artists) or blocked artists, using the filter stage's lowercase name comparison. Some libraries will produce no new recommendations.
2. As an admin, open **Settings > Connections > Add connection**, enable **Show experimental integrations**, and choose **AudioMuse-AI**. Enter its URL, including any reverse-proxy base path, and its optional `API_TOKEN`. A token is required if AudioMuse authentication is enabled; it is unnecessary when authentication is disabled.
3. Use HTTPS. AudioMuse v3.6.0 switched to HTTPS with a self-signed certificate on the same port. Prefer trusting its certificate; if necessary, enable **Skip TLS verification** for this trusted connection only. This setting is separate from the global TLS option. Leave it off for a valid certificate.
4. **Test connection** checks `/api/version` with the chosen credentials; it verifies reachability/authentication, not whether the artist index is ready. Save the connection, then run a normal scan. Hiding experimental integrations leaves saved connections active. Disconnect or clear the URL to stop all AudioMuse requests.

The source shares the scan's listening/liked and owned-library seed selection and seed limit. It sends seed **artist names** in `GET /api/similar_artists?artist=...&n=20` to the configured server. It sends an optional Bearer token in the Authorization header. It sends no audio, file paths, listening counts, or Digarr user IDs. Artist names can appear in that server's request logs. Calls use a 10-second timeout, no retries, and at most two concurrent lookups. Redirects are blocked by the existing HTTP helper; private network URLs are supported like other admin-managed media services.

Digarr sorts each seed's valid matches by increasing divergence, removes owned/blocked names and duplicate names, then maps their rank linearly onto `[0.5, 1.0]` (best match `1.0`; a single match also scores `1.0`). Raw divergence values are not mixed into other sources' similarity scores. Across seeds, names are deduplicated and the source contributes at most **50 candidates per scan** (`AUDIOMUSE_MAX_CANDIDATES`), admitting each seed's strongest remaining matches first until the cap is reached. Results enter the normal MusicBrainz resolution, filtering, and scoring pipeline as source `audiomuse`, using the existing **Similarity** weight and source consensus. No new score weight changes existing configurations. An unknown artist, one-off request failure, timeout, or incompatible response skips that seed; a malformed row is dropped without discarding valid neighbors. Authentication failure, an unavailable index, or two consecutive unreachable seed lookups disable the source for the rest of that scan. Job History records actual seeds queried, seeds with valid nonempty responses, and counts by skip reason. A source with results reports `ok`, retaining the skip counts even if all its matches were owned or blocked. Invalid saved URLs and unreadable tokens skip the source without failing the scan; re-enter an unreadable token in Connections. Probing an unreadable token returns a probe error. Other signals and the scan continue. No configured URL means no client, request, extra discovery work, or AudioMuse entry in job source results.

The URL, token, and TLS choice use existing settings preferences JSON; there is no migration or new environment variable. Only admins can read or change this connection and run its probe. Tokens are masked in API responses and field-encrypted when `DIGARR_ENCRYPTION_KEY` is configured, including the existing key-rotation paths. An empty token clears it; the `***` placeholder preserves it. Back up the database and encryption key normally. Older Digarr versions ignore these optional preferences; rollback disables this integration, and upgrading again reuses the saved connection. No container, port, volume, Helm, or Unraid companion changes are required.

The checked source files are `app_artist_similarity.py`, `tasks/artist_gmm_manager.py`, `app.py`, `app_auth.py`, `error/error_dictionary.py`, `error/error_manager.py`, and `error/responses.py`. The route accepts `artist` or media-server `artist_id` and `n`, not `name`, `id`, or `limit`. It returns a bare array of `{artist, artist_id, divergence}`. Media-server IDs are never used as MusicBrainz IDs. Error 1004 is HTTP 404 (unknown artist/no neighbors); 3002 is HTTP 503 (index unavailable), while other 503s can mean a database or index failure. The adapter checks the numeric error code and does not infer an empty index from HTTP status alone.

## Boolean environment settings

`DIGARR_DISABLE_REGISTRATION`, `DIGARR_ALLOW_INSECURE_COOKIES`, `PROXY_AUTH_ENABLED`, and `SKIP_TLS_VERIFY` accept `true`, `false`, `1`, or `0`, in any letter case. Any other value stops startup with an error naming the variable. Earlier releases read every unrecognized value, including `TRUE`, as `false`; check these variables before upgrading. An empty value keeps the default.

## Scrobbler write-access environment

| Variable | Purpose |
|----------|---------|
| `LASTFM_SHARED_SECRET` | Optional server-side Last.fm app secret for per-user write authorization. Must match the API key users save. Read-only Last.fm does not need it. |
| `LASTFM_SHARED_SECRET_FILE` | Alternative readable secret-file path; do not publish the file contents. |
| `DIGARR_ENCRYPTION_KEY` | Required before connecting Last.fm write sessions; retain with backups. |
| `ALLOWED_ORIGIN` | Public origin used for the Last.fm callback by the Account UI. |

Restart after changing these settings. Users authorize their own sessions and enable sending separately in Account; there is no global opt-in. Unraid operators can add these optional variables manually without changing the baseline template. See [scrobbler write-back](AUTHENTICATION.md#scrobbler-write-back) for data sent, failure reporting, backup, and rollback behavior.

## Unattended setup

Keep first-boot access restricted until the intended admin account is verified. Migrations and configured initial-admin creation finish before HTTP opens. With no users, set both `DIGARR_INITIAL_USERNAME` and a `DIGARR_INITIAL_PASSWORD` of at least 12 characters, or leave both unset for manual registration. A partial pair, short password, or database failure stops startup. Existing users bypass these bootstrap settings without password or role changes; keep one app instance per database.

For unattended service setup, also set `AI_PROVIDER` and `AI_MODEL`. This separate initializer still runs after HTTP opens; it no longer controls whether the initial admin is created. Add listening services and targets in Settings or supply supported environment settings. See [`.env.example`](../.env.example) for local development and [`deploy/docker/.env.example`](../deploy/docker/.env.example) for Compose.

Before upgrade, review both bootstrap variables and retain a consistent database backup, matching encryption key, and previous image. If first boot stops, correct the pair or intentionally unset both for restricted manual registration, verify database availability, and restart. If another account already exists, verify who owns it; bootstrap never replaces it. This correction adds no schema migration. Rollback restores the previous startup race and weak/partial-credential skip behavior; keep access restricted, and use a compatible image and its matching backup if other migrations have run.

## Discovery modes and schedules

Open Discover > Discovery Modes (`/discovery-modes`) for both manual and scheduled discovery. Your modes lists saved schedules and recently run modes as compact rows. Expand a saved row to edit it or review its run history; pause, resume, run, and delete controls remain beside the row. Bulk pause and resume are available when you have multiple schedules.

Choose Run a mode to search the mode picker. Modes that need a connection show the reason there. The experimental toggle shares the Connections preference. Pick a mode, adjust its Easy or Advanced settings, then choose Run now or Schedule. Schedule keeps those settings inside the same mode card. Choose a schedule preset or Custom for a validated cron expression and cron preview. More options holds the prefilled name, artist limit, and scoring preset. New schedules start enabled; pause or resume them with the row switch. Expanding a saved row uses the same compact editor. Preset and import schedules remain editable, with their source shown. Presets and imports in the add flow retains CSV, M3U, XSPF, playlist, and connected-service imports, plus custom genre and similar-artist subscriptions.

Recent manual runs are remembered in this browser for the signed-in account, including the settings used. Admin accounts also read their own entries from Job History. The existing job API is admin-only, so member accounts record that a manual run started without claiming a completion or result count.

Old `/subscriptions` and `/discover/modes` URLs redirect to the unified page and keep query parameters. A `?mode=<id>` link still opens and focuses that mode; `?genre=<name>` still prefills a genre schedule. The subscription and discovery-mode REST APIs are unchanged.

Settings > Schedule lists scan, mode, playlist, library-sync, and notification-digest schedules, with links to their editors. Everyone can review their own mode and playlist schedules; scan, library-sync, and digest configuration remains admin-only. The global Scheduled generation switch now lives here. A saved playlist schedule stays paused while that switch is off; manual generation still works.

## Playlists and notifications

Add media-server playlist destinations in Settings > Targets, then select those targets in each playlist. A successful Spotify connection attempts to create a user-owned Spotify Playlist target automatically; select that target in the playlist. The Add Target dialog does not offer Spotify. If the target is missing after connecting, ask an admin to inspect the logs and create it through the targets API.

Digarr keeps the generated playlist locally if an export fails; admins can inspect the error in Job History. Spotify exports need a connected account with playlist permissions. Regeneration fails and keeps the previous tracks when the selected artists yield no tracks, when more than half of them hit track-source errors, or when the playlist has no owner; the failed job records the per-artist resolution. An empty selection, such as no approvals yet, still produces an empty playlist.

Scheduling is off by default. An admin turns it on with the Scheduled generation switch in Settings > Schedule, which saves `{ "preferences": { "playlistEnabled": true } }` through `PATCH /api/v1/settings`; the API call works too. While it is on, the switch row shows when the next generation runs; while it is off it shows a "Paused" hint, and no scheduled playlist regenerates. Check `GET /api/v1/playlists/scheduler` (`enabled`) to confirm the global switch. Each playlist also needs a schedule; a playlist without one is generated by hand only. The playlist form has no Enabled switch, and the API ignores `enabled`. Upgrading clears the schedule on any disabled playlist that had one (migration 0057), so it stops running on its own while its tracks and exports stay. Restoring an older backup applies the same rule. Manual generation works independently of the global switch.

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

Admins can add webhook, ntfy, Telegram, and Apprise channels in Settings > Connections > Notifications, with scan-complete and scheduled-digest subscriptions per channel. The digest schedule (cron) is in Settings > Schedule, next to the other schedules. Private-network destinations are blocked by default; the per-channel LAN option permits private IPv4 destinations for self-hosted services. It does not override your container or Kubernetes network policy.

Each digest channel has its own saved delivery position. Only its confirmed successful send or an empty activity window advances it. Failed channels retry from their saved start on the next scheduled run, with totals covering the longer interval; successful channels keep their own shorter interval. The first window start is saved before sending, so a failed first attempt survives a restart.

Disabling a channel or removing its digest subscription pauses its position. Removing a channel retains its position; reusing that ID resumes it, while a new ID starts from the current cron cadence. Editing an endpoint or type under the same ID keeps its position. Duplicate IDs are rejected on save; existing ambiguous IDs are skipped. The old shared position seeds existing channels once on upgrade, including when scheduling is disabled; previously lost windows cannot be reconstructed.

Delivery remains at least once: a crash after sending but before saving can duplicate a digest. Keep one app replica; the overlap guard is process-local. A consistent application backup includes the positions. Older JSON files without them bootstrap from their saved legacy position at startup or the next live tick after restore. See the [digest upgrade procedure](guides/switching-backends.md#digest-delivery-migration) before updating an existing database.

## Library health

Library > Health (`/library?tab=health`) offers scheduled sync and `Sync Now`. Failed album fetches preserve the previous library snapshot. When the last health scan failed or was partial, the page shows a warning with the stored error. Admins can inspect failures in Settings > System, which contains Job History and Health sections. The Tools menu keeps one Job History shortcut to `/settings?tab=system#jobs`. Library > Reconciliation (`/library?tab=reconciliation`) contains artist and album matching controls. Old `/library/health` and `/library/reconciliation` links redirect to the matching Library tab; `?tab=jobs` and `?tab=system-health` resolve to the matching System section.

## Lidarr connection and targets

Settings > Connections holds the one server Lidarr connection: URL, API key, TLS setting, and the default quality profile, metadata profile and root folder (under "Your Lidarr preferences" in the Lidarr card; each user can set their own). Library sync, genres and approvals all use it. A Lidarr target in Settings > Targets shows as "Lidarr (server connection)" and stores its owner, name, enabled flag and optional default tags; changing the connection takes effect for approvals right away.

To send approvals to another Lidarr, tick "Use a different Lidarr instance" on the target and enter its URL and key. Save it, then edit it to pick that instance's profiles, root folder and tags. Changing the URL or key clears those picks, including tags; save and edit again to choose from the new instance. Approvals to it never use the server connection's IDs; an unset ID uses that instance's first profile or root folder. The approve dialog shows monitoring first and keeps the profile, folder and tag pickers under "Lidarr options", loaded from the instance the target uses.

Monitoring offers All, Future releases only, Missing albums, Existing albums, Latest album, First album, Selected albums, Popular albums and None. The four additional native modes are also available in Settings > Recommendations > Auto-approve monitoring. Only All requests an immediate missing-album search; selected/popular keep their album-specific searches.

To label discovery adds, save a Lidarr target, then edit it in Settings > Targets to choose its default tags. Tags are per-target even when it uses the server connection. Pick existing tags or create one by name. Each approval can override the tags under Lidarr options; unchecking all tags sends none. Auto-approval uses the target defaults. Album approvals apply tags only if they add a missing artist; existing artists keep their tags. Changing the server URL or key clears the tags on its reference targets; switching a target between connection modes clears its tags too. Save and edit again to choose tags from the new instance.

These additions require no database migration. Existing targets keep an empty tag list, and existing monitoring defaults remain valid. Before rolling back to a version without these modes, change any auto-approve setting using a new mode to All, Future releases only or None; older versions ignore tag configuration. The normal backup procedure is sufficient.

**Upgrading:** at startup, Lidarr targets whose URL and API key match the server connection (scheme and host compared without letter case, default ports and a trailing slash ignored, path compared exactly) are converted to server-connection targets. Other Lidarr targets stay separate instances with no default IDs, so they use the instance's first profile and folder until you pick them; before this change they received the server connection's IDs, which pointed at the wrong instance. The conversion runs every start and skips converted rows. A backup restored from an older version keeps the old copies until the next start converts them. Rolling back to an older image needs the pre-upgrade backup: older versions cannot read a server-connection target and fail approvals to it until you edit it back to a URL and key.

### Approvals during a Lidarr outage

Manual, bulk, album and automatic approvals stay in Approved as "Waiting for Lidarr" when Lidarr returns 408, 429 or 5xx, times out, refuses/resets a connection, or reports an unavailable metadata/SkyHook lookup. Validation, authentication and invalid profile/folder errors still fail immediately. Artist approvals reuse an artist already in Lidarr, including on the first attempt. An album missing from an existing artist fails immediately; a missing album is temporary only when that attempt just added the artist and metadata may still be refreshing. Retry attempts run every five minutes, after delays of 5 minutes, 15 minutes, 1 hour and then 3 hours, for up to 24 hours from the first failure. Each attempt appears in Job History. The card shows the next retry time; Retry attempts it immediately without resetting that window. After expiry, a manual Retry starts a new window using the saved options.

The queue and original approval options live in the recommendation's target actions and survive restarts. Each retry resolves the target owner's current connection and that instance's defaults. Disabled, deleted or reassigned targets are skipped until the window expires. Before another artist add, Digarr checks that instance for its MusicBrainz ID; album retries reuse an existing artist and album. Before each due attempt, artist and album blocks for that user are checked; blocked actions fail without an expiry alert. One failing recommendation does not stop later queued work, and retries that remain waiting preserve the original approval time. Adds and commands are never retried by the HTTP transport.

After 24 hours, the action becomes failed with its last error. Successful target actions take precedence in the recommendation status, followed by queued or waiting work, then failure. Remaining waiting actions keep retrying even after another target succeeds. Stored retry errors, Job History failures and expiry notifications redact credentials and URLs, with a 2,048-character limit. Enable "Approval failed" on a notification channel to receive one expiry alert per recommendation through the existing webhook, ntfy, Telegram or Apprise transport. This event is off for existing channels. The terminal state is saved before sending the alert, so a failed delivery is not sent again on later ticks.

No schema migration is needed. Take the normal database backup before upgrading; it includes queued approvals. Before rolling back to an older version, finish or manually resolve waiting approvals, since older versions do not schedule this state. Restore the pre-upgrade backup with the earlier image if you need to restore its previous approval state. The retry scheduler, like the other in-process schedulers, assumes one running Digarr process per database.

## Shared-instance approval requests

Admins configure approval policies, score thresholds, and optional open-request limits in user management. The default remains direct approval. Request-only users submit for review; trusted users submit below their threshold. Admins review Requests with the requester's score and reasons, then approve or decline with an optional note. Decisions use the requester's targets and saved artist/album choices, including Lidarr deferred retry. Pending and declined requests appear on the requester's Approved tab. Request-outcome notifications require a personal channel in Settings > Account with an explicit request-outcome event subscription. They use the requester's language and channels, never global admin channels as a fallback; private notes stay in the request history. Personal channels cannot disable private-address protection.

A failed target add leaves the request pending with its error visible for retry or decline and sends no outcome notification. Waiting for Lidarr counts as approved and the personal notification explains the wait. A decline blocks the same recommendation or missing album from being requested again for 24 hours. Member scans do not use global admin notification channels. Temporary missing-album request rows are excluded from Pending, feedback, taste, and analytics, and are deleted with their empty batch on decline or failed request creation.

### Approval-request migration

Migration 0059 adds `approval_requests` and admin-managed policy fields to `users`. It includes a plain recommendation-reference index. Request references can become null when temporary recommendations are deleted; saved target identity preserves history and the decline cooldown. Existing users default to direct approval; no external acquisition is triggered by migration. Both PostgreSQL and PGlite apply it at startup. Before upgrading, stop app writers, take and verify a consistent native database backup, and retain the matching encryption key and previous image. Automatic pre-migration snapshots tolerate the absent table and columns; keep automatic backups enabled.

After upgrading, verify a request-only test account cannot add directly, then approve its request as an admin and check the requester's assigned target. Full JSON exports and backend copies include policy settings and request history; request identity uses its stable token and related records are remapped during restore. Older exports without requests cannot clear populated omitted request state through parent replacement; use a complete export or a fresh compatible destination.

Older images do not enforce these policies. Rolling back only the image makes affected users able to approve directly again and leaves request history unused. Restrict member access during rollback. For exact recovery, restore the verified pre-upgrade native backup into a separate database with the matching previous image and key, verify it, then replace the original. Remote additions and notifications already sent cannot be undone by restoring a database. Do not drop the live request table as a rollback procedure. See [backend recovery](guides/switching-backends.md#approval-request-migration).

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

In Settings > Connections, choose Add connection > Plex if it is not listed. In its form, enter your Plex server URL and token, test the connection, select the music library and Plex listener, and save. Each Digarr user selects their own listener on the same shared server. Digarr uses that listener's playback history for recent and frequent artists, and Plex similarity metadata for discovery when available. Lidarr and a scrobbling service are optional; existing Charts and other sources can supplement Plex.

Settings reloads music-library names from your saved Plex connection. If Plex is unavailable or the selected library no longer exists, the saved section ID remains visible; loading the names does not change your selection.

A listener selection is required for listening-based discovery. Existing Plex connections continue to sync their libraries, but need this selection before contributing listening history. Changing the server or token clears the selection.

Digarr verifies the server identity and rejects history belonging to a different account instead of mixing profiles. A server or token that cannot expose the account list or playback history can still be used for library sync; Plex similarity data depends on the library's metadata agent.

History analysis allows at most 5,000 entries (25 pages) per requested period. If that period cannot be read completely within the limit, top-artist analysis reports a failure instead of returning partial totals; choose a shorter period or another listening source.

Plex history IDs can arrive as bare rating keys or `/library/metadata/<id>` paths. Entries without usable artist and track IDs are skipped, including plays of removed media. If a page contains in-range tracks but none are usable, Digarr logs a count-only warning. Dashboard listening requests do not create Job History entries; inspect the container logs when Plex has plays but the dashboard is empty.

Release Radar currently requires ListenBrainz, Spotify, or Last.fm for artist seeds, even when Plex listening works. It looks up new releases through MusicBrainz and skips albums already in your synced library, so run a library sync first if owned albums still show up.

## Importing slskd downloads into Lidarr

When a Lidarr target is linked, **Download root as seen by Lidarr** (`lidarrDownloadPath`) is required. Creating or updating a linked target without it returns HTTP 400. Existing saved targets still load, but their jobs fail before searching or queueing with an error in Job History. Open Settings > Targets, set the path, then retry the failed job. No migration is needed; rolling back removes this early check.

For a linked slskd target, set **Download root as seen by Lidarr** to the completed-downloads folder that Lidarr can read, such as `/downloads`. Mount the same completed files into Lidarr or configure its path mapping. slskd stores each remote directory under its final folder name; multi-disc folders must be complete and unambiguous before import.

Set **Minimum search gap in seconds** on each slskd target to pace search creation (default 3 seconds, clamped to 1-60 seconds). The worker spaces consecutive searches, including across overlapping ticks in this process. HTTP 409/429 leaves jobs searching without consuming an acquisition attempt; the target backs off for 10, 20, 40, then at most 60 minutes, retrying when a later 10-minute scheduler tick is due. Backoff and pacing are in memory and reset on restart. Search POSTs are never retried at the HTTP layer.

The saved target's connection test first checks slskd, then asks the linked, same-owner Lidarr to browse `lidarrDownloadPath`. It checks that the directory appears in its parent listing and requests its contents without files. A missing directory, failed request, or invalid listing reports a path problem; a path containing an `incomplete` or `in-progress` folder reports a separate warning. An empty directory is valid. Lidarr can silently return an empty listing for a permissions error, so a passing probe cannot guarantee read access to an empty folder, file access, or that two containers see the same files. It also cannot prove that a custom-named folder is slskd's completed directory. Verify those mappings and permissions before downloading.

For example, mount slskd's completed host directory at `/downloads` in Lidarr and set `lidarrDownloadPath` to `/downloads`, even if slskd sees it as `/app/downloads`. Do not point it at the incomplete directory or the final music library. The test uses the saved configuration, so save changes before testing. Existing targets keep the 3-second default; there is no schema migration or volume change, and rolling back restores the previous search behavior.

Digarr waits for every queued file to succeed, asks Lidarr to identify the files, and refuses rejected, partial, or ambiguous releases. It imports by moving the files and only reports completion after Lidarr's album tracks have files. Releases are limited to 500 files and 20 GiB, with paths no longer than 2,048 characters. When several peers share the same release, Digarr picks one with a free upload slot, then the shortest queue, then the fastest upload speed. Failed work from the Lidarr wanted list retries up to three times with growing waits (1 hour, 6 hours, 24 hours), skipping the peer and folder that already failed, and then stays failed with the attempt count in its error; approving the release again retries it, resets the count, and clears the skipped peers so a release that failed for a setup reason can be picked again. Retries reuse the same job; older duplicate failures remain as superseded history. Standalone slskd targets do not import into Lidarr.

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

**Personal API tokens:** Settings > Account > API tokens manages named script credentials with read, write, or admin scope and optional expiry. Copy each token on creation; the value cannot be shown again. Revoke it from the list when no longer needed. Browser logout and password changes do not revoke these tokens. See [token usage and permissions](AUTHENTICATION.md#personal-api-tokens).

Migration 0057 adds `api_tokens` without changing existing sessions or legacy credentials. Take a complete consistent database backup before upgrading and retain the encryption key. Startup applies the migration automatically on PostgreSQL and PGlite. Personal API tokens are excluded from JSON backups and backend copies and must be recreated after restoring onto a fresh instance. Restore ignores any `apiTokens` key in older or newer files. A restore that replaces or removes users deletes those users' tokens by cascade; tokens remain valid when their users are left unchanged. Personal tokens never block disaster recovery. Native snapshots include tokens and can reactivate revoked credentials after native recovery, so review and revoke them afterward. Older images ignore the new table, so rollback leaves it unused and personal tokens stop working. Use the previous session/legacy authentication after rollback; upgrade again to resume token support. Exact database rollback requires the matching native backup. See [the migration procedure](guides/switching-backends.md#personal-api-token-migration).

**Manual backup:** `POST /api/v1/admin/backup` takes a consistent snapshot of persistent application state, including artist dependencies, album blocks, library snapshots/overrides, playlists, and slskd jobs. `?includeCaches=true` also includes optional artist metadata; the filename then ends in `-with-caches`. Retain the matching encryption key separately. Sessions, personal API tokens, pending authorizations, rate limits, and migration history are excluded; use a native database backup for exact rollback. See [backup boundaries and recovery](guides/switching-backends.md#backup-boundaries-and-recovery).

**Restore:** `POST /api/v1/admin/restore?confirm=true` accepts backup JSON or a multipart `file` upload. It replaces included tables in a transaction; it does not merge a backup into existing account data. Before clearing data, it checks omitted dependent tables and artist references. An unsafe partial backup returns `422 partial_backup_conflict` with affected table names and leaves the destination unchanged, even with `force=true`. Legacy partial files remain usable when dependencies exist and omitted destination state is unaffected. Restore does not fetch missing artists. Sessions and pending authorizations are invalidated when their users are replaced.

Take a complete destination backup first and prefer restoring into a fresh database. An encryption-key mismatch returns `409` without restoring. Restore with the original key, or explicitly add `&force=true` and re-enter the affected credentials afterward.

**Legacy OIDC data:** Older backups may contain an obsolete `oidcTokens` table. An empty table is ignored; nonempty rows are skipped with a warning and are never restored.

**Auto-backup before migrations:** On an existing database with pending migrations, Digarr attempts a backup to `DIGARR_BACKUP_DIR` (default: `./backups/`). It keeps the last 14 auto-backups, counted by migration runs rather than days. Files are named `pre-migrate-<UTC timestamp to the second>-<from>-<to>.json` and readable only by the app user (mode `0600`); a backup directory Digarr creates is `0700`, while an existing directory or volume keeps its permissions. A write that fails partway leaves no file behind, so it never counts as the latest backup or toward the 14. Copy backups off the server as well; a local volume does not protect against disk loss.

Automatic backups include the persistent application snapshot and optional metadata. The snapshot reads only the tables and columns the database already has, so an older schema that lacks what the new release adds still produces a backup. The file lists the omitted tables and columns under `absentSchema`. Restoring it never clears an omitted table, so a restore into a database that already holds rows in one (for example saved playlist exports after the upgrade) is refused as a partial-backup conflict; restore into a fresh database. A directory, snapshot-read, or write failure stops startup before migrations and logs one line saying so. Keep previous backups until a new one is written. Fresh databases skip this step. If the snapshot fails, take and verify a native consistent database backup, retain its exact encryption key and previous image, then fix the cause. `DIGARR_AUTO_BACKUP=false` bypasses the safety check, so only set it for a failure you understand and only for that upgrade.

**Duplicate cleanup before unique indexes:** When migration 0024 or 0028 is still pending, Digarr collapses rows those unique indexes would reject, right after the backup and in one transaction. Duplicate library sync state and match override rows (including rows with no user) keep only the newest. A duplicate email or SSO subject stays on the oldest account and is cleared on the others; their data, passwords and roles are untouched. The log lists counts per table and the affected user ids, so review those accounts and re-link SSO where needed. The pre-migration backup keeps the original rows if you need to look up a removed override or cleared value; with `DIGARR_AUTO_BACKUP=false`, the cleanup still runs, so take your native backup first. Databases already past these migrations skip this step.

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

**Album block titles (migration 0056):** Adds a nullable `album_blocks.album_title` column (`ADD COLUMN IF NOT EXISTS`, safe to re-run) and fills it for new permanent album rejects. Existing blocks keep a null title and show their release-group ID. The automatic pre-migration backup covers it. Older images ignore the extra column, so rolling back the image works without restoring; restore the pre-migration backup with the previous image only if you need the database byte-for-byte as before.

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
