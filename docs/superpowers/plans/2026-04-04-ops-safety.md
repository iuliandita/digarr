# Ops Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backup/restore, upgrade safety (auto-backup before migrations), and data hygiene tools behind an admin-only UI tab.

**Architecture:** Three modules under `src/core/ops/` (backup, upgrade, hygiene), one admin route file, one admin UI tab with three sections. Follows existing patterns: factory-function routes, `adminGuard` middleware, `CollapsibleSection` UI, TDD with vitest mocks.

**Tech Stack:** Hono routes, Drizzle ORM queries, React + TanStack Query frontend, vitest tests

---

## File Map

**Create:**

| File | Responsibility |
|------|---------------|
| `src/core/ops/types.ts` | Shared types: BackupFile, RestoreResult, HygieneResult, MigrationStatus |
| `src/core/ops/backup.ts` | createBackup(), restoreBackup() |
| `src/core/ops/hygiene.ts` | 6 hygiene tool functions |
| `src/core/ops/upgrade.ts` | getPendingMigrations(), autoBackup(), runPreFlightCheck() |
| `src/server/routes/admin.ts` | All /api/admin/* route handlers |
| `src/web/components/admin/administration-tab.tsx` | Tab container with 3 collapsible sections |
| `src/web/components/admin/backup-section.tsx` | Backup download + restore upload UI |
| `src/web/components/admin/hygiene-section.tsx` | Hygiene tool cards with run buttons |
| `src/web/components/admin/upgrade-section.tsx` | Version, migrations, auto-backup status |
| `tests/core/ops/backup.test.ts` | Backup export/restore tests |
| `tests/core/ops/hygiene.test.ts` | Hygiene tool tests |
| `tests/core/ops/upgrade.test.ts` | Upgrade safety tests |

**Modify:**

| File | Change |
|------|--------|
| `src/core/crypto.ts` | Add `getKeyFingerprint()` export |
| `src/server/index.ts` | Mount admin routes, add adminGuard for `/api/admin/*` |
| `src/index.ts` | Wire `runPreFlightCheck()` into boot sequence before `migrate()` |
| `src/web/lib/api.ts` | Add admin API wrapper functions |
| `src/web/pages/settings.tsx` | Add 'administration' tab type and render AdministrationTab |
| `README.md` | Add backup/restore section, new env vars |
| `docs/api.md` | Add /api/admin/* endpoint documentation |
| `.env.example` | Add DIGARR_BACKUP_DIR, DIGARR_AUTO_BACKUP |

---

## Task 1: Core Types and Crypto Fingerprint

**Files:**
- Create: `src/core/ops/types.ts`
- Modify: `src/core/crypto.ts`
- Test: `tests/core/ops/backup.test.ts` (fingerprint tests)

- [ ] **Step 1: Create types file**

```typescript
// src/core/ops/types.ts
import type { Database } from '@/db'

// ── Backup ──────────────────────────────────────

export interface BackupFile {
  version: number
  appVersion: string
  createdAt: string
  encryptionKeyHash: string | null
  includesCaches: boolean
  data: BackupData
}

export interface BackupData {
  settings: Record<string, unknown>[]
  users: Record<string, unknown>[]
  oauthTokens: Record<string, unknown>[]
  oidcTokens: Record<string, unknown>[]
  targets: Record<string, unknown>[]
  subscriptions: Record<string, unknown>[]
  subscriptionRuns: Record<string, unknown>[]
  recommendationBatches: Record<string, unknown>[]
  recommendations: Record<string, unknown>[]
  playlists: Record<string, unknown>[]
  playlistTracks: Record<string, unknown>[]
  // Optional caches
  artists?: Record<string, unknown>[]
  genres?: Record<string, unknown>[]
  artistMetadata?: Record<string, unknown>[]
}

export interface RestoreResult {
  tablesRestored: Record<string, number>
  warnings: string[]
  encryptionMismatch: boolean
  affectedEncryptedFields: string[]
}

export interface BackupOptions {
  includeCaches?: boolean
}

export interface RestoreOptions {
  force?: boolean
}

// ── Hygiene ─────────────────────────────────────

export interface HygieneResult {
  tool: string
  [key: string]: unknown
}

export interface AiAuditResult {
  scanned: number
  flagged: number
  flaggedIds: number[]
  autoFixStarted: boolean
}

export interface AiAuditStatus {
  flaggedIds: number[]
  fixedIds: number[]
  inProgress: boolean
}

// ── Upgrade ─────────────────────────────────────

export interface MigrationStatus {
  currentVersion: string | null
  targetVersion: string | null
  pendingCount: number
  pendingMigrations: string[]
  lastAutoBackup: {
    path: string
    createdAt: string
  } | null
}

export interface PreFlightResult {
  pendingCount: number
  backupPath: string | null
  backupSkipped: boolean
  backupError: string | null
}

// ── Shared ──────────────────────────────────────

export type OpsDb = Database
```

- [ ] **Step 2: Write failing test for getKeyFingerprint**

```typescript
// tests/core/ops/backup.test.ts
// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('getKeyFingerprint', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns null when encryption is disabled', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption(undefined)
    expect(getKeyFingerprint()).toBeNull()
  })

  it('returns a sha256: prefixed string when encryption is enabled', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption('test-encryption-key-1234')
    const fp = getKeyFingerprint()
    expect(fp).not.toBeNull()
    expect(fp).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('returns same fingerprint for same key', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption('test-key-abc')
    const fp1 = getKeyFingerprint()
    initEncryption('test-key-abc')
    const fp2 = getKeyFingerprint()
    expect(fp1).toBe(fp2)
  })

  it('returns different fingerprint for different key', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption('key-alpha')
    const fp1 = getKeyFingerprint()
    initEncryption('key-beta')
    const fp2 = getKeyFingerprint()
    expect(fp1).not.toBe(fp2)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test -- tests/core/ops/backup.test.ts`
Expected: FAIL -- `getKeyFingerprint` is not exported from `@/core/crypto`

- [ ] **Step 4: Add getKeyFingerprint to crypto.ts**

Read `src/core/crypto.ts` first. Then add after the existing `isEncryptionEnabled()` function:

```typescript
/**
 * Returns a SHA-256 hash of the first 8 bytes of the derived encryption key.
 * Used to detect key mismatches during backup restore without exposing the key.
 */
export function getKeyFingerprint(): string | null {
  if (!derivedKey) return null
  const slice = derivedKey.subarray(0, 8)
  const hash = createHash('sha256').update(slice).digest('hex')
  return `sha256:${hash}`
}
```

Note: `derivedKey` is the module-level `Buffer` set by `initEncryption()`. `createHash` is already imported from `node:crypto`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test -- tests/core/ops/backup.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/ops/types.ts src/core/crypto.ts tests/core/ops/backup.test.ts
git commit -m "feat(ops): add core types and crypto key fingerprint"
```

---

## Task 2: Backup Export

**Files:**
- Create: `src/core/ops/backup.ts`
- Test: `tests/core/ops/backup.test.ts` (append)

- [ ] **Step 1: Write failing tests for createBackup**

Append to `tests/core/ops/backup.test.ts`:

```typescript
import { createBackup } from '@/core/ops/backup'
import type { BackupFile, OpsDb } from '@/core/ops/types'

function makeMockDb(tableData: Record<string, unknown[]> = {}): OpsDb {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: { _: { name: string } }) => {
        const name = table._.name
        return Promise.resolve(tableData[name] ?? [])
      }),
    })),
  } as unknown as OpsDb
}

describe('createBackup', () => {
  it('returns a valid BackupFile with version and timestamp', async () => {
    const db = makeMockDb({
      settings: [{ id: 1, lidarrUrl: 'http://lidarr:8686' }],
      users: [{ id: 1, username: 'admin' }],
    })
    const result = await createBackup(db, { includeCaches: false })

    expect(result.version).toBe(1)
    expect(result.appVersion).toBeDefined()
    expect(result.createdAt).toBeDefined()
    expect(result.includesCaches).toBe(false)
    expect(result.data.settings).toHaveLength(1)
    expect(result.data.users).toHaveLength(1)
  })

  it('excludes cache tables when includeCaches is false', async () => {
    const db = makeMockDb({
      artists: [{ id: 1, name: 'Artist' }],
      genres: [{ id: 1, name: 'Rock' }],
      artist_metadata: [{ id: 1, name: 'Artist' }],
    })
    const result = await createBackup(db, { includeCaches: false })

    expect(result.data.artists).toBeUndefined()
    expect(result.data.genres).toBeUndefined()
    expect(result.data.artistMetadata).toBeUndefined()
  })

  it('includes cache tables when includeCaches is true', async () => {
    const db = makeMockDb({
      artists: [{ id: 1, name: 'Artist' }],
      genres: [{ id: 1, name: 'Rock' }],
      artist_metadata: [{ id: 1, name: 'Meta' }],
    })
    const result = await createBackup(db, { includeCaches: true })

    expect(result.data.artists).toHaveLength(1)
    expect(result.data.genres).toHaveLength(1)
    expect(result.data.artistMetadata).toHaveLength(1)
    expect(result.includesCaches).toBe(true)
  })

  it('includes encryption key fingerprint when encryption is enabled', async () => {
    const { initEncryption } = await import('@/core/crypto')
    initEncryption('test-backup-key')
    const db = makeMockDb()
    const result = await createBackup(db, { includeCaches: false })

    expect(result.encryptionKeyHash).toMatch(/^sha256:/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/core/ops/backup.test.ts`
