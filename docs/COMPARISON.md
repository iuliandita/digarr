# Choosing a Self-Hosted Music Discovery Tool

There are many good projects in this space, and most of them are not actually
competing -- they solve different problems and several of them coexist happily
in one homelab. This page maps the field so you can pick the right tool (or
combination) for your setup. Verified against upstream repositories on
2026-07-12; these projects move
fast, so check their repos for current state. Corrections welcome via
[issues](https://github.com/iuliandita/digarr/issues).

## Three philosophies

Almost every tool in this space follows one of three models:

1. **Discovery and curation** -- build a taste profile, generate candidates,
   score them, and put a human review step before anything touches your
   library. You approve; the tool acts. *Digarr lives here.*
2. **Acquisition automation** -- watch artists or feeds, find the files, and
   download them with no review step. Discovery is an input; the product is a
   growing, well-organized library. *SoulSync, Explo, and Aurral live here.*
3. **Request fulfillment and library platforms** -- users browse and request,
   while the app owns approval, downloading, library organization, and often
   playback. *DroppedNeedle spans this model and acquisition automation.*

None of these is "better" -- they answer different questions. "What should I
listen to next, and do I trust it enough to add?" is a different problem from
"keep my collection complete without me touching it" and from "let my
household request music like they request movies."

## Capability matrix

| | Digarr | SoulSync | Explo | Aurral | Kima Hub | DroppedNeedle | MixArr | Lidify |
|---|---|---|---|---|---|---|---|---|
| Album-level recommendations (gap-fill, new releases, net-new) | Yes | Partial [^1] | -- | -- | -- | Yes | -- | -- |
| LLM-assisted recommendations (bring your own provider) | Yes | -- | -- | -- | -- | -- | Yes | -- |
| Configurable scoring weights | Yes | -- | -- | -- | -- | -- | -- | -- |
| Review-then-approve workflow | Yes | -- | -- | -- | -- | Yes | -- | -- |
| Natural-language mood search | Yes | -- | -- | -- | -- | -- | -- | -- |
| Works without Lidarr | Yes | Yes | Yes | -- | Yes | Yes | -- | -- |
| Multi-user with per-user credentials | Yes | -- | -- | -- | Yes | Partial [^2] | -- | -- |
| OIDC / SSO | Yes | -- | -- | -- | Yes | Yes | Yes | -- |
| Localized UI (multiple languages) | Yes (15) | -- | -- | -- | -- | -- | -- | -- |
| Scheduled discovery subscriptions | Yes | Yes | Yes | Yes | -- | Partial | Yes | -- |
| Playlist generation / export | Yes | Yes | Yes | Yes | Yes | Yes | -- | -- |
| Automated downloading (built-in) | Partial [^3] | Yes | Yes | Yes | Yes | Yes | -- | -- |
| Media-server library sync (Plex/Jellyfin/Emby/Subsonic) | Yes | Yes | Partial | Partial | Yes | Yes | -- | -- |
| Backup/restore, job history, upgrade pre-flight checks | Yes | -- | -- | -- | -- | -- | -- | -- |
| Built-in music player / streaming | -- | -- | -- | -- | Yes | Yes | -- | -- |

[^1]: New-release detection for watchlisted artists; not a recommendation
    queue of individual albums with per-album approval.
[^2]: DroppedNeedle has role-based multi-user auth plus per-user listening and
    scrobbling connections; most operator service settings remain global.
[^3]: Digarr delegates downloads to `slskd` and/or Lidarr as an *outcome of an
    approval*, rather than shipping its own downloader.

"--" means the capability is absent or out of scope for that project's design,
not that the project is deficient -- see the philosophy section above.

## The projects, briefly

- **[SoulSync](https://github.com/Nezreka/SoulSync)** -- the most popular
  acquisition-automation tool. Watchlist monitoring, auto playlists,
  multi-source downloading with fingerprint verification, heavy metadata
  enrichment and tagging. Pick it if you want a hands-off pipeline from
  streaming taste to organized files and you do not want a review step.
- **[Explo](https://github.com/LumePart/Explo)** -- "Discover Weekly for
  self-hosted." ListenBrainz recommendations downloaded straight to your media
  server. Small, focused, Go binary. Pick it for zero-ceremony weekly fresh
  music.
- **[Aurral](https://github.com/lklynet/aurral)** -- Last.fm tag similarity
  plus Weekly Flow playlists with built-in Soulseek downloading and Navidrome
  sync. Pick it if you live in Navidrome and want flow-style playlists.
- **[Kima Hub](https://github.com/Chevron7Locked/kima-hub)** -- a full music
  platform: streaming player, audio-embedding similarity, 3D library
  visualization, podcasts. Closer to a Plexamp alternative than a discovery
  companion. Pick it if you want one app that plays *and* explores.
- **[DroppedNeedle](https://github.com/DroppedNeedle/DroppedNeedle)** -- the
  project formerly known as MusicSeerr now replaces Lidarr with its own music
  library, request, download, and playback stack. It drives operator-supplied
  slskd or Usenet/SABnzbd, supports album and track requests, multi-user roles,
  OIDC, media-server playback, and personalized discovery. Pick it if you want
  a full music platform rather than a companion in front of an existing
  library manager.
- **[MixArr](https://github.com/aquantumofdonuts/mixarr)** -- the widest
  subscription net in the space (dozens of feed types across many services)
  with local-LLM recommendation support. Pick it for feed breadth.
- **[Lidify](https://github.com/TheWicklowWolf/Lidify)** -- the original.
  Lidarr library plus Last.fm similar artists, intentionally minimal and
  feature-complete. Pick it if you want exactly that and nothing else.
- **[Curatorr](https://github.com/MickyGX/curatorr)** -- behavior-first:
  scores artists on skip/completion telemetry from Plex/Jellyfin/Emby and
  builds smart playlists. Pick it if you trust your playback behavior more
  than your stated taste.
- **[Brainarr](https://github.com/RicherTunes/Brainarr)** -- a native Lidarr
  plugin (no separate app) doing privacy-first AI recommendations inside
  Lidarr's own UI. Pick it if you want zero extra containers.
- **[Sonobarr](https://github.com/Dodelidoo-Labs/sonobarr)** -- Last.fm
  discovery with a real-time UI and per-user auto-approve. Development is
  currently paused.

## Where Digarr fits

Digarr is the discovery-and-curation option: it assumes you *want* to be in
the loop. Its distinguishing choices:

- **Albums are first-class.** Digarr recommends individual albums -- studio
  albums you are missing from artists you track, new releases, and net-new
  finds -- and approving one adds *only* that album, not a whole discography.
- **Scoring you can see and tune.** Recommendations carry a weighted composite
  score (consensus, similarity, genre overlap, AI confidence, feedback
  learning, popularity) with user-adjustable weights that learn from your
  approve/reject history.
- **Your AI, your choice.** Hosted providers or fully local inference through
  Ollama and OpenAI-compatible endpoints, with the reasoning shown per
  recommendation -- and mood search in plain language.
- **No Lidarr required.** Discovery-only mode currently builds its genre
  reference from Spotify artist metadata instead of a library; broader
  non-Spotify genre backfill is the next planned scoring improvement.
- **Built for more than one person.** Multi-user with per-user queues,
  credentials, scoring weights, and targets; OIDC/SSO; a UI and AI output
  localized in 15 languages.
- **Run like infrastructure.** Backup/restore, pre-flight upgrade checks with
  auto-backup, job history with stuck-task detection, signed images, and a
  nightly / latest / stable release channel model.

It deliberately does **not** ship its own downloader or player. Acquisition
goes through Lidarr or `slskd` after approval; playback stays in your media
server. If you want the opposite trade-offs, the projects above are good at
exactly that -- and several of them pair well with Digarr in the same stack
(for example: Digarr for curated additions, SoulSync or Explo for hands-off
freshness, your media server for playback).
