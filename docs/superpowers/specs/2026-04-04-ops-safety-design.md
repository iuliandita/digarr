# Ops Safety for Self-Hosters

> Design spec for P0 #2: backup/restore, upgrade safety, and data hygiene tools.

## Overview

Three independent modules under `src/core/ops/`, delivered in one branch with separate commits per module. A new admin-only "Administration" tab in Settings provides the UI surface.

### Goals

- Operators can export and restore system state without direct DB access
- Upgrades with pending migrations auto-backup before running
- Common bad-state scenarios have one-click repair tools
- AI reasoning hallucinations (artist/description mismatch) are detectable and fixable

### Non-goals

- Automated migration rollback (too risky with Postgres DDL)
- Scheduled/periodic backups (operators use cron + the API endpoint)
- Full pg_dump replacement (documented separately for full snapshots)

## Module 1: Backup & Restore

### Backup export

**Endpoint:** `POST /api/admin/backup` (admin-only)

Returns a JSON file download containing system state.

**Included by default (core config):**

| Table | Notes |
|-------|-------|
| `settings` | Single row, encrypted fields as `enc:v1:...` blobs |
| `users` | Password hashes included (already hashed, not encrypted) |
| `oauth_tokens` | Encrypted blobs; may be expired |
| `oidc_tokens` | Encrypted blobs; may be expired |
| `targets` | Config JSONB contains encrypted secrets |
| `subscriptions` | Cron schedules, source configs |
| `subscription_runs` | Historical execution logs |
| `recommendations` | Full history with scores, status, AI reasoning |
| `recommendation_batches` | Batch groupings |
| `playlists` | Definitions |
| `playlist_tracks` | Generated tracks |

**Optional with `?includeCaches=true`:**

| Table | Notes |
|-------|-------|
| `artists` | MusicBrainz data + images + streaming URLs |
| `genres` | Genre hierarchy |
| `artist_metadata` | Spotify/Deezer cache |

**Not included:** `sessions` (ephemeral).

### Backup file format

```json
{
  "version": 1,
  "appVersion": "0.14.0",
  "createdAt": "2026-04-04T12:00:00Z",
  "encryptionKeyHash": "sha256:abc123...",
  "includesCaches": false,
  "data": {
    "settings": { ... },
    "users": [ ... ],
    "targets": [ ... ]
  }
}
```

`encryptionKeyHash` is SHA-256 of the first 8 bytes of the HKDF-derived key. Enough to detect key mismatch, not enough to reconstruct the key.

### Backup restore

**Endpoint:** `POST /api/admin/restore` (admin-only, accepts JSON file upload)

Process:

1. Parse and validate the backup file (version check, schema validation)
2. Compare `encryptionKeyHash` against current key
   - If mismatch: return the list of affected encrypted fields that will need re-entry; require `?force=true` to proceed
3. Restore in FK-dependency order: settings -> users -> artists/genres -> subscriptions/targets/oauth/oidc/playlists -> batches/runs/recommendations/playlist_tracks
4. Use upsert (on conflict update) so partial restores don't crash on existing data
5. Return a restore report: rows restored per table, fields requiring re-entry, warnings

Restore does NOT:

- Drop or truncate tables (additive merge, not destructive replace)
- Restore sessions (users must re-login)
- Run migrations (assumes schema is already current)

## Module 2: Upgrade Safety

### Pre-flight check on boot

New step between `initEncryption()` and `migrate()` in the boot sequence:

1. Read drizzle's migration journal (`drizzle/meta/_journal.json`)
2. Query `__drizzle_migrations` to see which have been applied
3. If pending migrations exist:
   - Log: `"N pending migrations detected (current: XXXX, target: YYYY)"`
   - Trigger auto-backup
   - Proceed with migration
4. If migration fails: log error with the auto-backup path for recovery

### Auto-backup before migration

When pending migrations are detected:

1. Run the same application-level backup export (without caches)
2. Save to `DIGARR_BACKUP_DIR` (default: `./backups/`)
3. Filename: `pre-migrate-{timestamp}-{from}-{to}.json`
4. Retain last 5 auto-backups, prune older
5. If backup dir is not writable, log warning but don't block startup

**Opt-out:** `DIGARR_AUTO_BACKUP=false` disables this. On by default.