Expected: FAIL -- cannot import `createBackup`

- [ ] **Step 3: Implement createBackup**

```typescript
// src/core/ops/backup.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  settings,
  users,
  oauthTokens,
  oidcTokens,
  targets,
  subscriptions,
  subscriptionRuns,
  recommendationBatches,
  recommendations,
  playlists,
  playlistTracks,
  artists,
  genres,
  artistMetadata,
} from '@/db/schema'
import { getKeyFingerprint } from '@/core/crypto'
import type { BackupFile, BackupOptions, OpsDb } from './types'

function getAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function selectAll(db: OpsDb, table: { _: { name: string } }): Promise<Record<string, unknown>[]> {
  return db.select().from(table as never) as unknown as Record<string, unknown>[]
}

export async function createBackup(db: OpsDb, options: BackupOptions = {}): Promise<BackupFile> {
  const { includeCaches = false } = options

  const [
    settingsRows,
    userRows,
    oauthRows,
    oidcRows,
    targetRows,
    subRows,
    subRunRows,
    batchRows,
    recRows,
    playlistRows,
    trackRows,
  ] = await Promise.all([
    selectAll(db, settings),
    selectAll(db, users),
    selectAll(db, oauthTokens),
    selectAll(db, oidcTokens),
    selectAll(db, targets),
    selectAll(db, subscriptions),
    selectAll(db, subscriptionRuns),
    selectAll(db, recommendationBatches),
    selectAll(db, recommendations),
    selectAll(db, playlists),
    selectAll(db, playlistTracks),
  ])

  const backup: BackupFile = {
    version: 1,
    appVersion: getAppVersion(),
    createdAt: new Date().toISOString(),
    encryptionKeyHash: getKeyFingerprint(),
    includesCaches: includeCaches,
    data: {
      settings: settingsRows,
      users: userRows,
      oauthTokens: oauthRows,
      oidcTokens: oidcRows,
      targets: targetRows,
      subscriptions: subRows,
      subscriptionRuns: subRunRows,
      recommendationBatches: batchRows,
      recommendations: recRows,
      playlists: playlistRows,
      playlistTracks: trackRows,
    },
  }

  if (includeCaches) {
    const [artistRows, genreRows, metaRows] = await Promise.all([
      selectAll(db, artists),
      selectAll(db, genres),
      selectAll(db, artistMetadata),
    ])
    backup.data.artists = artistRows
    backup.data.genres = genreRows
    backup.data.artistMetadata = metaRows
  }

  return backup
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/core/ops/backup.test.ts`
Expected: PASS

---

## Task 3: Backup Restore

**Files:**
- Modify: `src/core/ops/backup.ts`
- Test: `tests/core/ops/backup.test.ts` (append)

- [ ] **Step 1: Write failing tests for restoreBackup**

Append to `tests/core/ops/backup.test.ts`:

```typescript
import { restoreBackup } from '@/core/ops/backup'
import type { BackupFile, RestoreResult } from '@/core/ops/types'

function makeBackupFile(overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    version: 1,
    appVersion: '0.14.0',
    createdAt: '2026-04-04T12:00:00Z',
    encryptionKeyHash: null,
    includesCaches: false,
    data: {
      settings: [{ id: 1, lidarrUrl: 'http://lidarr:8686' }],
      users: [{ id: 1, username: 'admin', passwordHash: 'hash' }],
      oauthTokens: [],
      oidcTokens: [],
      targets: [],
      subscriptions: [],
      subscriptionRuns: [],
      recommendationBatches: [],
      recommendations: [],
      playlists: [],
      playlistTracks: [],
    },
    ...overrides,
  }
}

function makeMockUpsertDb(): OpsDb & { insertCalls: Record<string, unknown[][]> } {
  const insertCalls: Record<string, unknown[][]> = {}
  return {
    insertCalls,
    insert: vi.fn().mockImplementation((table: { _: { name: string } }) => {
      const name = table._.name
      return {
        values: vi.fn().mockImplementation((rows: unknown[]) => {
          if (!insertCalls[name]) insertCalls[name] = []
          insertCalls[name].push(Array.isArray(rows) ? rows : [rows])
          return {
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
            onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          }
        }),
      }
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    }),
  } as unknown as OpsDb & { insertCalls: Record<string, unknown[][]> }
}

describe('restoreBackup', () => {
  it('validates backup file version', async () => {
    const db = makeMockUpsertDb()
    const backup = makeBackupFile({ version: 999 })
    await expect(restoreBackup(db, backup)).rejects.toThrow('Unsupported backup version')
  })

  it('detects encryption key mismatch and rejects without force', async () => {
    const { initEncryption } = await import('@/core/crypto')
    initEncryption('different-key')
    const db = makeMockUpsertDb()
    const backup = makeBackupFile({ encryptionKeyHash: 'sha256:0000000000' })
    const result = await restoreBackup(db, backup, { force: false })

    expect(result.encryptionMismatch).toBe(true)
    expect(result.affectedEncryptedFields.length).toBeGreaterThan(0)
    expect(result.tablesRestored).toEqual({})
  })

  it('restores with force despite key mismatch', async () => {
    const { initEncryption } = await import('@/core/crypto')
    initEncryption('different-key')
    const db = makeMockUpsertDb()
    const backup = makeBackupFile({ encryptionKeyHash: 'sha256:0000000000' })
    const result = await restoreBackup(db, backup, { force: true })

    expect(result.encryptionMismatch).toBe(true)
    expect(Object.keys(result.tablesRestored).length).toBeGreaterThan(0)
  })

  it('restores tables in FK dependency order', async () => {
    const db = makeMockUpsertDb()
    const backup = makeBackupFile()
    backup.data.targets = [{ id: 1, type: 'lidarr', userId: 1 }]
    await restoreBackup(db, backup)

    const tableOrder = Object.keys(db.insertCalls)
    const settingsIdx = tableOrder.indexOf('settings')
    const usersIdx = tableOrder.indexOf('users')
    const targetsIdx = tableOrder.indexOf('targets')

    // settings and users must come before targets
    expect(settingsIdx).toBeLessThan(targetsIdx)
    expect(usersIdx).toBeLessThan(targetsIdx)
  })

  it('returns count of restored rows per table', async () => {
    const db = makeMockUpsertDb()
    const backup = makeBackupFile()
    backup.data.users = [
      { id: 1, username: 'admin' },
      { id: 2, username: 'user2' },
    ]
    const result = await restoreBackup(db, backup)

    expect(result.tablesRestored.users).toBe(2)
    expect(result.tablesRestored.settings).toBe(1)
  })

  it('skips empty tables without error', async () => {
    const db = makeMockUpsertDb()
    const backup = makeBackupFile()
    backup.data.targets = []
    backup.data.subscriptions = []
    const result = await restoreBackup(db, backup)

    expect(result.tablesRestored.targets).toBeUndefined()
    expect(result.warnings).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/core/ops/backup.test.ts`
Expected: FAIL -- `restoreBackup` not exported

- [ ] **Step 3: Implement restoreBackup**

Add to `src/core/ops/backup.ts`:

