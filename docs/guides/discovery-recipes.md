# Discovery recipes

Four short recipes that take a new install from setup to something you can play, using only what the current release ships. Each one lists what it needs. A service you have not connected is never assumed to work.

Names in `code font` are exact setting keys or API fields; names in plain text are labels in the UI.

## Before you start

- Run a mode: open Discover > Discovery Modes (`/discovery-modes`), choose Run a mode, pick a mode, fill its Easy or Advanced fields, then Run now. A mode that needs a connection shows the reason in the picker (for example "Connect ListenBrainz to use this mode.").
- A scan (Run Scan on the Dashboard, Run a scan on Discover) asks your connected sources and AI provider for similar artists. A mode run uses only that mode's candidates.
- Recommendations you already have, reject, or block are not suggested again until the rejection cooldown ends (`rejectionCooldownDays`, default 90).
- Previews need no account: Digarr looks the artist up in Deezer's public catalog and plays a clip when it finds exactly one artist with that name. With zero or several matches you get track titles from MusicBrainz and no audio.

## 1. Discovery only, to the first playable recommendation

In the setup wizard, choose Discovery only ("Just discover"). The AI step has Skip for now. Nothing else is required; listening sources are connected per user in Settings after setup.

What each route needs:

| Route | Needs | Without it |
|-------|-------|------------|
| Artist Relationships mode | Nothing. It reads MusicBrainz. | Always available. |
| CSV, M3U or XSPF import (Run a mode > Presets and imports) | A file with artist names. | Always available. |
| Describe a mood (Discover) | An AI provider | The request fails with "AI provider not configured". |
| Search (MusicBrainz) then Add to discovery queue, or adding a mood result | The searched artist is stored with no account. Similar artists also need a Last.fm API key or an AI provider. | Only the artist you picked is stored. |
| Scan | At least one connected listening source, library source, or AI provider | The run stops with "At least one listening source or AI provider must be configured". |
| ListenBrainz modes (Weekly Jams, Artist Radio, Tag Radio, and others) | ListenBrainz username and token | The mode shows "Connect ListenBrainz to use this mode." |
| Charts | Last.fm API key | "Connect Last.fm to use this mode." |

Fastest path with no accounts:

1. Discover > Discovery Modes > Run a mode > Artist Relationships.
2. In Seed artists, enter a few artists you like, comma separated.
3. Run now. In Advanced you can limit the relationship types (member of band, collaboration, supporting musician, is person, sibling, married, involved with) and set the Limit (default 25, max 50).
4. Open Discover, find a result, and use the preview play control on the card (Top Tracks).

Another no-account start: open Search, look up an artist (MusicBrainz is always available), and choose Add to discovery queue.

Artist Relationships returns people and bands connected to your seeds in MusicBrainz, such as collaborators and side projects. It is not a sound-alike list. For sound-alikes you need a similarity source: ListenBrainz, Last.fm, Plex (when the library metadata has it), AudioMuse-AI (experimental), or an AI provider.

