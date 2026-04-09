<p align="center">
  <img src="docs/logo.png" alt="Digarr" width="120" />
</p>

<h1 align="center">digarr</h1>

[![CI](https://github.com/iuliandita/digarr/actions/workflows/ci.yml/badge.svg)](https://github.com/iuliandita/digarr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](deploy/docker/)
[![Tests](https://img.shields.io/badge/tests-1300%2B_passing-brightgreen)]()
[![Release](https://img.shields.io/github/v/tag/iuliandita/digarr?label=release)](https://github.com/iuliandita/digarr/releases)

**AI-powered music discovery for your *arr stack.** Connect your listening sources (ListenBrainz, Last.fm, Spotify, Plex, Jellyfin, Emby, Discogs), pick an AI provider, and Digarr builds a taste profile, discovers new artists through a 7-stage pipeline, and scores them with a weighted formula that learns from your feedback. Approve what you like and send artists or playlists to Lidarr, Spotify, Jellyfin, Emby, Plex, or Navidrome. Describe a mood in plain English and get instant results. Import artists from Spotify Liked Songs for a faster cold start. Set up subscriptions that discover new music on a schedule while you sleep. Generate weekly digest playlists automatically. Browse your library by genre with deep-cut discovery. All self-hosted, all yours.

> **Beta software -- working toward v1.0.** Usable and actively developed, but expect rough edges. Things move fast during the beta -- there may be several releases per day with bug fixes, new features, and improvements. Check the [releases page](https://github.com/iuliandita/digarr/releases) and [CHANGELOG.md](CHANGELOG.md) before updating. We'd love your help: set it up, break things, [report issues](https://github.com/iuliandita/digarr/issues), and share your feature ideas.
>
> Free and open source, forever. No tracking, no telemetry, no data collection -- your music taste stays on your server.

![Dashboard](docs/screenshots/dashboard-dark.png)

[More screenshots](docs/SCREENSHOTS.md)

---

> [!NOTE]
> **Built with AI.** A human sets the roadmap, designs the architecture, and reviews the output; most code and tests are AI-generated.

---

## What Makes Digarr Different

### 7-Stage AI Pipeline
Digarr collects your taste from up to 6 sources, asks an AI to reason about it, scores candidates with a configurable weighted formula, deduplicates across batches, and learns from your approve/reject feedback over time.

### Mood Discovery
Type "something like Boards of Canada but darker" or "upbeat 90s pop for a road trip" and get instant AI-powered results. No menus, no filters -- just plain English.

### Auto-Playlists
Generate curated playlists from your approved recommendations and push them to Navidrome, Jellyfin, Emby, Plex, Spotify, or export as M3U/XSPF. Four strategies: Weekly Digest, Genre Focus, Mood Mix, and Rediscover.

### Your AI, Your Choice
Anthropic, OpenAI, Google Gemini, Ollama (local, free), or any OpenAI-compatible endpoint. Every recommendation includes a written explanation of why the artist matches your taste.

### Lidarr Optional
Works without Lidarr in pure discovery mode. When connected, approved artists get added with your preferred quality/metadata profiles. Also supports Spotify playlist, Navidrome, Jellyfin, Emby, and Plex as approval targets.

### Cross-Platform Search
Search for artists across Spotify, Deezer, MusicBrainz, TIDAL, and Bandcamp simultaneously. Results are deduplicated and merged. One-click Quick Discover on any result.

---

## Features

- **7 data sources** -- ListenBrainz, Last.fm, Spotify (OAuth), Plex, Jellyfin, Emby, Discogs
- **Smart scoring** -- weighted composite: consensus, similarity, genre overlap, AI confidence, feedback learning, popularity
- **Auto-approve** -- automatically add high-scoring recs to your targets
- **Subscriptions** -- scheduled discovery from Spotify Liked Songs, playlists/charts, Last.fm tags/charts, ListenBrainz feeds, genre searches, similar-artist seeds
- **Genre deep dive** -- browse by genre with Recommended, Trending, and Deep Cuts tabs
- **Library sync + reconciliation** -- background artist and album sync, per-source status, album sync coverage, unreconciled artist and album review, album coverage badges on recommendation cards, and 6 automated health checks with one-click fixes
- **Analytics** -- approval rates, genre trends, source effectiveness, score distribution, time-to-act
- **Top tracks** -- Deezer 30-sec previews on recommendation cards with MusicBrainz fallback
- **Decade filtering** -- filter recommendations by era (60s through 20s+) with toggle pills
- **Music previews** -- Spotify embeds, Deezer clips, YouTube on recommendation cards
- **OIDC/SSO + multi-user** -- per-user queues, sources, scoring weights, and target configs
- **Swipe-to-approve** on mobile, card-stack mode on desktop
- **Webhook notifications** -- Discord, Slack, ntfy, Gotify, or any HTTP endpoint
- **15 color themes** -- editor classics + streaming-service-inspired *arr themes, dark and light
- **Export** -- JSON, CSV, M3U, XSPF
- **Self-hosted** -- single container, runs alongside your existing *arr stack

---

## Quick Start

```sh
mkdir digarr && cd digarr
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/docker-compose.yml
curl -LO https://raw.githubusercontent.com/iuliandita/digarr/main/deploy/docker/.env.example
cp .env.example .env
# Edit .env -- set DB_PASS at minimum
docker compose up -d
```

Open `http://localhost:3000` and complete the setup wizard. Alternatively, fill in the service env vars in `.env` and setup completes automatically on first boot. Database migrations run automatically on every startup.

For zero-touch boot, set `DIGARR_INITIAL_USERNAME`, `DIGARR_INITIAL_PASSWORD`, `AI_PROVIDER`, `AI_MODEL`, and at least one listening source (`LISTENBRAINZ_USERNAME` or `LASTFM_USERNAME`). Lidarr stays optional: omit `LIDARR_URL` / `LIDARR_API_KEY` to run in discovery-only mode.

For local development, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## How It Works

Digarr runs a 7-stage recommendation pipeline:

1. **Collect** -- fetches your Lidarr library (or skips in discovery mode)
2. **Analyze** -- builds a taste profile from all connected sources
3. **Discover** -- queries Last.fm similar, Discogs genres, AI recommendations, and library seeds
4. **Resolve** -- validates against MusicBrainz, fetches metadata/images, genre-aware disambiguation
5. **Score** -- weighted composite formula with configurable weights
6. **Filter** -- removes library duplicates, rejected artists (with cooldown), low scores
7. **Store** -- persists batch and recommendations

Runs on a cron schedule, manually, or via subscriptions for targeted discovery.

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

All configuration is done through the web UI after initial setup -- connections, scoring weights, cron schedule, and preferences are all set there. If you connect Spotify, Settings > Connections now includes a one-click `Import Liked Songs` action to seed recommendations for a faster first scan. Env-var auto-setup needs initial admin credentials, AI provider/model, and at least one listening source; the UI setup wizard enforces the same minimums. See [`.env.example`](.env.example) for local development fallbacks and [`deploy/docker/.env.example`](deploy/docker/.env.example) for Compose deployments.

---

## Backup & Restore

Digarr provides application-level backup and restore through the admin UI (Settings > Administration) or API.

**Manual backup:** `POST /api/admin/backup` returns a JSON file with all configuration, users, targets, subscriptions, and recommendation history. Add `?includeCaches=true` to include artist/genre caches (larger file, but avoids re-fetching from MusicBrainz).

**Restore:** `POST /api/admin/restore` accepts a backup JSON file. Runs in a single transaction (atomic rollback on failure). Uses upsert with natural keys for cross-instance compatibility. If the encryption key differs from the backup, affected credential fields are listed for manual re-entry.

**Auto-backup before migrations:** When the app detects pending database migrations on startup, it automatically saves a backup to `DIGARR_BACKUP_DIR` (default: `./backups/`). Keeps the last 5 auto-backups. Disable with `DIGARR_AUTO_BACKUP=false`.

**Kubernetes / Helm note:** Auto-backup needs a writable `/app/backups` volume. The bundled Helm chart and raw manifests mount one by default; custom deployments should do the same.

### Data Hygiene

Admin tools available under Settings > Administration > Data Hygiene:

- **Clear Image Failures** -- reset failed image cache for retry
- **Rebuild Genre Cache** -- regenerate from artist tags
- **Re-score Recommendations** -- recalculate with current weights
- **Dedupe Repair** -- merge duplicate recommendations
- **AI Reasoning Audit** -- detect and fix AI hallucinations
- **Purge Sessions** -- clean expired login sessions

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

Other self-hosted music discovery projects worth checking out -- each takes a different approach:

| Project | Approach |
|---------|----------|
| [Lidify](https://github.com/TheWicklowWolf/Lidify) | The OG. Lidarr library + Last.fm similar artists. Simple, focused. |
| [Aurral](https://github.com/lklynet/aurral) | Last.fm tag similarity + Weekly Flow playlists via Soulseek/Navidrome. |
| [MixArr](https://github.com/aquantumofdonuts/mixarr) | 56 subscription types across 12 services. Widest net in the space. |
| [Curatorr](https://github.com/MickyGX/curatorr) | Behavior-first. Scores artists on skips/play completion, not tags. |
| [Brainarr](https://github.com/RicherTunes/Brainarr) | Native Lidarr plugin. Privacy-first with local AI. |
| [Sonobarr](https://github.com/Dodelidoo-Labs/sonobarr) | Last.fm discovery with optional AI assistant. Real-time UI. |
| [Explo](https://github.com/LumePart/Explo) | Discover Weekly for self-hosted. ListenBrainz recs to your media server. |
| [MusicMoveArr Datasets](https://github.com/MusicMoveArr/Datasets) | MB/Spotify/Deezer/Tidal datasets -- used by Digarr for genre enrichment. |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT -- see [LICENSE](LICENSE).

---

## Star History

<a href="https://www.star-history.com/?repos=iuliandita%2Fdigarr&type=timeline&logscale=&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=iuliandita/digarr&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=iuliandita/digarr&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=iuliandita/digarr&type=timeline&legend=top-left" />
 </picture>
</a>