```typescript
import { eq } from 'drizzle-orm'
import { getKeyFingerprint } from '@/core/crypto'
import {
  SENSITIVE_SETTINGS,
  SENSITIVE_USER_CONNECTIONS,
  SENSITIVE_OAUTH,
  SENSITIVE_TARGET_CONFIG,
} from '@/core/crypto'
import type { BackupFile, RestoreOptions, RestoreResult, OpsDb } from './types'

const ENCRYPTED_FIELD_MAP: Record<string, readonly string[]> = {
  settings: SENSITIVE_SETTINGS,
  users: SENSITIVE_USER_CONNECTIONS,
  oauthTokens: SENSITIVE_OAUTH,
  oidcTokens: SENSITIVE_OAUTH,
  targets: SENSITIVE_TARGET_CONFIG,
}

// Table restore order respects FK dependencies
const RESTORE_ORDER: {
  key: keyof BackupFile['data']
  table: typeof settings
  conflictTarget: unknown
}[] = [
  { key: 'settings', table: settings, conflictTarget: settings.id },
  { key: 'users', table: users, conflictTarget: users.id },
  { key: 'artists', table: artists, conflictTarget: artists.mbid },
  { key: 'genres', table: genres, conflictTarget: genres.slug },
  { key: 'artistMetadata', table: artistMetadata, conflictTarget: artistMetadata.nameNormalized },
  { key: 'oauthTokens', table: oauthTokens, conflictTarget: oauthTokens.id },
  { key: 'oidcTokens', table: oidcTokens, conflictTarget: oidcTokens.id },
  { key: 'targets', table: targets, conflictTarget: targets.id },
  { key: 'subscriptions', table: subscriptions, conflictTarget: subscriptions.id },
  { key: 'playlists', table: playlists, conflictTarget: playlists.id },
  { key: 'recommendationBatches', table: recommendationBatches, conflictTarget: recommendationBatches.id },
  { key: 'subscriptionRuns', table: subscriptionRuns, conflictTarget: subscriptionRuns.id },
  { key: 'recommendations', table: recommendations, conflictTarget: recommendations.id },
  { key: 'playlistTracks', table: playlistTracks, conflictTarget: playlistTracks.id },
]

function detectEncryptionMismatch(backup: BackupFile): { mismatch: boolean; fields: string[] } {
  const currentFp = getKeyFingerprint()
  const backupFp = backup.encryptionKeyHash

  // Both null = no encryption on either side
  if (!backupFp && !currentFp) return { mismatch: false, fields: [] }
  // Backup encrypted, current not (or vice versa), or different keys
  if (backupFp !== currentFp) {
    const fields: string[] = []
    for (const [tableKey, sensitiveFields] of Object.entries(ENCRYPTED_FIELD_MAP)) {
      const rows = backup.data[tableKey as keyof BackupFile['data']]
      if (rows && Array.isArray(rows) && rows.length > 0) {
        for (const field of sensitiveFields) {
          fields.push(`${tableKey}.${field}`)
        }
      }
    }
    return { mismatch: true, fields }
  }
  return { mismatch: false, fields: [] }
}

export async function restoreBackup(
  db: OpsDb,
  backup: BackupFile,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  if (backup.version !== 1) {
    throw new Error(`Unsupported backup version: ${backup.version}`)
  }

  const { mismatch, fields } = detectEncryptionMismatch(backup)

  if (mismatch && !options.force) {
    return {
      tablesRestored: {},
      warnings: ['Encryption key mismatch. Use force=true to restore anyway.'],
      encryptionMismatch: true,
      affectedEncryptedFields: fields,
    }
  }

  const tablesRestored: Record<string, number> = {}
  const warnings: string[] = []

  for (const { key, table, conflictTarget } of RESTORE_ORDER) {
    const rows = backup.data[key]
    if (!rows || !Array.isArray(rows) || rows.length === 0) continue

    try {
      for (const row of rows) {
        await (db.insert(table as never).values(row as never) as any)
          .onConflictDoUpdate({
            target: conflictTarget,
            set: row,
          })
      }
      tablesRestored[key] = rows.length
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push(`Failed to restore ${key}: ${msg}`)
    }
  }

  return {
    tablesRestored,
    warnings,
    encryptionMismatch: mismatch,
    affectedEncryptedFields: mismatch ? fields : [],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/core/ops/backup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ops/backup.ts tests/core/ops/backup.test.ts
git commit -m "feat(ops): add backup export and restore"
```

---

## Task 4: Admin Routes for Backup

**Files:**
- Create: `src/server/routes/admin.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Create admin route file with backup endpoints**

Read `src/server/index.ts` and `src/server/routes/exports.ts` first for the exact wiring pattern and dependency types.

```typescript
// src/server/routes/admin.ts
import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import type { BackupFile, OpsDb } from '@/core/ops/types'

export interface AdminDeps {
  db: OpsDb
}

export function adminRoutes(deps: AdminDeps) {
  const router = new Hono<HonoEnv>()

  // POST /api/admin/backup -- download backup JSON
  router.post('/api/admin/backup', async (c) => {
    const includeCaches = c.req.query('includeCaches') === 'true'
    const backup = await createBackup(deps.db, { includeCaches })
    const json = JSON.stringify(backup, null, 2)
    const timestamp = new Date().toISOString().slice(0, 10)
    const suffix = includeCaches ? '-full' : ''

    return new Response(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="digarr-backup-${timestamp}${suffix}.json"`,
      },
    })
  })

  // POST /api/admin/restore -- upload and restore backup JSON
  router.post('/api/admin/restore', async (c) => {
    const force = c.req.query('force') === 'true'
    const contentType = c.req.header('content-type') ?? ''

    let backup: BackupFile
    try {
      if (contentType.includes('multipart/form-data')) {
        const form = await c.req.formData()
        const file = form.get('file')
        if (!file || !(file instanceof File)) {
          return c.json({ error: 'No file provided' }, 400)
        }
        const text = await file.text()
        backup = JSON.parse(text)
      } else {
        backup = await c.req.json<BackupFile>()
      }
    } catch {
      return c.json({ error: 'Invalid backup file format' }, 400)
    }

    if (!backup.version || !backup.data) {
      return c.json({ error: 'Invalid backup file structure' }, 400)
    }

    const result = await restoreBackup(deps.db, backup, { force })

    if (result.encryptionMismatch && !force) {
      return c.json({
        error: 'Encryption key mismatch',
        affectedFields: result.affectedEncryptedFields,
        hint: 'Add ?force=true to restore anyway. Encrypted fields will need re-entry.',
      }, 409)
    }

    return c.json(result)
  })

  // GET /api/admin/backup/last -- last auto-backup metadata
  router.get('/api/admin/backup/last', async (c) => {
    // Implemented in Task 6 after upgrade module exists
    return c.json({ lastAutoBackup: null })
  })

  return router
}
```

- [ ] **Step 2: Wire admin routes into server**

Read `src/server/index.ts` to find the exact mount pattern. Add:

```typescript
// In createApp():
import { adminRoutes } from './routes/admin'

// After existing admin guards:
app.use('/api/admin/*', adminGuard(deps.getUserById))
app.route('/', adminRoutes({ db: deps.db }))
```

Note: `deps.db` must be the raw drizzle `db` instance, not `storeDb`. Check how `db` is passed to other route factories in `createApp()` and follow the same pattern. If `db` isn't in `AppDependencies`, add it.

- [ ] **Step 3: Run lint and typecheck**

```bash
bun run lint && bun run typecheck
```

Fix any issues.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/admin.ts src/server/index.ts
git commit -m "feat(ops): add admin backup/restore API endpoints"
```

---

## Task 5: Upgrade Module

**Files:**
- Create: `src/core/ops/upgrade.ts`
- Create: `tests/core/ops/upgrade.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/ops/upgrade.test.ts
// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getPendingMigrations } from '@/core/ops/upgrade'

// Mock fs for journal reading
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([]),
    unlinkSync: vi.fn(),
    statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
  }
})

import { readFileSync, existsSync } from 'node:fs'

const mockJournal = {
  version: '7',
  dialect: 'postgresql',
  entries: [
    { idx: 0, version: '7', when: 1700000000000, tag: '0000_wet_karnak', breakpoints: true },
    { idx: 1, version: '7', when: 1700000001000, tag: '0001_massive_wild_child', breakpoints: true },
    { idx: 2, version: '7', when: 1700000002000, tag: '0002_dazzling_madame_web', breakpoints: true },
  ],
}

describe('getPendingMigrations', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockJournal))
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('returns zero pending when all migrations are applied', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([
        { hash: 'h0', created_at: '1' },
        { hash: 'h1', created_at: '2' },
        { hash: 'h2', created_at: '3' },
      ]),
    }

    const result = await getPendingMigrations(mockDb as never)
    expect(result.pendingCount).toBe(0)
    expect(result.pendingMigrations).toEqual([])
  })

  it('detects pending migrations', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([
        { hash: 'h0', created_at: '1' },
      ]),
    }

    const result = await getPendingMigrations(mockDb as never)
    expect(result.pendingCount).toBe(2)
    expect(result.pendingMigrations).toEqual([
      '0001_massive_wild_child',
      '0002_dazzling_madame_web',
    ])
    expect(result.currentVersion).toBe('0000_wet_karnak')
    expect(result.targetVersion).toBe('0002_dazzling_madame_web')
  })

  it('handles empty database (fresh install)', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([]),
    }

    const result = await getPendingMigrations(mockDb as never)
    expect(result.pendingCount).toBe(3)
    expect(result.currentVersion).toBeNull()
    expect(result.targetVersion).toBe('0002_dazzling_madame_web')
  })

  it('returns empty when journal file is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const mockDb = {
      execute: vi.fn().mockResolvedValue([]),
    }

    const result = await getPendingMigrations(mockDb as never)
    expect(result.pendingCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/core/ops/upgrade.test.ts`
Expected: FAIL -- cannot import `getPendingMigrations`

- [ ] **Step 3: Implement upgrade module**

```typescript
// src/core/ops/upgrade.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createBackup } from './backup'
import type { MigrationStatus, PreFlightResult, OpsDb } from './types'

interface JournalEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

interface Journal {
  version: string
  dialect: string
  entries: JournalEntry[]
}

const JOURNAL_PATH = join(process.cwd(), 'drizzle', 'meta', '_journal.json')
const MAX_AUTO_BACKUPS = 5

function readJournal(): Journal | null {
  if (!existsSync(JOURNAL_PATH)) return null
  try {
    return JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'))
  } catch {
    return null
  }
}

export async function getPendingMigrations(db: OpsDb): Promise<MigrationStatus> {
  const journal = readJournal()
  if (!journal || journal.entries.length === 0) {
    return {
      currentVersion: null,
      targetVersion: null,
      pendingCount: 0,
      pendingMigrations: [],
      lastAutoBackup: getLastAutoBackup(),
    }
  }

  let appliedCount = 0
  try {
    const rows = await (db as any).execute(
      sql`SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at`,
    )
    appliedCount = Array.isArray(rows) ? rows.length : 0
  } catch {
    // Table doesn't exist yet (completely fresh DB)
    appliedCount = 0
  }

  const allEntries = journal.entries.sort((a, b) => a.idx - b.idx)
  const pendingEntries = allEntries.slice(appliedCount)

  return {
    currentVersion: appliedCount > 0 ? allEntries[appliedCount - 1].tag : null,
    targetVersion: allEntries.length > 0 ? allEntries[allEntries.length - 1].tag : null,
    pendingCount: pendingEntries.length,
    pendingMigrations: pendingEntries.map((e) => e.tag),
    lastAutoBackup: getLastAutoBackup(),
  }
}

function getBackupDir(): string {
  return process.env.DIGARR_BACKUP_DIR ?? join(process.cwd(), 'backups')
}

function getLastAutoBackup(): MigrationStatus['lastAutoBackup'] {
  const dir = getBackupDir()
  if (!existsSync(dir)) return null

  const files = readdirSync(dir)
    .filter((f) => f.startsWith('pre-migrate-') && f.endsWith('.json'))
    .sort()
    .reverse()

  if (files.length === 0) return null
  const path = join(dir, files[0])
  try {
    const stat = statSync(path)
    return { path, createdAt: stat.mtime.toISOString() }
  } catch {
    return null
  }
}

function pruneOldBackups(dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('pre-migrate-') && f.endsWith('.json'))
    .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  for (const file of files.slice(MAX_AUTO_BACKUPS)) {
    try {
      unlinkSync(join(dir, file.name))
    } catch {
      // Best effort
    }
  }
}