To add a source later, use Settings > Connections > Add connection. For unattended setups the server-wide AI provider can be set with `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` and `AI_BASE_URL`; see [Operations](../OPERATIONS.md#unattended-setup).

## 2. Existing library to the first useful listen

Pick the wizard mode that matches your library, or connect it afterwards.

| Library | How to connect | Library sync | Taste signal | Similar artists |
|---------|---------------|--------------|--------------|-----------------|
| Lidarr | Wizard mode Lidarr, or Settings > Connections | Yes | Library artists as seeds | No |
| Emby | Wizard mode Emby (URL, API key, user ID), or Settings > Connections | Yes | Yes | No |
| Plex | Settings > Connections > Add connection > Plex; select the music library and your Plex listener | Yes | Listening history, once a listener is selected | Yes, when Plex has metadata |
| Jellyfin | Settings > Connections > Add connection | Yes | Yes | No |
| Subsonic | Settings > Connections > Add connection | Yes | Yes | No |

Library services give Digarr seeds and tell it what you already own. Only some can answer "who sounds like this", so pair a media server or Lidarr with at least one of these: ListenBrainz, Last.fm, Plex metadata, or an AI provider. Without one, a scan has seeds and nothing to expand them with. Subsonic Starred and Spotify Followed Artists are separate discovery modes that read your own collection.

Steps:

1. Connect the library, then check Library Health > library sources and use Sync now. The first sync can take a while because artists are matched to MusicBrainz in the background.
2. Connect one similarity source (see above) or an AI provider.
3. Run Scan from the Dashboard. A scan can finish with a failed source; admins can check Job History.
4. In Discover, preview an artist, then approve (Lidarr or another target) or reject. Pending items stay pending until you act.

Two follow-ups use the library directly:

- Library Gap-Fill (a mode; needs a synced library) suggests missing albums by artists you own.
- Release Radar needs ListenBrainz, Spotify or Last.fm for artist seeds, and skips albums already in your synced library.
- With a Lidarr target, album suggestions skip release types your Lidarr metadata profile filters out, such as compilations under a studio-only profile. To get them, allow the type in Lidarr.

Library seed ratio (Settings > Recommendations > Advanced > Library discovery, `librarySeedRatio`, default 0.3) sets how many of the Top artists limit (`topArtistsLimit`, default 30) come from your library rather than your listening history.

## 3. Seasonal and decade recipes

There is no seasonal preset. The presets under New > From a preset (Casual, Deep Diver, Discovery Only, Custom) cover generic weekly or daily feeds: Casual and Deep Diver create schedules from the services you have connected, and Discovery Only sets `subscriptionMode` to `ai-only`. Seasons and decades come from tag schedules plus the decade filter.

### Seasonal tag schedule

A schedule is a mode or a genre feed run on a cron. Two ways to build a tag schedule:

- Tag Radio (needs ListenBrainz). Run a mode > Tag Radio, add tags with weights (for example `summer` weight 2, `surf rock` weight 1), then Schedule instead of Run now. Advanced adds Recordings to fetch (default 25; larger values are slower because of MusicBrainz rate limiting), and Popularity min and max (0 to 100) to keep results away from the most or least played. Each Tag Radio recommendation also remembers the radio track that earned the artist a place. Discover shows it as "Recommended track", and Audition plays that recording instead of a different song by the artist. If no exact match is found, the track is reported as unresolved.
- Genre schedule (needs Last.fm or Discogs). New > Source Type Genre, enter a tag such as `christmas` or `synthwave`, and pick the providers that can look up genres.

Scheduling:

- Choose a schedule preset (Daily (midnight), Every Monday, Every Sunday, Twice a week, Every 2 weeks, Monthly (1st)) or Custom for a cron expression. Times are server time.
- More options holds the name, the artist cap (`maxArtistsPerRun`, default 20) and the scoring preset (Default or Genre-optimized).
- Seasonal means you turn it on and off yourself. Pause and resume with the row switch, or pause all. Nothing switches itself by date.

Example: a Tag Radio schedule on `christmas` and `winter`, Monthly (1st), paused in January, resumed in November.

### Decade filter

Discover > Filters > Decades has toggles for 60s, 70s, 80s, 90s, 00s, 10s and 20s+. You can select several; they combine with OR. The URL parameter is `decades` (for example `?decades=70s,80s` on the recommendations API).

The filter matches the year the artist started (the MusicBrainz life-span begin year), not the release year. An artist with no known begin year never matches a selected decade. A 90s band that released an album last year still shows under 90s.

To build a decade queue:

1. Seed with a mode that returns many artists: Tag Radio on a genre, or a Genre schedule.
2. Wait for the run, then open Discover > Filters and toggle the decades you want.
3. Preview and approve from the filtered list.

Tag Radio has no decade setting, so a decade tag such as `80s` only works if listeners actually use that tag.

## 4. Familiar or adventurous

Scores are weighted sums of six parts, each 0 to 1 (`src/core/pipeline/score.ts`). Album recommendations then get a small nudge of up to 0.15 either way from recency and popularity:

- Consensus: how many different sources suggested the artist (4 or more is 1).
- Similarity: average closeness to the seeds that produced it.
- Genre Overlap: share of the artist's genres already in your library genres. Unknown genres count as 0.
- AI Confidence: the AI's own confidence. If no AI suggested the artist it is a flat 0.5.
- Feedback Boost: your approve rate for the artist's genres. Genres you have not rated count as 0.5.
- Popularity: from imported artist metadata (`bun scripts/import-artist-metadata.ts <csv>`). Unknown is 0.5. Higher weight prefers popular artists.

Edit them in Settings > Recommendations > Scoring Weights. The sliders warn when the total is not 1.0, but the code does not require it; scores are clamped to 0 to 1.

| Weight | Default | Familiar | Adventurous |
|--------|---------|----------|-------------|
| Consensus (`consensus`) | 0.30 | 0.25 | 0.30 |
| Similarity (`similarity`) | 0.25 | 0.30 | 0.30 |
| Genre Overlap (`genreOverlap`) | 0.20 | 0.30 | 0.00 |
| AI Confidence (`aiConfidence`) | 0.15 | 0.05 | 0.30 |
| Feedback Boost (`feedbackBoost`) | 0.10 | 0.10 | 0.10 |
| Popularity (`popularity`) | 0.00 | 0.00 | 0.00 |

These are starting points, not tuned values. With no AI provider, AI Confidence adds the same amount to every artist, so the Adventurous column then ranks on Consensus, Similarity and Feedback Boost alone. Because Adventurous scores can sit lower overall, check Minimum score to show recommendation (Settings > Recommendations, `scoreThreshold`, default 0.5) if results disappear.

Other controls that move the same direction:

| Control | Familiar | Adventurous |
|---------|----------|-------------|
| Library seed ratio (`librarySeedRatio`) | Higher | Lower |
| Priority genres and Other preferred genres | Fill in; they order matching results first without changing scores | Leave empty for broad discovery |
| ListenBrainz Artist Radio or User Radio, Adventurousness | Safe | Adventurous (default is Medium) |

### Compare on the same seeds

Only some changes can be compared on identical candidates:

1. Radio. Run Artist Radio (needs ListenBrainz) twice with the same Artist seed, once on Safe and once on Adventurous. The second run only adds artists the first did not already return, since existing recommendations are not suggested again. Read that as the extra reach of Adventurous.
2. Weights. Run Now uses your Settings weights, and stored scores do not change when you edit them. To re-rank what is already pending, write down the current weights, save the new ones, then run Settings > Administration > Data Hygiene > Re-score Recommendations (admin only; pending recommendations by default). Compare, then restore the old weights and re-score again to revert.
3. Schedules do not use the Settings weights. Each schedule has its own scoring preset under More options: Default (same as the table's Default column) or Genre-optimized (Consensus 0.40, Similarity 0.35, Genre Overlap 0.05, AI Confidence 0.10, Feedback Boost 0.10, Popularity 0.00).

## Known limits

- Mood search and AI suggestions can name artists that do not exist or are wrong; check before approving.
- Preview clips depend on Deezer's catalog and a unique name match.
- Tag Radio depends on ListenBrainz tag coverage and is slow for large Recordings to fetch values.
- Weight tables above are examples; change one control at a time and compare.