### Pending migrations endpoint

**Endpoint:** `GET /api/admin/migrations/pending` (admin-only)

```json
{
  "currentVersion": "0010_cloudy_blade",
  "targetVersion": "0013_redundant_norman_osborn",
  "pendingCount": 3,
  "pendingMigrations": [
    "0011_melodic_proemial_gods",
    "0012_luxuriant_luminals",
    "0013_redundant_norman_osborn"
  ],
  "lastAutoBackup": {
    "path": "./backups/pre-migrate-2026-04-04T120000-0010-0013.json",
    "createdAt": "2026-04-04T12:00:00Z"
  }
}
```

### What this does NOT do

- No automated rollback. Postgres DDL is hard to reverse safely and Drizzle doesn't generate down migrations. The safety net is the auto-backup + clear error messages.
- No version-gap blocking. Migrations are sequential and idempotent. The warning is informational.

## Module 3: Data Hygiene Tools

All endpoints under `POST /api/admin/hygiene/:tool` (admin-only). Each returns a result summary. All synchronous except AI reasoning audit which returns 202.

### Tool 1: Clear image failures

**Endpoint:** `POST /api/admin/hygiene/clear-image-failures`

Resets `imageFailedAt` to `NULL` on all artists (or filtered by `?olderThan=7d`). Next pipeline run or "Refresh Data" retries image fetching.

Returns: `{ cleared: 142 }`

### Tool 2: Rebuild genre cache

**Endpoint:** `POST /api/admin/hygiene/rebuild-genres`

Drops and regenerates the `genres` table from artist tags across `artists.tags`, `artists.genres`, and `artist_metadata.spotifyGenres`. Recalculates `artistCount` per genre.

Returns: `{ genres: 847, elapsed: "2.3s" }`

### Tool 3: Re-score recommendations

**Endpoint:** `POST /api/admin/hygiene/rescore`

Re-runs the scoring function on all `pending` recommendations using the requesting user's current scoring weights. Does not touch approved/rejected by default.

Optional `?status=pending,approved` to expand scope.

Returns: `{ rescored: 312, weightProfile: { consensus: 0.3, similarity: 0.25, ... } }`

### Tool 4: Dedupe repair

**Endpoint:** `POST /api/admin/hygiene/dedupe`

Finds recommendations with the same `(userId, artistId)` across different batches. Keeps the highest-scored one, merges source tags, soft-deletes the rest (status: `duplicate`).

Note: `duplicate` is a new recommendation status value. It must be added to the schema's status enum/check and excluded from normal recommendation list queries (same as `rejected`).

Returns: `{ duplicateGroups: 18, removed: 23 }`

### Tool 5: AI reasoning audit

**Endpoint:** `POST /api/admin/hygiene/ai-audit`

**Phase 1 (detect, synchronous):**

For each recommendation with `aiReasoning`:

- Check if artist name appears in reasoning (case-insensitive)
- Load artist's tags/genres from `artists` table
- Score genre overlap between reasoning text and stored tags
- Flag if: name missing AND genre overlap is zero

**Phase 2 (fix, background, opt-in via `?autoFix=true`):**

For flagged entries, re-run the AI reasoning prompt using the current configured provider/model. Updates `aiReasoning` in place.

Returns 202:

```json
{
  "scanned": 1200,
  "flagged": 14,
  "flaggedIds": [42, 87],
  "autoFixStarted": true
}
```

Flagged IDs queryable via `GET /api/admin/hygiene/ai-audit/results`.

### Tool 6: Purge expired sessions

**Endpoint:** `POST /api/admin/hygiene/purge-sessions`

Deletes sessions where `expiresAt < now()`. Already happens on a timer; this is the on-demand button.

Returns: `{ purged: 89 }`

## Admin UI

New **"Administration"** tab in Settings, visible only to admin users (`user.isAdmin`).

### Backup & Restore section (always visible)

- **Download Backup** button with checkbox for "Include caches (artists, genres, metadata)" (unchecked by default)
- Last backup info: timestamp, manual vs auto
- **Restore from Backup** file picker (`.json`):
  - Preview: table counts, app version, cache inclusion
  - Key mismatch: warning banner listing fields that need re-entry, "Restore anyway" confirmation
  - Post-restore: result summary (rows per table, warnings)