export async function autoBackup(
  db: OpsDb,
  fromVersion: string | null,
  toVersion: string | null,
): Promise<string | null> {
  const dir = getBackupDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return null
  }

  const backup = await createBackup(db, { includeCaches: false })
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
  const from = fromVersion ?? 'fresh'
  const to = toVersion ?? 'unknown'
  const filename = `pre-migrate-${ts}-${from}-${to}.json`
  const filepath = join(dir, filename)

  writeFileSync(filepath, JSON.stringify(backup, null, 2), 'utf-8')
  pruneOldBackups(dir)

  return filepath
}

export async function runPreFlightCheck(db: OpsDb): Promise<PreFlightResult> {
  const autoBackupEnabled = process.env.DIGARR_AUTO_BACKUP !== 'false'

  const status = await getPendingMigrations(db)

  if (status.pendingCount === 0) {
    return { pendingCount: 0, backupPath: null, backupSkipped: false, backupError: null }
  }

  console.log(
    `[ops] ${status.pendingCount} pending migration(s) detected` +
    ` (current: ${status.currentVersion ?? 'none'}, target: ${status.targetVersion})`,
  )

  if (!autoBackupEnabled) {
    console.log('[ops] Auto-backup disabled (DIGARR_AUTO_BACKUP=false)')
    return { pendingCount: status.pendingCount, backupPath: null, backupSkipped: true, backupError: null }
  }

  try {
    const path = await autoBackup(db, status.currentVersion, status.targetVersion)
    if (path) {
      console.log(`[ops] Auto-backup saved to ${path}`)
    }
    return { pendingCount: status.pendingCount, backupPath: path, backupSkipped: false, backupError: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[ops] Auto-backup failed: ${msg}`)
    return { pendingCount: status.pendingCount, backupPath: null, backupSkipped: false, backupError: msg }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/core/ops/upgrade.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ops/upgrade.ts tests/core/ops/upgrade.test.ts
git commit -m "feat(ops): add upgrade safety module with auto-backup"
```

---

## Task 6: Boot Sequence + Upgrade Route

**Files:**
- Modify: `src/index.ts`
- Modify: `src/server/routes/admin.ts`

- [ ] **Step 1: Wire preFlightCheck into boot sequence**

Read `src/index.ts`. Find the boot sequence (the async IIFE). Insert `runPreFlightCheck` between `initEncryption` and `migrate`:

```typescript
import { runPreFlightCheck } from '@/core/ops/upgrade'

// In boot sequence, BEFORE migrate():
await runPreFlightCheck(db)
// Then existing: await migrate(db, { migrationsFolder: './drizzle' })
```

- [ ] **Step 2: Add pending migrations and last-backup endpoints to admin routes**

Read `src/server/routes/admin.ts`. Add the upgrade-related imports and endpoints:

```typescript
import { getPendingMigrations } from '@/core/ops/upgrade'

// In adminRoutes():

// GET /api/admin/migrations/pending
router.get('/api/admin/migrations/pending', async (c) => {
  const status = await getPendingMigrations(deps.db)
  return c.json(status)
})

// Update the GET /api/admin/backup/last handler to use the real implementation:
router.get('/api/admin/backup/last', async (c) => {
  const status = await getPendingMigrations(deps.db)
  return c.json({ lastAutoBackup: status.lastAutoBackup })
})
```

- [ ] **Step 3: Run lint, typecheck, and tests**

```bash
bun run lint && bun run typecheck && bun run test
```

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/server/routes/admin.ts
git commit -m "feat(ops): wire pre-flight check into boot and add upgrade endpoints"
```

---

## Task 7: Simple Hygiene Tools

**Files:**
- Create: `src/core/ops/hygiene.ts`
- Create: `tests/core/ops/hygiene.test.ts`

- [ ] **Step 1: Write failing tests for clearImageFailures and purgeSessions**

```typescript
// tests/core/ops/hygiene.test.ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { clearImageFailures, purgeSessions } from '@/core/ops/hygiene'

function makeUpdateDb(rowCount: number) {
  return {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount }),
    }),
  }
}

describe('clearImageFailures', () => {
  it('resets imageFailedAt on all artists', async () => {
    const db = makeUpdateDb(42)
    const result = await clearImageFailures(db as never)
    expect(result).toEqual({ tool: 'clear-image-failures', cleared: 42 })
  })
})

