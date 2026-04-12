<p align="center">
  <img src="docs/logo.png" alt="Digarr" width="120" />
</p>

<h1 align="center">digarr</h1>

[![CI](https://github.com/iuliandita/digarr/actions/workflows/ci.yml/badge.svg)](https://github.com/iuliandita/digarr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](deploy/docker/)
[![Tests](https://img.shields.io/badge/tests-1600%2B_passing-brightgreen)]()
[![Release](https://img.shields.io/github/v/tag/iuliandita/digarr?label=release)](https://github.com/iuliandita/digarr/releases)

**Music discovery for your *arr stack.** Connect your listening sources, pick an AI provider, and Digarr turns that into a taste profile, a recommendation pipeline, and a queue you can actually work through. You can approve artists into Lidarr or playlist targets, run mood searches in plain English, launch targeted discovery modes, import Spotify Liked Songs to get started faster, schedule recurring discovery, generate playlists, browse your library by genre, and switch the UI and AI-assisted discovery output across 15 shipped languages. It is self-hosted, so the data stays with you.

> [!WARNING]
> **Beta software, working toward v1.0.** You can use it today, but expect rough edges. Releases can land quickly, sometimes several in a day, so check the [releases page](https://github.com/iuliandita/digarr/releases) and [CHANGELOG.md](CHANGELOG.md) before updating. If you run into something broken, [open an issue](https://github.com/iuliandita/digarr/issues) or send over a feature idea.
>
> Free and open source, forever. No tracking, no telemetry, no data collection. Your music taste stays on your server.

![Dashboard](docs/screenshots/dashboard-dark.png)

[More screenshots](docs/SCREENSHOTS.md)

---

> [!NOTE]
> **Built with AI.** A human sets the roadmap, designs the architecture, and reviews the output; most code and tests are AI-generated.

---

## What Makes Digarr Different

### 7-Stage AI Pipeline
Digarr takes signals from up to 7 sources, runs them through an AI-assisted pipeline, scores candidates with configurable weights, removes duplicates across batches, and learns from what you approve or reject.

### Mood Discovery
Type "something like Boards of Canada but darker" or "upbeat 90s pop for a road trip" and Digarr turns that into a result set. You do not have to translate the idea into filters first.

### Discovery Modes
Run focused discovery flows for the currently shipped modes: ListenBrainz, Release Radar, and Similar Artist Web. Labels and Artist Relationships stay visible in the UI so you can see what is planned, but they are marked unavailable and rejected server-side until they have real implementations. Available discovery modes can be saved as subscriptions, and those subscriptions now reuse the same provider/fallback path as the manual run you configured.

### Auto-Playlists
Build playlists from approved recommendations and send them to Navidrome, Jellyfin, Emby, Plex, or Spotify, or export them as M3U/XSPF. The built-in playlist types are Weekly Digest, Genre Focus, Mood Mix, and Rediscover.

### Your AI, Your Choice
Use Anthropic, OpenAI, Google Gemini, Ollama, or any OpenAI-compatible endpoint. Recommendation cards include a short explanation of why an artist made the cut.

### Multilingual UI And AI Output
Digarr now ships localized catalogs for 15 languages, a visible language switcher before and after login, persisted per-user locale preferences, and locale-aware AI reasoning for mood discovery, quick discover, and full scans.

### Lidarr Optional
Digarr also works in pure discovery mode. If you connect Lidarr, approved artists are added with your chosen quality and metadata profiles. If you do not, you can still approve to Spotify playlists, Navidrome, Jellyfin, Emby, and Plex.

### Cross-Platform Search
Search across Spotify, Deezer, MusicBrainz, TIDAL, and Bandcamp in one pass. Digarr merges the results, deduplicates them, and lets you launch Quick Discover from any match.

---

## Features

- **7 data sources:** ListenBrainz, Last.fm, Spotify (OAuth), Plex, Jellyfin, Emby, and Discogs
- **Smart scoring:** weighted composite scoring across consensus, similarity, genre overlap, AI confidence, feedback learning, and popularity
- **Auto-approve:** send high-scoring recommendations to your targets automatically
- **Discovery modes:** manual and subscription flows for ListenBrainz, Release Radar, and Similar Artist Web, with unavailable planned modes exposed in metadata but blocked from execution until they ship
- **Subscriptions:** scheduled discovery from discovery modes, Spotify Liked Songs, playlists and charts, Last.fm tags and charts, ListenBrainz feeds, genre searches, and similar-artist seeds
- **Genre deep dive:** browse by genre with Recommended, Trending, and Deep Cuts tabs
- **Library sync and reconciliation:** background artist and album sync, per-source status, album sync coverage, unreconciled artist and album review, album coverage badges on recommendation cards, and 6 automated health checks with one-click fixes
- **Analytics:** approval rates, genre trends, source effectiveness, score distribution, and time-to-act
- **Multilingual UI:** 15 shipped locales, saved user language preference, localized auth/setup/high-traffic pages, and locale-aware AI reasoning
- **Top tracks:** Deezer 30-second previews on recommendation cards with MusicBrainz fallback
- **Decade filtering:** filter recommendations by era, from the 60s through the 20s+
- **Music previews:** Spotify embeds, Deezer clips, and YouTube on recommendation cards
- **OIDC/SSO and multi-user:** per-user queues, sources, scoring weights, and target configs
- **Swipe-to-approve** on mobile, card-stack mode on desktop
- **Webhook notifications:** Discord, Slack, ntfy, Gotify, or any HTTP endpoint
- **15 color themes:** editor classics plus streaming-service-inspired *arr themes, in dark and light variants
- **Export:** JSON, CSV, M3U, and XSPF
- **Self-hosted:** a single container that runs alongside your existing *arr stack

### Integrations

Connect external services to unlock discovery feeds, library sync, playlist export, and one-click imports.

| Service | Discovery | Subscriptions | Library Sync | Playlist Export | Import |
|---------|-----------|--------------|-------------|----------------|--------|
| ListenBrainz | Radio (Artist, Tag, User), Similar Users | Weekly Jams, Fresh Releases, Artist Radio, Tag Radio, Similar Users | - | - | - |
| Spotify | - | Liked Songs, Charts, Playlist | - | Yes | Playlist |
| Deezer | - | Favorites, Followed, Flow | - | - | Favorites, Followed, Playlists |
| Last.fm | - | Charts, Tag Radio | - | - | - |
| Lidarr | - | - | Artists, Albums | - | - |
| Plex | - | - | Artists, Albums | Yes | - |
| Jellyfin | - | - | Artists, Albums | Yes | - |
| Emby | - | - | Artists, Albums | Yes | - |
| AI Provider | Mood Discover | - | - | - | - |

---

## Quick Start

```sh
mkdir digarr && cd digarr
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
cp .env.example .env
# Edit .env and set DB_PASS at minimum
docker compose up -d
```

Open `http://localhost:3000` and complete the setup wizard. Alternatively, fill in the service env vars in `.env` and setup completes automatically on first boot. Database migrations run automatically on every startup.

For zero-touch boot, set `DIGARR_INITIAL_USERNAME`, `DIGARR_INITIAL_PASSWORD`, `AI_PROVIDER`, and `AI_MODEL`. Listening sources stay optional, but connect at least one before running discovery. Lidarr stays optional: omit `LIDARR_URL` / `LIDARR_API_KEY` to run in discovery-only mode.

For local development, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## How It Works

Digarr runs a 7-stage recommendation pipeline:

1. **Collect:** fetches your Lidarr library, or skips it in discovery mode
2. **Analyze:** builds a taste profile from all connected sources
3. **Discover:** queries Last.fm similar artists, Discogs genres, AI recommendations, and library seeds
4. **Resolve:** validates against MusicBrainz, fetches metadata and images, and handles genre-aware disambiguation
5. **Score:** applies the weighted scoring formula
6. **Filter:** removes library duplicates, rejected artists with cooldowns, and low-score results
7. **Store:** saves the batch and its recommendations

You can run the pipeline on a schedule, by hand, through subscriptions for targeted discovery, or through the manual discovery-mode cards on the Discover page.

---

## Requirements

| Service | Required | Purpose |
|---------|----------|---------|
| **Lidarr** | Optional | Music library management + auto-download |
| **Listening source** | Optional | ListenBrainz, Last.fm, Spotify, Plex, Jellyfin, Emby, or Discogs |
| **AI Provider** | Yes | Anthropic, OpenAI, Gemini, Ollama, or any compatible endpoint |
| **PostgreSQL** | Yes | Data storage (included in Docker Compose) |

---

## Configuration

Most day-to-day configuration lives in the web UI after initial setup. That includes connections, scoring weights, schedules, preferences, and the saved interface language. If you connect Spotify, Settings > Connections includes a one-click `Import Liked Songs` action to seed recommendations for a faster first scan. Env-var auto-setup needs initial admin credentials plus an AI provider and model. Listening sources, Lidarr, and Emby can be added later in the UI or supplied during setup. See [`.env.example`](.env.example) for local development fallbacks and [`deploy/docker/.env.example`](deploy/docker/.env.example) for Compose deployments.

---

## Backup & Restore

Digarr provides application-level backup and restore through the admin UI (Settings > Administration) or API.

**Manual backup:** `POST /api/admin/backup` returns a JSON file with all configuration, users, targets, subscriptions, and recommendation history. Add `?includeCaches=true` to include artist and genre caches. The file is larger, but restores do not need to fetch that data from MusicBrainz again.

**Restore:** `POST /api/admin/restore` accepts a backup JSON file. The restore runs in a single transaction, so failures roll back cleanly. It uses natural-key upserts for cross-instance compatibility. If the encryption key differs from the backup, Digarr lists the affected credential fields so you can re-enter them manually.

**Auto-backup before migrations:** When Digarr detects pending database migrations on startup, it saves a backup to `DIGARR_BACKUP_DIR` (default: `./backups/`). It keeps the last 5 auto-backups. Disable this with `DIGARR_AUTO_BACKUP=false`.

**Kubernetes / Helm note:** Auto-backup needs a writable `/app/backups` volume. The bundled Helm chart and raw manifests mount one by default; custom deployments should do the same.

### Data Hygiene

Admin tools available under Settings > Administration > Data Hygiene:

- **Clear Image Failures:** reset failed image cache entries so Digarr can retry them
- **Rebuild Genre Cache:** regenerate cached genres from artist tags
- **Re-score Recommendations:** recalculate scores with the current weights
- **Dedupe Repair:** merge duplicate recommendations
- **AI Reasoning Audit:** detect and fix AI hallucinations
- **Purge Sessions:** clean out expired login sessions

---

## Deployment

| Method | Path | Notes |
|--------|------|-------|
| Docker Compose | [`deploy/docker/`](deploy/docker/) | Recommended. Includes PostgreSQL. Also on [Docker Hub](https://hub.docker.com/r/iuliandita/digarr). |
| Helm chart | [`deploy/helm/digarr/`](deploy/helm/digarr/) | Kubernetes. Bundled PostgreSQL or bring your own. |
| Raw k8s manifests | [`deploy/k8s/`](deploy/k8s/) | Reference manifests for advanced setups. |
| Unraid | [`deploy/unraid/`](deploy/unraid/) | Community Applications template. Requires external PostgreSQL. |
| Synology NAS | [`docs/guides/synology.md`](docs/guides/synology.md) | DSM 7.1+ (Docker/Container Manager). SSH or GUI. |
| Docker Desktop | [`docs/guides/docker-desktop.md`](docs/guides/docker-desktop.md) | macOS and Windows (WSL 2). |

---

## Friends

Other self-hosted music discovery projects:

| Project | Approach |
|---------|----------|
| [Lidify](https://github.com/TheWicklowWolf/Lidify) | The OG. Lidarr library + Last.fm similar artists. Simple, focused. |
| [Aurral](https://github.com/lklynet/aurral) | Last.fm tag similarity + Weekly Flow playlists via Soulseek/Navidrome. |
| [MixArr](https://github.com/aquantumofdonuts/mixarr) | 56 subscription types across 12 services. Widest net in the space. |
| [Curatorr](https://github.com/MickyGX/curatorr) | Behavior-first. Scores artists on skips/play completion, not tags. |
| [Brainarr](https://github.com/RicherTunes/Brainarr) | Native Lidarr plugin. Privacy-first with local AI. |
| [Sonobarr](https://github.com/Dodelidoo-Labs/sonobarr) | Last.fm discovery with optional AI assistant. Real-time UI. |
| [Explo](https://github.com/LumePart/Explo) | Discover Weekly for self-hosted. ListenBrainz recs to your media server. |
| [MusicMoveArr Datasets](https://github.com/MusicMoveArr/Datasets) | MB/Spotify/Deezer/Tidal datasets used by Digarr for genre enrichment. |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT. See [LICENSE](LICENSE).

---

## Star History

<a href="https://www.star-history.com/?repos=iuliandita%2Fdigarr&type=timeline&logscale=&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=iuliandita/digarr&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=iuliandita/digarr&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=iuliandita/digarr&type=timeline&legend=top-left" />
 </picture>
</a>
