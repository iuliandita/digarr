# Screenshots

The checked-in screenshots use the Youtarr theme. Most were captured from
v1.10.0; Analytics and Settings were refreshed from v1.12.0, and Library
Reconciliation was refreshed from the current `develop`/`:nightly` UI. The
descriptions below reflect that UI when later features are not visible in an
image. Capture a fresh set with `bun scripts/capture-screenshots.ts`; see that
script's header for environment variables.

## Dashboard (dark)

![Dashboard](screenshots/dashboard-dark.png)

## Dashboard (light)

![Dashboard Light](screenshots/dashboard-light.png)

## Discover

![Discover](screenshots/discover.png)

The normal Run Scan action is artist-focused. Album recommendations are produced by Library Gap-Fill, Release Radar, or the default-off net-new album discovery preference. If the Albums filter has no results, its empty state links to each producer and reveals the requested discovery mode or setting.

## Discovery Modes

![Discovery Modes](screenshots/discovery-modes.png)

Discovery Modes lives on its own page under the Discover menu at `/discover/modes`. The shipped modes are ListenBrainz (Artist Radio, User Radio, Tag Radio, Similar Users Quick/Deep), Release Radar, Library Gap-Fill, Similar Artist Web, Artist Relationships (MusicBrainz graph), Labels (Discogs co-label artists), Charts (Last.fm global/regional), Deezer Flow, Spotify Saved Albums, Spotify Followed Artists, TIDAL Favorite Artists, and Subsonic Starred. Modes that need a connected account stay disabled until you connect it, and each blocked card shows an explicit reason. Manual runs preflight Artist Radio seeds and record job-backed feedback instead of a blind "started" toast. A `?mode=<id>` deep link scrolls to, focuses, and highlights the requested mode card.

TIDAL Favorite Artists carries an "Experimental" badge on both its mode card and its Settings connect card, because its OAuth flow has not yet been validated against a live TIDAL account. No capture of the TIDAL connect card exists yet; it is pending a successful live connect.

## Search

![Search](screenshots/search.png)

## Genres

![Genres](screenshots/genres.png)

## Genre Detail

![Genre Detail](screenshots/genre-detail.png)

## Playlists

![Playlists](screenshots/playlists.png)

## Subscriptions

![Subscriptions](screenshots/subscriptions.png)

## Library Health

![Library Health](screenshots/library-health.png)

## Library Reconciliation

![Library Reconciliation](screenshots/library-reconciliation.png)

Shipped in `v0.17.0`: unreconciled-artist review plus manual correct/ignore override flow. Extended in `v0.19.0` with unreconciled-album review and album override persistence. The current `develop`/`:nightly` view labels each artist and album as no match found, ambiguous match, or lookup failed; eligible rows can be selected, then ignored together through a confirmation dialog. Artist selection covers visible rows, album selection stays on the current page, and failed lookups remain available for retry instead of bulk ignore.

## Library Sources Panel

![Library Sources Panel](screenshots/library-sources.png)

Admin panel on the Library Health page. Shipped in `v0.17.0` and expanded in `v0.18.0` with per-source album sync counts and snapshot status. Polished in `v0.19.0` with album sync coverage summaries.

## Analytics

![Analytics](screenshots/analytics.png)

The Discovery over time chart shows per-batch recommendation totals, with the approved portion in green.

## Settings

![Settings](screenshots/settings.png)

The tab row keeps native horizontal scrolling and shows conditional chevrons plus edge fades when more tabs are hidden in either direction. Selecting or deep-linking a tab scrolls it into view.

The current Settings > Targets flow also includes `slskd` target creation with an optional linked Lidarr target for combined approvals.

## Settings > Blocked

The screenshot capture script can produce `settings-blocked.png` for Settings > Blocked. That surface now includes separate permanent artist and album blocklists; no `settings-blocked.png` artifact is currently checked in.