describe('purgeSessions', () => {
  it('deletes expired sessions', async () => {
    const db = makeUpdateDb(89)
    const result = await purgeSessions(db as never)
    expect(result).toEqual({ tool: 'purge-sessions', purged: 89 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/core/ops/hygiene.test.ts`
Expected: FAIL -- cannot import from `@/core/ops/hygiene`

- [ ] **Step 3: Implement clearImageFailures and purgeSessions**

```typescript
// src/core/ops/hygiene.ts
import { and, eq, isNotNull, lt, sql, inArray } from 'drizzle-orm'
import { artists, genres, artistMetadata, recommendations, recommendationBatches, sessions } from '@/db/schema'
import type { HygieneResult, AiAuditResult, AiAuditStatus, OpsDb } from './types'

export async function clearImageFailures(db: OpsDb, olderThanDays?: number): Promise<HygieneResult> {
  const conditions = [isNotNull(artists.imageFailedAt)]
  if (olderThanDays) {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000)
    conditions.push(lt(artists.imageFailedAt, cutoff))
  }

  const result = await (db as any)
    .update(artists)
    .set({ imageFailedAt: null })
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))

  return { tool: 'clear-image-failures', cleared: result.rowCount ?? 0 }
}

export async function purgeSessions(db: OpsDb): Promise<HygieneResult> {
  const result = await (db as any)
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))

  return { tool: 'purge-sessions', purged: result.rowCount ?? 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/core/ops/hygiene.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ops/hygiene.ts tests/core/ops/hygiene.test.ts
git commit -m "feat(ops): add image failure and session purge hygiene tools"
```

---

## Task 8: Complex Hygiene Tools

**Files:**
- Modify: `src/core/ops/hygiene.ts`
- Modify: `tests/core/ops/hygiene.test.ts`

- [ ] **Step 1: Write failing tests for dedupeRepair**

Append to `tests/core/ops/hygiene.test.ts`:

```typescript
import { dedupeRepair, rebuildGenres, rescoreRecommendations } from '@/core/ops/hygiene'

describe('dedupeRepair', () => {
  it('finds and removes duplicate recommendations', async () => {
    // Two recs for same user+artist, different batches and scores
    const dupeRows = [
      { userId: 1, artistId: 10, id: 100, score: 0.8, sources: { lb: 0.9 }, batchId: 1 },
      { userId: 1, artistId: 10, id: 101, score: 0.6, sources: { sp: 0.7 }, batchId: 2 },
    ]

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      having: vi.fn().mockResolvedValue([{ userId: 1, artistId: 10, cnt: 2 }]),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(dupeRows),
      orderBy: vi.fn().mockReturnThis(),
    }

    const db = {
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({ rowCount: 1 }),
        }),
      }),
    }

    const result = await dedupeRepair(db as never)
    expect(result.tool).toBe('dedupe')
    expect(result).toHaveProperty('duplicateGroups')
    expect(result).toHaveProperty('removed')
  })
})

describe('rebuildGenres', () => {
  it('rebuilds genre table from artist data', async () => {
    const artistRows = [
      { tags: ['rock', 'indie'], genres: ['rock', 'alternative'] },
      { tags: ['rock', 'metal'], genres: ['metal'] },
    ]

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue(artistRows),
      }),
      delete: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }

    const result = await rebuildGenres(db as never)
    expect(result.tool).toBe('rebuild-genres')
    expect(result).toHaveProperty('genres')
  })
})

describe('rescoreRecommendations', () => {
  it('rescores pending recommendations with new weights', async () => {
    const recRows = [
      {
        recId: 1,
        sources: { listenbrainz: 0.8, lastfm: 0.7 },
        artistGenres: ['rock', 'indie'],
        artistTags: ['rock'],
        artistName: 'Test',
      },
    ]

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(recRows),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({ rowCount: 1 }),
        }),
      }),
    }

    const weights = {
      consensus: 0.3, similarity: 0.25, genreOverlap: 0.2,
      aiConfidence: 0.15, feedbackBoost: 0.1, popularity: 0.0,
    }

    const result = await rescoreRecommendations(db as never, weights, ['rock', 'indie'])
    expect(result.tool).toBe('rescore')
    expect(result).toHaveProperty('rescored')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/core/ops/hygiene.test.ts`
Expected: FAIL -- missing exports

- [ ] **Step 3: Implement dedupeRepair, rebuildGenres, rescoreRecommendations**

Add to `src/core/ops/hygiene.ts`:

```typescript
import type { Preferences } from '@/db/schema'

// ── Dedupe Repair ───────────────────────────────

export async function dedupeRepair(db: OpsDb): Promise<HygieneResult> {
  // Find duplicate (userId, artistId) groups
  const dupeGroups = await (db as any)
    .select({
      userId: recommendations.userId,
      artistId: recommendations.artistId,
      cnt: sql<number>`count(*)::int`,
    })
    .from(recommendations)
    .groupBy(recommendations.userId, recommendations.artistId)
    .having(sql`count(*) > 1`)

  let removed = 0

  for (const group of dupeGroups) {
    // Get all recs in this group, ordered by score desc
    const recs = await (db as any)
      .select({
        id: recommendations.id,
        score: recommendations.score,
        sources: recommendations.sources,
        status: recommendations.status,
      })
      .from(recommendations)
      .where(
        and(
          group.userId != null ? eq(recommendations.userId, group.userId) : sql`${recommendations.userId} IS NULL`,
          eq(recommendations.artistId, group.artistId),
        ),
      )
      .orderBy(sql`${recommendations.score} DESC`)

    if (recs.length <= 1) continue

    // Keep the highest-scored one, mark rest as duplicate
    const duplicateIds = recs.slice(1).map((r: { id: number }) => r.id)

    await (db as any)
      .update(recommendations)
      .set({ status: 'duplicate' })
      .where(inArray(recommendations.id, duplicateIds))

    removed += duplicateIds.length
  }

  return { tool: 'dedupe', duplicateGroups: dupeGroups.length, removed }
}

// ── Rebuild Genres ──────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function rebuildGenres(db: OpsDb): Promise<HygieneResult> {
  const start = Date.now()

  // Collect all genre names from artists and metadata
  const artistRows = await (db as any)
    .select({ tags: artists.tags, genres: artists.genres })
    .from(artists)

  const metaRows = await (db as any)
    .select({ spotifyGenres: artistMetadata.spotifyGenres })
    .from(artistMetadata)

  const genreCounts = new Map<string, number>()

  for (const row of artistRows) {
    const allGenres = [...(row.tags ?? []), ...(row.genres ?? [])]
    for (const g of allGenres) {
      const normalized = g.toLowerCase().trim()
      if (normalized) genreCounts.set(normalized, (genreCounts.get(normalized) ?? 0) + 1)
    }
  }

  for (const row of metaRows) {
    for (const g of row.spotifyGenres ?? []) {
      const normalized = g.toLowerCase().trim()
      if (normalized) genreCounts.set(normalized, (genreCounts.get(normalized) ?? 0) + 1)
    }
  }

  // Clear and rebuild
  await (db as any).delete(genres).execute()

  for (const [name, count] of genreCounts) {
    await (db as any)
      .insert(genres)
      .values({
        name,
        slug: slugify(name),
        source: 'rebuild',
        artistCount: count,
        cachedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: genres.slug,
        set: { artistCount: count, cachedAt: new Date(), source: 'rebuild' },
      })
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  return { tool: 'rebuild-genres', genres: genreCounts.size, elapsed: `${elapsed}s` }
}

// ── Rescore Recommendations ─────────────────────

type ScoringWeights = Preferences['scoringWeights']

function computeGenreOverlap(artistGenres: string[], libraryGenres: string[]): number {
  if (artistGenres.length === 0 || libraryGenres.length === 0) return 0
  const libSet = new Set(libraryGenres.map((g) => g.toLowerCase()))
  const matches = artistGenres.filter((g) => libSet.has(g.toLowerCase()))
  return matches.length / Math.max(artistGenres.length, 1)
}

function rescoreOne(
  sources: Record<string, number>,
  artistGenres: string[],
  libraryGenres: string[],
  weights: ScoringWeights,
): number {
  const sourceKeys = Object.keys(sources)
  const sourceValues = Object.values(sources)

  const consensus = Math.min(sourceKeys.length / 3, 1) // normalized: 3+ sources = 1.0
  const similarity = sourceValues.length > 0 ? Math.max(...sourceValues) : 0
  const genreOverlap = computeGenreOverlap(artistGenres, libraryGenres)
  const aiConfidence = sources['ai'] ?? 0
  // feedbackBoost and popularity are not stored per-rec, so default to 0 for rescore
  const feedbackBoost = 0
  const popularity = 0

  const score =
    weights.consensus * consensus +
    weights.similarity * similarity +
    weights.genreOverlap * genreOverlap +
    weights.aiConfidence * aiConfidence +
    weights.feedbackBoost * feedbackBoost +
    weights.popularity * popularity

  return Math.max(0, Math.min(1, score))
}

export async function rescoreRecommendations(
  db: OpsDb,
  weights: ScoringWeights,
  libraryGenres: string[],
  statusFilter: string[] = ['pending'],
): Promise<HygieneResult> {
  const recs = await (db as any)
    .select({
      recId: recommendations.id,
      sources: recommendations.sources,
      artistGenres: artists.genres,
      artistTags: artists.tags,
      artistName: artists.name,
    })
    .from(recommendations)
    .innerJoin(artists, eq(recommendations.artistId, artists.id))
    .where(inArray(recommendations.status, statusFilter))

  let rescored = 0
  for (const rec of recs) {
    const allGenres = [...(rec.artistGenres ?? []), ...(rec.artistTags ?? [])]
    const newScore = rescoreOne(rec.sources ?? {}, allGenres, libraryGenres, weights)

    await (db as any)
      .update(recommendations)
      .set({ score: newScore })
      .where(eq(recommendations.id, rec.recId))

    rescored++
  }

  return { tool: 'rescore', rescored, weightProfile: weights }
}
```

- [ ] **Step 4: Run tests**

Run: `bun run test -- tests/core/ops/hygiene.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for aiReasoningAudit**

