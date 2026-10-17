# Screenshots

The checked-in screenshots use the Youtarr theme. Most were captured from
v1.10.0; Analytics was refreshed from v1.12.0. Discovery Modes, Settings, and Your Connections show v1.15.1 (`d276d94`) in their footers; Library Reconciliation shows v1.14.0. The Account capture was added with v1.17.0 (commit `e36d7d8a`); its exact running build was not recorded.

The descriptions below reflect v2.0.1. The captures predate its genre-priority controls, playlist generation outcomes, Audition failure summary, and dashboard history states; these are described below rather than shown in the older images. Capture a fresh set with
`bun scripts/capture-screenshots.ts`; see that script's header for environment
variables.

The web UI refresh tracked in [#889](https://github.com/iuliandita/digarr/issues/889) changes the font, type scale and surface styling; these captures predate it and will be recaptured once the refresh is complete.

In v2.0.0, first-time browser setup starts with account creation before the existing wizard. These captures do not show that onboarding order; form layouts and translated labels are unchanged.

## Dashboard (dark)

![Dashboard](screenshots/dashboard-dark.png)

In v1.19.0, listening tiles distinguish an unconfigured account, empty history, and a failed fetch. Network or request failures retain cached entries with a retry notice. In v2.0.0, upstream failures returned by the API as HTTP 200 with `status: error` also retain cached entries and show a retry notice; v1.19.0 can replace them with an empty error state ([#770](https://github.com/iuliandita/digarr/issues/770)).

## Dashboard (light)

![Dashboard Light](screenshots/dashboard-light.png)

## Discover

![Discover](screenshots/discover.png)

The normal Run Scan action is artist-focused. Use Library Gap-Fill or Release Radar for album recommendations. The empty state also links to the default-off net-new album discovery setting. In v2.0.0, that toggle persists; v1.19.0 cannot save it ([#791](https://github.com/iuliandita/digarr/issues/791)). The links reveal the requested discovery mode or setting. In v2.0.0, non-admin saves omit global writes and shared AudioDB/Wikidata controls are shown only to admins; personal image settings stay visible. Admins receive an explicit partial-save notice if only their later global save fails. v1.19.0 retains the false save failure described in [#792](https://github.com/iuliandita/digarr/issues/792); read back user preferences there to verify the saved value. The existing admin layout is unchanged.

Since v1.19.0, Discover can order and browse genre-priority groups without changing scores. The Audition queue retains a dismissible summary of unavailable-preview reasons after skipping items or finishing.

Since the UI refresh (captures above predate it), the Discover toolbar is one row: status and kind controls, the view switch, a Filters popover (discovery order and decades) and a More menu with the bulk actions (approve above or reject below a threshold, Audition, Select), export, metadata refresh, Clear All and feedback insights. On small screens it is two rows and the view switch moves into More. Grid cards lead with the artist image and keep a single action row; streaming links and the metadata cache dot sit in the expanded card. Reject opens the same reason picker in every view, with a one-click "Reject without a reason" path. The mood search is a button until you click it or press `/`. Keyboard shortcuts are listed in the `?` dialog.

## Discovery Modes

![Discovery Modes](screenshots/discovery-modes.png)

Discovery Modes lives on its own page at `/discover/modes`, reached from the Discovery Modes tab on Discover. The shipped modes are ListenBrainz (Artist Radio, User Radio, Tag Radio, Similar Users Quick/Deep), Release Radar, Library Gap-Fill, Similar Artist Web, Artist Relationships (MusicBrainz graph), Labels (Discogs co-label artists), Charts (Last.fm global/regional), Deezer Flow, Spotify Saved Albums, Spotify Followed Artists, TIDAL Favorite Artists, and Subsonic Starred. Modes that need a connected account stay disabled until you connect it, and each blocked card shows an explicit reason. Manual runs preflight Artist Radio seeds and record job-backed feedback instead of a blind "started" toast. A `?mode=<id>` deep link scrolls to, focuses, and highlights the requested mode card.

TIDAL Favorite Artists carries an "Experimental" badge on both its mode card (visible in the image above) and its Settings connect card under Your Connections. Live-account validation of connect, refresh, and populated favorite-artist results is deferred; see [TIDAL feedback](AUTHENTICATION.md#tidal-feedback) for how to report a test safely.

## Search

![Search](screenshots/search.png)

Since the UI refresh, the provider toggles sit under a collapsed Sources section, because every available source is searched by default; its title counts the sources narrowing a search.

## Genres

![Genres](screenshots/genres.png)

## Genre Detail

![Genre Detail](screenshots/genre-detail.png)

## Playlists

![Playlists](screenshots/playlists.png)

Since v1.18.0, the playlist form also offers Audition: one track per pending artist, with the existing schedule and target controls.

In v1.19.0, playlist details also show the latest local generation outcome, selected/resolved/included artist counts, and per-artist lookup or size-limit results. These do not verify remote delivery or playback.

## Subscriptions

![Subscriptions](screenshots/subscriptions.png)

## Library Health

![Library Health](screenshots/library-health.png)

## Library Reconciliation

![Library Reconciliation](screenshots/library-reconciliation.png)

Shipped in `v0.17.0`: unreconciled-artist review plus manual correct/ignore override flow. Extended in `v0.19.0` with unreconciled-album review and album override persistence. Since `v1.15.0`, the view labels each artist and album as no match found, ambiguous match, or lookup failed; eligible rows can be selected, then ignored together through a confirmation dialog. Artist selection covers visible rows, album selection stays on the current page, and failed lookups remain available for retry instead of bulk ignore.

## Library Sources Panel

![Library Sources Panel](screenshots/library-sources.png)

Admin panel on the Library Health page. Shipped in `v0.17.0` and expanded in `v0.18.0` with per-source album sync counts and snapshot status. Polished in `v0.19.0` with album sync coverage summaries.

## Analytics

![Analytics](screenshots/analytics.png)

The Discovery over time chart shows per-batch recommendation totals, with the approved portion in green.

## Settings

![Settings](screenshots/settings.png)

Since the UI refresh, Settings sections sit in a grouped side menu (Personal, Library & services, Admin) on desktop and a grouped select on small screens; the capture above predates it. Each service is a collapsed row with its status (Not configured, Saved, Test passed, Test passed - not saved yet, Error, or Connected for OAuth links), and rarely used fields sit in collapsed Advanced blocks.

In v1.18.0, the Settings > Targets flow includes `slskd` target creation with an optional linked Lidarr target and a download root visible to Lidarr. The Plex connection card also has a per-user listener selector populated by Test Connection; these controls are newer than the capture above.

In v1.19.0, Settings > Recommendations includes optional primary and secondary genre lists for Discover ordering and browsing.

In v2.0.0, Settings > Administration asks for confirmation before uploading a selected backup. A key mismatch requires a separate **Restore Anyway** confirmation. These dialogs are not shown in the existing Settings capture; they use the shared translated confirmation dialog and existing theme styles.

## Settings > Account

![Account](screenshots/settings-account.png)

The Account page offers password-confirmed SSO linking when OIDC is enabled and the local account is not linked yet. Linked accounts show their status; callback outcomes appear in a dismissible message. A Tips section brings back dismissed help tips. This capture uses a sample account with OIDC enabled.

## Settings > Connections > Your Connections

![Your Connections](screenshots/settings-your-connections.png)

This older capture shows ListenBrainz, Last.fm, Spotify, Deezer, and TIDAL, plus the top of the Plex card. The current Your Connections UI also includes Jellyfin, Emby, Subsonic, and Discogs. Input values and the instance host are redacted in the capture. The TIDAL card carries the Experimental badge while live-account connect, refresh, and populated favorite-artist results remain unverified; connecting TIDAL requires an admin to configure the app credentials first. See [TIDAL feedback](AUTHENTICATION.md#tidal-feedback) for safe community reporting.

## Settings > Blocked

The screenshot capture script can produce `settings-blocked.png` for Settings > Blocked. That surface now includes separate permanent artist and album blocklists; no `settings-blocked.png` artifact is currently checked in.
