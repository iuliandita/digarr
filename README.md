# Digarr

[![CI](https://github.com/iuliandita/digarr/actions/workflows/ci.yml/badge.svg)](https://github.com/iuliandita/digarr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](deploy/docker/)
[![Tests](https://img.shields.io/badge/tests-1110_passing-brightgreen)]()
[![Release](https://img.shields.io/github/v/tag/iuliandita/digarr?label=release)](https://github.com/iuliandita/digarr/releases)

**AI-powered music discovery for your *arr stack.** Digarr analyzes your listening history from ListenBrainz, Last.fm, Spotify, Plex, Jellyfin, or Discogs, finds similar artists using MusicBrainz and AI, scores and ranks them, and lets you approve recommendations -- optionally adding them straight to Lidarr, pushing them to a Spotify playlist, or generating weekly discovery playlists for your media server.

Think of it as Jellyseerr/Overseerr, but for music discovery.

> **Beta software -- working toward v1.0 with the help of testers and community.** Digarr is usable and actively developed, but expect rough edges. We'd love your help: set it up, break things, [report issues](https://github.com/iuliandita/digarr/issues), and share your feature ideas. Every bug report and suggestion makes the project better for everyone.
>
> Free and open source, forever. No tracking, no telemetry, no data collection -- your music taste stays on your server.

![Dashboard](docs/screenshots/dashboard-dark.png)

[More screenshots](docs/SCREENSHOTS.md)

---

## Highlights

### 7-Stage AI Pipeline
Not just "here are similar artists." Digarr collects your taste from up to 6 sources, asks an AI to reason about what you'd like and why, scores candidates with a configurable weighted formula, deduplicates across batches, and learns from your approve/reject feedback over time.

### Mood Discovery
Type "something like Boards of Canada but darker" or "upbeat 90s pop for a road trip" and get instant AI-powered results. No menus, no filters -- just plain English.

### Auto-Playlists ("Digarr Digest")
Generate curated playlists from your approved recommendations, download them as M3U/XSPF, or push them to Navidrome, Jellyfin, or Plex automatically. Four strategies: Weekly Digest, Genre Focus, Mood Mix, and Rediscover (forgotten gems from weeks ago).

### Genre Deep Dive
Browse your library by genre, then explore three discovery tabs: **Recommended** (approved artists in that genre), **Trending** (recent discoveries), and **Deep Cuts** (hidden gems with low popularity). Preview tracks and queue artists directly from genre pages.

### Your AI, Your Choice
Anthropic (Claude), OpenAI, Google Gemini, Ollama (local, free), or any OpenAI-compatible endpoint. Every recommendation includes a written explanation of why the artist matches your taste.

### 15 Color Themes
Editor classics (Tokyo Night, Catppuccin, Dracula, One Dark, Nord, Gruvbox, Solarized, Rose Pine) alongside streaming-service-inspired *arr themes (Spotarr, Youtarr, Deezarr, Applarr, Tidarr, Amazarr, Qobuzarr). All with dark and light variants.

---

## Features

### Discovery & Recommendations
- **6 data sources** -- ListenBrainz, Last.fm, Spotify (OAuth), Plex, Jellyfin, and Discogs. Each feeds into the taste profile with listening history, play counts, or collection data
- **Smart scoring** -- weighted composite across consensus, similarity, genre overlap, AI confidence, feedback learning, and popularity; configurable weights, thresholds, and cooldowns
- **Auto-approve** -- automatically add high-scoring recommendations to your targets after each scan
- **Artist logos** -- fanart.tv clearlogo support via Lidarr, displayed on the dashboard hero and expanded recommendation cards
- **Subscriptions** -- pluggable adapter system for scheduled discovery from Spotify playlists/charts, Last.fm tags/charts, ListenBrainz feeds, genre searches, and similar-artist seeds
- **Cross-platform search** -- search for artists across Spotify, Deezer, MusicBrainz, TIDAL, and Bandcamp simultaneously with merged, deduplicated results

### Playlists & Targets
- **Auto-playlists** -- 4 strategies (Weekly Digest, Genre Focus, Mood Mix, Rediscover) generated on their own schedule, exportable as JSON/CSV/M3U/XSPF, and pushable to Navidrome, Jellyfin, or Plex
- **Target registry** -- pluggable approval targets: Lidarr (download + monitor with per-user quality/metadata/root folder preferences), Spotify Playlist (OAuth push), Navidrome/Jellyfin/Plex (playlist API)
- **Export** -- JSON, CSV, M3U, XSPF (with artist images, AI reasoning, streaming links, and MusicBrainz metadata)
- **Lidarr-optional** -- works without Lidarr in pure discovery mode

### Library & Analytics
- **Library health dashboard** -- 6 automated checks (missing metadata, unmonitored artists, missing albums, duplicates, genre gaps, image gaps) with one-click batch fixes
- **Analytics** -- approval rates, genre trends, source effectiveness, batch history, discovery-over-time chart, score distribution histogram, approval rate trend, and time-to-act metrics
- **Feedback insights** -- see how your approval patterns shape future recommendations

### UX & Auth
- **OIDC/SSO** -- Authentik, Authelia, Keycloak, Google, or any OIDC provider. Reverse proxy header auth also supported
- **Multi-user** -- per-user recommendation queues, listening sources, scoring weights, Lidarr profiles, and target configurations
- **Music previews** -- Spotify embeds, Deezer 30-sec clips, or YouTube previews on recommendation cards and genre pages
- **Swipe-to-approve** -- swipe right to approve, left to reject on mobile; desktop gets hover buttons and card-stack mode
- **Contextual hints** -- dismissable tips throughout the app guide new users without getting in the way
- **Webhook notifications** -- Discord, Slack, ntfy, Gotify, or any HTTP endpoint
- **Self-hosted** -- single container, runs alongside your existing *arr stack

---

## Friends of the Project

Digarr wouldn't exist without the self-hosted music discovery community. These projects inspired us, and we recommend checking them out -- each takes a different approach to the same problem, and they're all worth your time:

### Discovery & Recommendations
- [**Curatorr**](https://github.com/MickyGX/curatorr) -- behavior-first music curation for Plex. Tracks skips and play completion via webhooks, scores artists on engagement rather than genre tags, and progressively unlocks Lidarr albums as your listening signals strengthen. A different philosophy: it learns from *how* you listen, not what an AI thinks you'd like.
- [**Aurral**](https://github.com/lklynet/aurral) -- artist discovery and request manager for Lidarr with Last.fm tag similarity and Weekly Flow playlists via Soulseek/Navidrome. Clean UI, fast-growing community.
- [**MixArr**](https://github.com/aquantumofdonuts/mixarr) -- the widest net in the space with 56 subscription types across 12 services. If you want to pull from Spotify, TIDAL, Bandcamp, Discogs, and more all at once, MixArr is your tool.
- [**Sonobarr**](https://github.com/Dodelidoo-Labs/sonobarr) -- Last.fm discovery in batch queues with an optional AI assistant. Real-time Socket.IO UI. Growing fast.
- [**Brainarr**](https://github.com/RicherTunes/Brainarr) -- the only tool that runs as a native Lidarr plugin. Privacy-first with local AI via Ollama/LM Studio.
- [**Lidify**](https://github.com/TheWicklowWolf/Lidify) -- the OG in this space. Simple, focused: Lidarr library -> Last.fm similar artists -> one-click add. Does one thing well.
- [**DiscoveryLastFM**](https://github.com/MrRobotoGit/DiscoveryLastFM) -- fully automated Last.fm -> Lidarr pipeline with zero UI. Set it and forget it.

### Streaming & Players
- [**Kima Hub**](https://github.com/Chevron7Locked/kima-hub) -- a self-hosted Spotify replacement with an audio ML "Vibe System" (mood mapping, 2D/3D music visualization, drift playlists). Genuinely novel.
- [**Explo**](https://github.com/LumePart/Explo) -- "Discover Weekly for self-hosted." Pulls ListenBrainz recommendations, downloads tracks, and creates playlists on your media server. Written in Go, lightweight.
- [**LMS**](https://github.com/epoupon/lms) -- mature C++ music server with built-in tag-based recommendations. Runs on a Raspberry Pi.

### Acquisition & Management
- [**SoulSync**](https://github.com/Nezreka/SoulSync) -- full music collection manager: Soulseek/Tidal/YouTube/Qobuz downloads with AcoustID fingerprinting and auto playlists.
- [**Yoink**](https://github.com/FlyinPancake/yoink) -- self-hosted music library manager with cross-provider album matching (same album across Tidal, Deezer, MusicBrainz). Written in Rust.
- [**Resonance**](https://github.com/jordojordo/deepcrate) -- preview-first discovery with Soulseek downloads. You listen before it downloads.
- [**re-command**](https://github.com/Snapyou2/re-command) -- ListenBrainz weekly recs downloaded, tagged, and organized for Navidrome. Single-purpose and reliable.

### Data & Infrastructure
- [**MusicMoveArr Datasets**](https://github.com/MusicMoveArr/Datasets) -- MusicBrainz/Spotify/Deezer/Tidal datasets used by Digarr for genre enrichment and popularity scoring.
- [**troi-recommendation-playground**](https://github.com/metabrainz/troi-recommendation-playground) -- the official MetaBrainz recommendation engine behind ListenBrainz's algorithms.

---

## Quick Start

### Docker Compose (recommended)

```sh
git clone https://github.com/iuliandita/digarr.git
cd digarr/deploy/docker
cp .env.example .env
docker compose up -d
```

Open `http://localhost:3000` and complete the setup wizard. Alternatively, fill in the service env vars in `.env` and setup completes automatically on first boot. Database migrations run automatically on every startup.

For local development, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## How It Works

Digarr runs a recommendation pipeline with 7 stages:

1. **Collect** -- fetches your current Lidarr library (or runs without it in discovery mode)
2. **Analyze** -- builds a taste profile from all connected sources (ListenBrainz, Last.fm, Spotify, Plex, Jellyfin, Discogs)
3. **Discover** -- queries sources for similar artists (Last.fm similar, Discogs genre search, AI recommendations, library-seeded discovery)
4. **Resolve** -- validates each candidate against MusicBrainz, fetches metadata, streaming URLs, artist images, and logos; genre-aware disambiguation picks the correct artist when multiple share the same name; enriches sparse genres from Spotify data if available
5. **Score** -- applies a weighted composite formula (consensus, similarity, genre overlap, AI confidence, feedback boost, popularity)
6. **Filter** -- removes artists already in your library, previously rejected artists (with cooldown), and below-threshold scores
7. **Store** -- persists the batch and recommendations to the database

The pipeline runs on a configurable cron schedule or manually via the "Run Scan" button. Subscriptions can also trigger targeted discovery for specific genres or similar-artist seeds.

---

## Requirements

| Service | Required | Purpose |
|---------|----------|---------|
| **Lidarr** | Optional | Music library management + auto-download. Works without it in discovery-only mode |
| **Listening source** | At least one | ListenBrainz, Last.fm, Spotify, Plex, Jellyfin, or Discogs |
| **AI Provider** | Yes | Artist recommendations (Anthropic, OpenAI, Ollama, or any compatible endpoint) |
| **PostgreSQL** | Yes | Data storage (included in Docker Compose) |

---

## Configuration

All configuration is done through the web UI after initial setup -- connections, scoring weights, cron schedule, and preferences are all set there. See [`.env.example`](.env.example) for the full list of environment variable fallbacks (useful for zero-touch Docker deployments).

---

## Deployment

| Method | Path | Notes |
|--------|------|-------|
| Docker Compose | [`deploy/docker/`](deploy/docker/) | Recommended. Includes PostgreSQL. |
| Helm chart | [`deploy/helm/digarr/`](deploy/helm/digarr/) | Kubernetes. Bundled PostgreSQL or bring your own. |
| Raw k8s manifests | [`deploy/k8s/`](deploy/k8s/) | Reference manifests for advanced setups. |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT -- see [LICENSE](LICENSE).