Append to `tests/core/ops/hygiene.test.ts`:

```typescript
import { aiReasoningAudit } from '@/core/ops/hygiene'

describe('aiReasoningAudit', () => {
  it('flags recommendations where name is missing and genres dont overlap', async () => {
    const recRows = [
      {
        recId: 1,
        aiReasoning: 'A great jazz musician with smooth vocals',
        artistName: 'Metallica',
        artistTags: ['metal', 'thrash'],
        artistGenres: ['heavy metal'],
      },
      {
        recId: 2,
        aiReasoning: 'Radiohead is an innovative rock band',
        artistName: 'Radiohead',
        artistTags: ['alternative', 'rock'],
        artistGenres: ['alternative rock'],
      },
    ]

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(recRows),
          }),
        }),
      }),
    }

    const result = await aiReasoningAudit(db as never)
    // Metallica is flagged: name not in reasoning, no genre overlap
    expect(result.flagged).toBe(1)
    expect(result.flaggedIds).toContain(1)
    // Radiohead is NOT flagged: name is in reasoning
    expect(result.flaggedIds).not.toContain(2)
  })

  it('does not flag when name appears in reasoning', async () => {
    const recRows = [
      {
        recId: 1,
        aiReasoning: 'Metallica brings heavy riffs and energy',
        artistName: 'Metallica',
        artistTags: ['pop'],  // genres don't match but name is there
        artistGenres: ['pop'],
      },
    ]

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(recRows),
          }),
        }),
      }),
    }

    const result = await aiReasoningAudit(db as never)
    expect(result.flagged).toBe(0)
  })
})
```

- [ ] **Step 6: Implement aiReasoningAudit**

Add to `src/core/ops/hygiene.ts`:

```typescript
// Module-level state for AI audit results (simple in-memory store)
let auditState: AiAuditStatus = { flaggedIds: [], fixedIds: [], inProgress: false }

export function getAiAuditStatus(): AiAuditStatus {
  return { ...auditState }
}

export async function aiReasoningAudit(
  db: OpsDb,
  autoFix?: { enabled: boolean; generateReasoning: (artistName: string, genres: string[]) => Promise<string> },
): Promise<AiAuditResult> {
  const recs = await (db as any)
    .select({
      recId: recommendations.id,
      aiReasoning: recommendations.aiReasoning,
      artistName: artists.name,
      artistTags: artists.tags,
      artistGenres: artists.genres,
    })
    .from(recommendations)
    .innerJoin(artists, eq(recommendations.artistId, artists.id))
    .where(isNotNull(recommendations.aiReasoning))

  const flaggedIds: number[] = []

  for (const rec of recs) {
    const reasoning = (rec.aiReasoning as string).toLowerCase()
    const name = (rec.artistName as string).toLowerCase()
    const allGenres = [...(rec.artistTags ?? []), ...(rec.artistGenres ?? [])].map((g: string) => g.toLowerCase())

    const namePresent = reasoning.includes(name)
    const genreOverlap = allGenres.some((g: string) => reasoning.includes(g))

    if (!namePresent && !genreOverlap) {
      flaggedIds.push(rec.recId as number)
    }
  }

  const autoFixStarted = !!(autoFix?.enabled && flaggedIds.length > 0)

  // Store results for status polling
  auditState = { flaggedIds, fixedIds: [], inProgress: autoFixStarted }

  if (autoFixStarted) {
    // Fire-and-forget background fix
    ;(async () => {
      for (const id of flaggedIds) {
        try {
          const rec = recs.find((r: { recId: number }) => r.recId === id)
          if (!rec) continue
          const allGenres = [...(rec.artistTags ?? []), ...(rec.artistGenres ?? [])]
          const newReasoning = await autoFix.generateReasoning(rec.artistName as string, allGenres as string[])
          await (db as any)
            .update(recommendations)
            .set({ aiReasoning: newReasoning })
            .where(eq(recommendations.id, id))
          auditState.fixedIds.push(id)
        } catch (err) {
          console.error(`[hygiene] Failed to regenerate reasoning for rec ${id}:`, err)
        }
      }
      auditState.inProgress = false
    })().catch((err) => {
      console.error('[hygiene] AI audit auto-fix failed:', err)
      auditState.inProgress = false
    })
  }

  return {
    scanned: recs.length,
    flagged: flaggedIds.length,
    flaggedIds,
    autoFixStarted,
  }
}
```

- [ ] **Step 7: Run all hygiene tests**

Run: `bun run test -- tests/core/ops/hygiene.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/ops/hygiene.ts tests/core/ops/hygiene.test.ts
git commit -m "feat(ops): add data hygiene tools"
```

---

## Task 9: Hygiene Routes

**Files:**
- Modify: `src/server/routes/admin.ts`

- [ ] **Step 1: Add hygiene imports and endpoints**

Read `src/server/routes/admin.ts`. Add to the `AdminDeps` interface and route handlers:

```typescript
import {
  clearImageFailures,
  purgeSessions,
  dedupeRepair,
  rebuildGenres,
  rescoreRecommendations,
  aiReasoningAudit,
  getAiAuditStatus,
} from '@/core/ops/hygiene'
import { mergePreferences } from '@/db/schema'

// Update AdminDeps:
export interface AdminDeps {
  db: OpsDb
  getUserById: (id: number) => Promise<{ isAdmin: boolean; preferences?: unknown } | null>
  getSettings: () => Promise<{ preferences?: unknown }>
  generateReasoning?: (artistName: string, genres: string[]) => Promise<string>
}

// Add inside adminRoutes():

router.post('/api/admin/hygiene/clear-image-failures', async (c) => {
  const olderThan = c.req.query('olderThan')
  let days: number | undefined
  if (olderThan) {
    const match = olderThan.match(/^(\d+)d$/)
    if (match) days = parseInt(match[1], 10)
  }
  const result = await clearImageFailures(deps.db, days)
  return c.json(result)
})

router.post('/api/admin/hygiene/rebuild-genres', async (c) => {
  const result = await rebuildGenres(deps.db)
  return c.json(result)
})

router.post('/api/admin/hygiene/rescore', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'No user context' }, 400)

  const user = await deps.getUserById(userId)
  const prefs = mergePreferences(user?.preferences as never)
  const statusParam = c.req.query('status') ?? 'pending'
  const statuses = statusParam.split(',')

  // Use library genres from settings/preferences as fallback
  const settings = await deps.getSettings()
  const settingsPrefs = mergePreferences(settings.preferences as never)

  const result = await rescoreRecommendations(deps.db, prefs.scoringWeights, [], statuses)
  return c.json(result)
})

router.post('/api/admin/hygiene/dedupe', async (c) => {
  const result = await dedupeRepair(deps.db)
  return c.json(result)
})

router.post('/api/admin/hygiene/ai-audit', async (c) => {
  const autoFix = c.req.query('autoFix') === 'true'

  const result = await aiReasoningAudit(
    deps.db,
    autoFix && deps.generateReasoning
      ? { enabled: true, generateReasoning: deps.generateReasoning }
      : undefined,
  )

  if (result.autoFixStarted) {
    return c.json(result, 202)
  }
  return c.json(result)
})

router.get('/api/admin/hygiene/ai-audit/results', async (c) => {
  return c.json(getAiAuditStatus())
})

router.post('/api/admin/hygiene/purge-sessions', async (c) => {
  const result = await purgeSessions(deps.db)
  return c.json(result)
})
```

- [ ] **Step 2: Update AdminDeps wiring in server/index.ts**

Read `src/server/index.ts`. Update the `adminRoutes()` call to pass the additional dependencies:

```typescript
app.route('/', adminRoutes({
  db: deps.db,
  getUserById: deps.getUserById,
  getSettings: deps.getSettings,
  // generateReasoning: wire up from provider registry if available
}))
```

For `generateReasoning`, this needs to be wired from the AI provider. Read how the pipeline routes access the provider registry and follow the same pattern. The exact wiring depends on what's available in `AppDependencies` -- check the type and adapt.

- [ ] **Step 3: Run lint, typecheck, tests**