- Both actions use confirmation dialogs

### Data Hygiene section (collapsed by default)

Card per tool:

- Tool name + one-line description
- "Run" button with confirmation dialog
- Inline result display after completion
- AI reasoning audit: progress indicator + "View flagged" link

### Upgrade Info section (collapsed by default)

- Current app version
- Pending migrations count (expandable list)
- Last auto-backup: path, timestamp, download link
- Auto-backup status (reflects `DIGARR_AUTO_BACKUP` env var, read-only display)

### Styling

Uses existing `CollapsibleSection`. Same card/button patterns as rest of Settings. No new design system components.

## File Layout

```
src/core/ops/
  types.ts        -- BackupFile, RestoreResult, HygieneResult, MigrationStatus
  backup.ts       -- createBackup(), restoreBackup(), getEncryptionKeyHash()
  hygiene.ts      -- clearImageFailures(), rebuildGenres(), rescoreRecommendations(),
                     dedupeRepair(), aiReasoningAudit(), purgeSessions()
  upgrade.ts      -- getPendingMigrations(), runPreFlightCheck(), autoBackup()

src/server/routes/
  admin.ts        -- all /api/admin/* routes

src/web/pages/settings/
  administration-tab.tsx
  components/
    backup-section.tsx
    hygiene-section.tsx
    upgrade-section.tsx
```

## Route Table

| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| POST | `/api/admin/backup` | `createBackup()` | `?includeCaches=true` |
| POST | `/api/admin/restore` | `restoreBackup()` | `?force=true` for key mismatch |
| GET | `/api/admin/backup/last` | last auto-backup metadata | |
| GET | `/api/admin/migrations/pending` | `getPendingMigrations()` | |
| POST | `/api/admin/hygiene/clear-image-failures` | | `?olderThan=7d` |
| POST | `/api/admin/hygiene/rebuild-genres` | | |
| POST | `/api/admin/hygiene/rescore` | | `?status=pending` default |
| POST | `/api/admin/hygiene/dedupe` | | |
| POST | `/api/admin/hygiene/ai-audit` | | `?autoFix=true` |
| GET | `/api/admin/hygiene/ai-audit/results` | flagged IDs | |
| POST | `/api/admin/hygiene/purge-sessions` | | |

## Auth

All `/api/admin/*` routes use shared middleware: check `c.get('userId')`, load user, reject with 403 if `!user.isAdmin`. Extracted to a reusable `adminOnly` guard.

## Boot Sequence Change

Before: `initEncryption -> migrate -> sessionStore -> ...`

After: `initEncryption -> preFlightCheck (compare, warn, auto-backup) -> migrate -> sessionStore -> ...`

## Dependency Wiring

- `backup.ts` and `hygiene.ts` accept `db` as parameter (same pattern as `StoreDb`)
- AI audit additionally needs the provider registry (available in route handler context)
- `upgrade.ts` needs filesystem access + `db`

## Commit Structure

One branch, one PR. Logical commit groups:

1. **Backup & restore** -- `src/core/ops/types.ts`, `backup.ts`, route endpoints, tests
2. **Upgrade safety** -- `upgrade.ts`, boot sequence change, tests
3. **Data hygiene** -- `hygiene.ts`, hygiene route endpoints, tests
4. **Admin UI** -- Administration tab, three section components
5. **Docs** -- README.md, API.md updates

## Documentation Updates

- **README.md**: Add "Backup & Restore" section covering manual exports, auto-backup behavior, and restore process. Document `DIGARR_BACKUP_DIR` and `DIGARR_AUTO_BACKUP` env vars.
- **API.md**: Add all `/api/admin/*` endpoints with request/response examples.
- **`.env.example`**: Add `DIGARR_BACKUP_DIR` and `DIGARR_AUTO_BACKUP` entries.

## Testing Strategy

- Unit tests for `backup.ts`: round-trip export/import, encryption key hash generation, key mismatch detection, FK-ordered restore
- Unit tests for `hygiene.ts`: each tool in isolation with seeded test data
- Unit tests for `upgrade.ts`: journal parsing, pending migration detection, backup file pruning
- Integration test: backup -> modify data -> restore -> verify state
- AI audit tests use a mock provider to avoid real API calls
