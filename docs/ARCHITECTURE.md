# Digarr Architecture

## Overview

Single Bun process serving a Hono API backend + React SPA frontend. Postgres
via Drizzle ORM. Frontend is a Vite SPA served by Hono in production, proxied
via Vite dev server in development.

## Pipeline

Seven stages:

1. **Collect** - gather seed artists from the user's library and listening history
2. **Analyze** - extract profile features (preferred genres, eras, popularity)
3. **Discover** - ask providers (AI + similarity sources) for candidates
4. **Resolve** - canonicalize candidates to MusicBrainz IDs
5. **Score** - weighted feature scoring, clamped to [0, 1]
6. **Filter** - dedupe across batches, apply rejection cooldown, threshold
7. **Store** - persist recommendations with status = 'discovered'

Pure functions live in `src/core/pipeline/`. The orchestrator
(`src/core/pipeline/orchestrator.ts`) composes the stages and emits SSE progress.
Genre enrichment from `artist_metadata` runs between resolve and score.

## Registry patterns

Four extension points, each registry-based:

- `DestinationTarget` - where recommendations are pushed (Lidarr, Emby, `slskd`, ...)
- `SubscriptionAdapter` - how recurring seeds are sourced (CSV, Spotify saved, ...)
- `SearchSource` - multi-source artist / track search (Lidarr, MusicBrainz, Deezer, ...)
- `RecommendationProvider` - AI backends (Anthropic, OpenAI, Gemini, Ollama, ...)

Adding a new implementation means:

1. Implement the interface in `src/core/<kind>/adapters/<name>.ts`
2. Register in `src/core/<kind>/registry.ts`
3. Add a settings schema and UI when the adapter is user-configurable

## Boot order

Async IIFE in `src/index.ts`:

1. `createJobRecorder(db)` - module-level, before the IIFE
2. `markStuck()` - flips any in-progress jobs left over from a crashed prior run
3. `preFlightCheck()` - auto-backup if pending migrations are detected
4. `migrate()` - drizzle-kit migrations
5. `autoSetup()` - first-admin bootstrap when the env vars are present
6. Bootstrap user setup
7. Lidarr target backfill
8. Pipeline scheduler
9. Subscription scheduler
10. Playlist scheduler
11. `startStuckDetector()` - cron every 5 min, as the last boot step

## Key invariants

- Config precedence: DB settings (single row, `id=1`) override env vars. Per-user credentials live on the `users` table; global settings are the fallback.
- All external HTTP goes through `createHttpClient()` in `src/core/clients/http.ts` (retry, backoff, optional TLS-skip).
- Field-level encryption uses AES-256-GCM with HKDF-derived keys (`src/core/crypto.ts`). Encrypted DB values are prefixed `enc:v1:`. Legacy SHA-256 decryption is retained as a read-path fallback for pre-migration values.
- Tests run in Node.js (vitest), not Bun. `Bun.serve()`, `Bun.file()` and similar Bun-only APIs are unavailable in tests; password hashing uses `node:crypto` `scrypt`.
- Migrations are idempotent. Drizzle generates bare DDL, so every generated migration must add `IF NOT EXISTS` / `IF EXISTS` clauses by hand.
- Backup restore runs in a single DB transaction. Upsert conflict targets are natural keys (`mbid`, `slug`, `nameNormalized`, `token`), not serial IDs.
- Scoring uses the shared `computeWeightedScore()` in `src/core/pipeline/score.ts`. All callers (main pipeline + hygiene rescorer) clamp results to `[0, 1]` regardless of user weight sums.

See `AGENTS.md` for the gotchas, external-API quirks, and CI notes that
accumulate faster than this doc should; `AGENTS.md` stays the living ops file.