```bash
bun run lint && bun run typecheck && bun run test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/admin.ts src/server/index.ts
git commit -m "feat(ops): add hygiene tool API endpoints"
```

---

## Task 10: Frontend API Wrappers

**Files:**
- Modify: `src/web/lib/api.ts`

- [ ] **Step 1: Add admin API functions**

Read `src/web/lib/api.ts`. Add at the end, following existing patterns:

```typescript
// ── Admin: Backup & Restore ────────────────────

export const downloadBackup = async (includeCaches = false) => {
  const token = getStoredToken()
  const qs = includeCaches ? '?includeCaches=true' : ''
  const res = await fetch(`${BASE}/admin/backup${qs}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})))
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ?? 'digarr-backup.json'
  a.click()
  URL.revokeObjectURL(url)
}

export const restoreBackup = async (file: File, force = false) => {
  const formData = new FormData()
  formData.append('file', file)
  const qs = force ? '?force=true' : ''
  return fetchApi<{
    tablesRestored: Record<string, number>
    warnings: string[]
    encryptionMismatch: boolean
    affectedEncryptedFields: string[]
  }>(`/admin/restore${qs}`, {
    method: 'POST',
    body: formData,
  })
}

export const getLastAutoBackup = () =>
  fetchApi<{ lastAutoBackup: { path: string; createdAt: string } | null }>('/admin/backup/last')

// ── Admin: Migrations ──────────────────────────

export const getPendingMigrations = () =>
  fetchApi<{
    currentVersion: string | null
    targetVersion: string | null
    pendingCount: number
    pendingMigrations: string[]
    lastAutoBackup: { path: string; createdAt: string } | null
  }>('/admin/migrations/pending')

// ── Admin: Hygiene ─────────────────────────────

export const runHygieneTool = (tool: string, params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  return fetchApi<Record<string, unknown>>(`/admin/hygiene/${tool}${qs}`, { method: 'POST' })
}

export const getAiAuditResults = () =>
  fetchApi<{ flaggedIds: number[]; fixedIds: number[]; inProgress: boolean }>('/admin/hygiene/ai-audit/results')
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/web/lib/api.ts
git commit -m "feat(ops): add admin API wrapper functions"
```

---

## Task 11: Administration Tab + Backup Section

**Files:**
- Create: `src/web/components/admin/backup-section.tsx`
- Create: `src/web/components/admin/administration-tab.tsx`
- Modify: `src/web/pages/settings.tsx`

- [ ] **Step 1: Create backup section component**

Read `src/web/pages/settings.tsx` to understand existing patterns (CollapsibleSection, button styles, toast usage). Read `src/web/components/import-artists.tsx` for the file upload pattern. Read `src/web/components/confirm-dialog.tsx` for its API.

```tsx
// src/web/components/admin/backup-section.tsx
import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { downloadBackup, restoreBackup, getLastAutoBackup } from '@/web/lib/api'
import { ConfirmDialog } from '@/web/components/confirm-dialog'
import { toast } from 'sonner'

export function BackupSection() {
  const [includeCaches, setIncludeCaches] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<{
    file: File
    mismatch?: boolean
    affectedFields?: string[]
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: lastBackup } = useQuery({
    queryKey: ['lastAutoBackup'],
    queryFn: getLastAutoBackup,
  })

  async function handleDownload() {
    setDownloading(true)
    try {
      await downloadBackup(includeCaches)
      toast.success('Backup downloaded')
    } catch {
      toast.error('Failed to create backup')
    } finally {
      setDownloading(false)
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      // Try without force first to check for key mismatch
      const result = await restoreBackup(file, false)
      if (result.encryptionMismatch) {
        setConfirmRestore({ file, mismatch: true, affectedFields: result.affectedEncryptedFields })
      } else {
        const total = Object.values(result.tablesRestored).reduce((a, b) => a + b, 0)
        toast.success(`Restored ${total} rows across ${Object.keys(result.tablesRestored).length} tables`)
        if (result.warnings.length > 0) {
          toast.warning(result.warnings.join('; '))
        }
      }
    } catch (err: unknown) {
      const apiErr = err as { status?: number; data?: { affectedFields?: string[] } }
      if (apiErr.status === 409) {
        setConfirmRestore({
          file,
          mismatch: true,
          affectedFields: apiErr.data?.affectedFields ?? [],
        })
      } else {
        toast.error('Failed to restore backup')
      }
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleForceRestore() {
    if (!confirmRestore) return
    setRestoring(true)
    try {
      const result = await restoreBackup(confirmRestore.file, true)
      const total = Object.values(result.tablesRestored).reduce((a, b) => a + b, 0)
      toast.success(`Restored ${total} rows. Re-enter credentials for encrypted fields.`)
    } catch {
      toast.error('Restore failed')
    } finally {
      setRestoring(false)
      setConfirmRestore(null)
    }
  }

  const lastAuto = lastBackup?.lastAutoBackup

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {downloading ? 'Exporting...' : 'Download Backup'}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={includeCaches}
            onChange={(e) => setIncludeCaches(e.target.checked)}
            className="rounded border-border"
          />
          Include caches
        </label>
      </div>

      {lastAuto && (
        <p className="text-xs text-muted">
          Last auto-backup: {new Date(lastAuto.createdAt).toLocaleString()}
        </p>
      )}

      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-text hover:bg-surface"
        >
          Restore from Backup
        </button>
      </div>

      {confirmRestore?.mismatch && (
        <ConfirmDialog
          title="Encryption key mismatch"
          message={`The backup was created with a different encryption key. ${
            confirmRestore.affectedFields?.length
              ? `These fields will need re-entry: ${confirmRestore.affectedFields.join(', ')}`
              : 'Some encrypted fields may need re-entry.'
          }`}
          confirmLabel={restoring ? 'Restoring...' : 'Restore Anyway'}
          destructive
          onConfirm={handleForceRestore}
          onCancel={() => setConfirmRestore(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create administration tab container**

```tsx
// src/web/components/admin/administration-tab.tsx
import { BackupSection } from './backup-section'
import { HygieneSection } from './hygiene-section'
import { UpgradeSection } from './upgrade-section'

// CollapsibleSection is defined in settings.tsx -- either import it or
// extract it to a shared component. Check the codebase for the exact pattern.
// If it's not exported, duplicate the minimal version here or extract it first.

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between p-4 text-text font-medium text-sm hover:bg-surface transition-colors rounded-lg"
      >
        {title}
        <svg
          className={`h-4 w-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

import { useState } from 'react'

export function AdministrationTab() {
  return (
    <div className="space-y-4 max-w-lg">
      <CollapsibleSection title="Backup & Restore" defaultOpen>
        <BackupSection />
      </CollapsibleSection>

      <CollapsibleSection title="Data Hygiene">
        <HygieneSection />
      </CollapsibleSection>

      <CollapsibleSection title="Upgrade Info">
        <UpgradeSection />
      </CollapsibleSection>
    </div>
  )
}
```

**Important:** Before duplicating `CollapsibleSection`, check if it's already exported from settings.tsx or a shared component. If it exists elsewhere, import it. If it's inline in settings.tsx, extract it to a shared location (e.g., `src/web/components/collapsible-section.tsx`) so both settings.tsx and administration-tab.tsx can use it.

- [ ] **Step 3: Wire into settings page**

Read `src/web/pages/settings.tsx`. Make three changes:

1. Add to the `Tab` type union:
```typescript
type Tab = 'connections' | 'targets' | 'recommendations' | 'schedule' | 'account' | 'auth' | 'users' | 'administration'
```

2. Add to the `allTabs` array in `TabBar`:
```typescript
{ id: 'administration', label: 'Administration', adminOnly: true },
```

3. Add the render condition (near the other tab renders):
```typescript
import { AdministrationTab } from '@/web/components/admin/administration-tab'

// In the render section:
{tab === 'administration' && <AdministrationTab />}
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

This will fail until the HygieneSection and UpgradeSection components exist. Create stub versions:

```tsx
// src/web/components/admin/hygiene-section.tsx
export function HygieneSection() {
  return <div className="text-sm text-muted">Hygiene tools loading...</div>
}

// src/web/components/admin/upgrade-section.tsx
export function UpgradeSection() {
  return <div className="text-sm text-muted">Upgrade info loading...</div>
}
```

- [ ] **Step 5: Commit**

```bash
git add src/web/components/admin/ src/web/pages/settings.tsx
git commit -m "feat(ops): add administration tab with backup section"
```

---

## Task 12: Hygiene + Upgrade UI Sections

**Files:**
- Modify: `src/web/components/admin/hygiene-section.tsx`
- Modify: `src/web/components/admin/upgrade-section.tsx`

- [ ] **Step 1: Implement hygiene section**

Read the stub file. Replace with full implementation:

```tsx
// src/web/components/admin/hygiene-section.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { runHygieneTool, getAiAuditResults } from '@/web/lib/api'
import { ConfirmDialog } from '@/web/components/confirm-dialog'
import { toast } from 'sonner'

interface ToolDef {
  id: string
  name: string
  description: string
  params?: Record<string, string>
}

const TOOLS: ToolDef[] = [
  { id: 'clear-image-failures', name: 'Clear Image Failures', description: 'Reset failed image cache so the next scan retries.' },
  { id: 'rebuild-genres', name: 'Rebuild Genre Cache', description: 'Regenerate genres from artist tags and metadata.' },
  { id: 'rescore', name: 'Re-score Recommendations', description: 'Recalculate scores for pending recommendations with current weights.' },
  { id: 'dedupe', name: 'Dedupe Repair', description: 'Find and remove duplicate recommendations for the same artist.' },
  { id: 'ai-audit', name: 'AI Reasoning Audit', description: 'Detect artist/description mismatches from AI hallucinations.', params: { autoFix: 'true' } },
  { id: 'purge-sessions', name: 'Purge Expired Sessions', description: 'Delete expired login sessions.' },
]

export function HygieneSection() {
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, Record<string, unknown>>>({})
  const [confirmTool, setConfirmTool] = useState<ToolDef | null>(null)

  const { data: auditStatus } = useQuery({
    queryKey: ['aiAuditStatus'],
    queryFn: getAiAuditResults,
    refetchInterval: running === 'ai-audit' ? 3000 : false,
  })

  async function handleRun(tool: ToolDef) {
    setRunning(tool.id)
    setConfirmTool(null)
    try {
      const result = await runHygieneTool(tool.id, tool.params)
      setResults((prev) => ({ ...prev, [tool.id]: result }))
      toast.success(`${tool.name} completed`)
    } catch {
      toast.error(`${tool.name} failed`)
    } finally {
      setRunning(null)
    }
  }

  function formatResult(result: Record<string, unknown>): string {
    const entries = Object.entries(result).filter(([k]) => k !== 'tool')
    return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')
  }

  return (
    <div className="space-y-3 pt-2">
      {TOOLS.map((tool) => (
        <div key={tool.id} className="flex items-start justify-between gap-3 p-3 rounded-md border border-border">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{tool.name}</p>
            <p className="text-xs text-muted">{tool.description}</p>
            {results[tool.id] && (
              <p className="text-xs text-accent mt-1">{formatResult(results[tool.id])}</p>
            )}
            {tool.id === 'ai-audit' && auditStatus?.inProgress && (
              <p className="text-xs text-muted mt-1">
                Auto-fix in progress... ({auditStatus.fixedIds.length}/{auditStatus.flaggedIds.length} fixed)
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setConfirmTool(tool)}
            disabled={running === tool.id}
            className="shrink-0 px-2.5 py-1 text-xs font-medium rounded border border-border text-text hover:bg-surface disabled:opacity-50"
          >
            {running === tool.id ? 'Running...' : 'Run'}
          </button>
        </div>
      ))}

      {confirmTool && (
        <ConfirmDialog
          title={`Run ${confirmTool.name}?`}
          message={confirmTool.description}
          confirmLabel="Run"
          destructive={false}
          onConfirm={() => handleRun(confirmTool)}
          onCancel={() => setConfirmTool(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Implement upgrade section**

```tsx
// src/web/components/admin/upgrade-section.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPendingMigrations } from '@/web/lib/api'

export function UpgradeSection() {
  const [expanded, setExpanded] = useState(false)

  const { data } = useQuery({
    queryKey: ['pendingMigrations'],
    queryFn: getPendingMigrations,
  })

  if (!data) return <p className="text-sm text-muted">Loading...</p>

  const autoBackupEnv = data.lastAutoBackup ? 'enabled' : 'unknown'

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Current version</span>
        <span className="text-sm font-mono text-text">{data.currentVersion ?? 'none'}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Pending migrations</span>
        <span className="text-sm text-text">
          {data.pendingCount === 0 ? (
            <span className="text-green-500">Up to date</span>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-accent hover:underline"
            >
              {data.pendingCount} pending
            </button>
          )}
        </span>
      </div>

      {expanded && data.pendingMigrations.length > 0 && (
        <ul className="text-xs font-mono text-muted space-y-0.5 pl-2">
          {data.pendingMigrations.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {data.lastAutoBackup && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Last auto-backup</span>
          <span className="text-xs text-muted">
            {new Date(data.lastAutoBackup.createdAt).toLocaleString()}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Auto-backup</span>
        <span className="text-xs text-muted">{autoBackupEnv}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run typecheck and lint**

```bash
bun run typecheck && bun run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/web/components/admin/hygiene-section.tsx src/web/components/admin/upgrade-section.tsx
git commit -m "feat(ops): complete administration UI with hygiene and upgrade sections"
```

---

## Task 13: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/api.md`
- Modify: `.env.example`

- [ ] **Step 1: Update .env.example**

Read `.env.example`. Add the new env vars in the appropriate section:

```bash
# Backup & Upgrade Safety
# DIGARR_BACKUP_DIR=./backups          # Directory for auto-backups (default: ./backups)
# DIGARR_AUTO_BACKUP=true              # Auto-backup before migrations (default: true, set to false to disable)
```

- [ ] **Step 2: Update README.md**

Read `README.md`. Add a "Backup & Restore" section in the appropriate location (after deployment/before development, or in an "Operations" section). Content:

```markdown
### Backup & Restore

Digarr provides application-level backup and restore through the admin UI (Settings > Administration) or API.

**Manual backup:** `POST /api/admin/backup` returns a JSON file with all configuration, users, targets, subscriptions, and recommendation history. Add `?includeCaches=true` to include artist/genre caches (larger file, but avoids re-fetching from MusicBrainz).

**Restore:** `POST /api/admin/restore` accepts a backup JSON file. Uses upsert (additive merge, not destructive replace). If the encryption key differs from the backup, affected credential fields are listed for manual re-entry.

**Auto-backup before migrations:** When the app detects pending database migrations on startup, it automatically saves a backup to `DIGARR_BACKUP_DIR` (default: `./backups/`). Keeps the last 5 auto-backups. Disable with `DIGARR_AUTO_BACKUP=false`.

### Data Hygiene

Admin tools available under Settings > Administration > Data Hygiene:

- **Clear Image Failures** -- reset failed image cache for retry
- **Rebuild Genre Cache** -- regenerate from artist tags
- **Re-score Recommendations** -- recalculate with current weights
- **Dedupe Repair** -- merge duplicate recommendations
- **AI Reasoning Audit** -- detect and fix AI hallucinations
- **Purge Sessions** -- clean expired login sessions
```

- [ ] **Step 3: Update API docs**

Read `docs/api.md`. Add the admin endpoints section:

```markdown
### Admin

All `/api/admin/*` endpoints require admin authentication.

#### Backup & Restore

- `POST /api/admin/backup` -- Download backup JSON. Query: `?includeCaches=true`
- `POST /api/admin/restore` -- Upload and restore backup. Query: `?force=true` to skip encryption key mismatch check. Accepts multipart form (field: `file`) or raw JSON body.
- `GET /api/admin/backup/last` -- Last auto-backup metadata.

#### Upgrade

- `GET /api/admin/migrations/pending` -- Pending migration status.

#### Data Hygiene

- `POST /api/admin/hygiene/clear-image-failures` -- Query: `?olderThan=7d`
- `POST /api/admin/hygiene/rebuild-genres`
- `POST /api/admin/hygiene/rescore` -- Query: `?status=pending` (default), `?status=pending,approved`
- `POST /api/admin/hygiene/dedupe`
- `POST /api/admin/hygiene/ai-audit` -- Query: `?autoFix=true`. Returns 202 when auto-fix starts.
- `GET /api/admin/hygiene/ai-audit/results` -- Poll auto-fix progress.
- `POST /api/admin/hygiene/purge-sessions`
```

- [ ] **Step 4: Run lint**

```bash
bun run lint
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/api.md .env.example
git commit -m "docs: add ops safety documentation"
```

---

## Final Verification

- [ ] **Run the full test suite**

```bash
bun run test
```

- [ ] **Run lint and typecheck**

```bash
bun run lint && bun run typecheck
```

- [ ] **Verify all admin endpoints return 403 for non-admin users**

Manual or integration test: authenticate as a non-admin user and confirm all `/api/admin/*` endpoints return `{ "error": "Admin access required" }` with status 403.
