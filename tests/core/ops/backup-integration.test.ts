// @vitest-environment node

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { decryptField, encryptField, initEncryption } from '@/core/crypto'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import type { BackupData, BackupFile } from '@/core/ops/types'
import * as schema from '@/db/schema'

const { Pool } = pg

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://digarr:digarr@localhost:5432/digarr'

const pool = new Pool({ connectionString: DATABASE_URL })
const db = drizzle(pool, { schema })

let pgAvailable = true

// Build a BackupFile with all required (non-cache) data arrays empty, then
// overlay only the tables a given test cares about. Lets each test hand-craft
// the exact backup shape it needs without restating every key.
function emptyBackupData(): BackupData {
  return {
    settings: [],
    users: [],
    oauthTokens: [],
    oidcTokens: [],
    targets: [],
    subscriptions: [],
    jobRuns: [],
    recommendationBatches: [],
    recommendations: [],
    playlists: [],
    playlistTracks: [],
    artistBlocks: [],
  }
}

function makeBackup(data: Partial<BackupData> = {}): BackupFile {
  return {
    version: 1,
    appVersion: 'test',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    encryptionKeyHash: null,
    includesCaches: false,
    data: { ...emptyBackupData(), ...data },
  }
}

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`)
  } catch {
    pgAvailable = false
  }
})

afterAll(async () => {
  await pool.end().catch(() => {})
})

beforeEach(async () => {
  if (!pgAvailable) return
  // Clear all backup-managed tables in FK-safe order (children first).
  // RESTART IDENTITY resets serial sequences so each test starts from a
  // pristine id space -- without it, sequence drift across tests makes
  // fixed-id seeds (e.g. an artist expected at id 1) reference rows that
  // were assigned a higher id.
  await db.execute(sql`TRUNCATE
    artist_blocks, playlist_tracks, recommendations, job_runs,
    recommendation_batches, playlists, subscriptions, targets,
    oidc_tokens, oauth_tokens, artist_metadata, genres, artists,
    users, settings
    RESTART IDENTITY CASCADE`)
})

describe('backup/restore integration', () => {
  it('round-trips data through createBackup and restoreBackup', async () => {
    if (!pgAvailable) return
    initEncryption(undefined)

    // 1. Seed minimal FK-complete dataset
    await db.insert(schema.settings).values({
      id: 1,
      setupComplete: true,
    })
    await db.insert(schema.users).values({
      id: 1,
      username: 'test-backup',
      passwordHash: 'x',
      isAdmin: true,
    })
    await db.insert(schema.targets).values({
      id: 1,
      type: 'lidarr',
      name: 'test-target',
      userId: 1,
      config: {},
    })
    await db.insert(schema.subscriptions).values({
      id: 1,
      userId: 1,
      name: 'test-sub',
      sourceType: 'listenbrainz',
      sourceProvider: 'listenbrainz',
      sourceConfig: {},
      cron: '0 0 * * 0',
      enabled: true,
      maxArtistsPerRun: 20,
      action: 'add_to_recommendations',
    })
    await db.insert(schema.artists).values({
      mbid: '00000000-0000-0000-0000-000000000001',
      name: 'Test Artist',
      tags: [],
      genres: ['rock'],
      streamingUrls: {},
    })
    await db.insert(schema.recommendationBatches).values({
      id: 1,
      status: 'completed',
      stats: { total: 1 },
      subscriptionId: 1,
    })
    await db.insert(schema.recommendations).values({
      id: 1,
      userId: 1,
      artistId: 1,
      batchId: 1,
      score: 0.8,
      sources: {},
      status: 'pending',
    })
    await db.insert(schema.artistBlocks).values({
      userId: 1,
      artistId: 1,
    })

    // 2. createBackup
    const backup = await createBackup(db, {})
    expect(backup.version).toBe(1)
    expect(backup.data.users).toHaveLength(1)
    expect(backup.data.recommendations).toHaveLength(1)
    expect(backup.data.targets).toHaveLength(1)

    // 3. restoreBackup (clears + restores in a transaction)
    const result = await restoreBackup(db, backup, {})
    expect(result.tablesRestored.users).toBe(1)
    expect(result.tablesRestored.recommendations).toBe(1)
    expect(result.encryptionMismatch).toBe(false)

    // 4. Verify row counts match
    const users = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users)
    expect(users[0]?.count).toBe(1)

    const recs = await db.select({ count: sql<number>`count(*)::int` }).from(schema.recommendations)
    expect(recs[0]?.count).toBe(1)

    const targets = await db.select({ count: sql<number>`count(*)::int` }).from(schema.targets)
    expect(targets[0]?.count).toBe(1)

    // 5. Verify sequence reset: insert a new user, confirm no PK collision
    const newUsers = await db
      .insert(schema.users)
      .values({
        username: 'after-restore',
        passwordHash: 'x',
        isAdmin: false,
      })
      .returning()
    expect(newUsers[0]?.id).toBeGreaterThan(1)
  })

  it('detects encryption key mismatch', async () => {
    if (!pgAvailable) return

    // Seed with key-A
    initEncryption('key-A')
    await db.insert(schema.settings).values({
      id: 1,
      setupComplete: true,
      lidarrApiKey: 'enc:v1:abc123',
    })
    await db.insert(schema.users).values({
      id: 1,
      username: 'admin',
      passwordHash: 'x',
      isAdmin: true,
    })

    const backup = await createBackup(db, {})
    expect(backup.encryptionKeyHash).toMatch(/^sha256:/)

    // Switch to key-B
    initEncryption('key-B')

    const result = await restoreBackup(db, backup, {})
    expect(result.encryptionMismatch).toBe(true)
    expect(result.affectedEncryptedFields.length).toBeGreaterThan(0)
    expect(result.tablesRestored).toEqual({})

    initEncryption(undefined)
  })

  // C1: restore clears every included table before inserting, so a single
  // restore never hits the onConflictDoUpdate path (Postgres also forbids one
  // INSERT command from touching the same conflict row twice, so an
  // intra-backup duplicate cannot be used to force it -- and the source schema's
  // unique constraints mean createBackup never emits one). The realistic
  // property to guard is idempotency: re-running a restore must clear-and-
  // replace, never accumulate or collide. (The conflict target's UPDATE branch
  // is only reachable across >1000-row chunk boundaries -- out of scope here.)
  it('is idempotent: restoring the same backup twice yields stable row counts', async () => {
    if (!pgAvailable) return
    initEncryption(undefined)

    await db.insert(schema.users).values({
      id: 1,
      username: 'idem-user',
      passwordHash: 'x',
      isAdmin: true,
    })
    await db.insert(schema.targets).values({
      id: 1,
      type: 'lidarr',
      name: 'idem-target',
      userId: 1,
      config: {},
    })

    const backup = await createBackup(db, {})

    const first = await restoreBackup(db, backup, {})
    expect(first.tablesRestored.users).toBe(1)

    // Second restore against the now-populated DB must succeed (no PK/unique
    // collision) and leave exactly the same rows, not double them.
    const second = await restoreBackup(db, backup, {})
    expect(second.tablesRestored.users).toBe(1)

    const users = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users)
    expect(users[0]?.count).toBe(1)
    const targets = await db.select({ count: sql<number>`count(*)::int` }).from(schema.targets)
    expect(targets[0]?.count).toBe(1)
  })

  // C2: old backups store job history under a `subscriptionRuns` key; restore
  // remaps it onto jobRuns. Without this, restoring a pre-rename backup would
  // silently drop all job history.
  it('remaps a legacy subscriptionRuns key onto jobRuns', async () => {
    if (!pgAvailable) return
    initEncryption(undefined)

    const backup = makeBackup()
    // jobRuns stays empty; the legacy key carries the history (cast: the key
    // predates the BackupData type).
    ;(backup.data as unknown as Record<string, unknown[]>).subscriptionRuns = [
      { type: 'subscription', status: 'completed' },
    ]

    const result = await restoreBackup(db, backup, {})
    expect(result.tablesRestored.jobRuns).toBe(1)

    const rows = await db
      .select({ type: schema.jobRuns.type, status: schema.jobRuns.status })
      .from(schema.jobRuns)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('subscription')
  })

  // C3: restore runs inside one transaction. A failure partway through (here a
  // recommendation referencing a non-existent artist FK, which inserts after
  // users) must roll back everything -- including the pre-insert table clear -- so
  // the prior database state is left intact.
  it('rolls back atomically when a later insert fails mid-restore', async () => {
    if (!pgAvailable) return
    initEncryption(undefined)

    // Pre-existing state that the restore would clear-then-replace.
    await db.insert(schema.users).values({
      id: 1,
      username: 'before-restore',
      passwordHash: 'x',
      isAdmin: true,
    })

    const backup = makeBackup({
      users: [{ id: 2, username: 'from-backup', passwordHash: 'x', isAdmin: false }],
      // artistId 999 has no matching artist row -> NOT NULL FK violation when
      // recommendations insert (which runs after users) executes.
      recommendations: [
        {
          id: 1,
          userId: 2,
          artistId: 999,
          batchId: 999,
          score: 0.5,
          sources: {},
          status: 'pending',
        },
      ],
    })

    await expect(restoreBackup(db, backup, {})).rejects.toThrow()

    // The transaction rolled back: the original user survives, the backup's
    // user never landed, and no recommendations were written.
    const users = await db.select({ username: schema.users.username }).from(schema.users)
    expect(users).toHaveLength(1)
    expect(users[0]?.username).toBe('before-restore')

    const recs = await db.select({ count: sql<number>`count(*)::int` }).from(schema.recommendations)
    expect(recs[0]?.count).toBe(0)
  })

  // C4: an encrypted field must survive the round-trip unchanged and stay
  // decryptable when backup and restore use the same key (fingerprints match,
  // so no mismatch is flagged).
  it('preserves an encrypted field across a same-key round-trip', async () => {
    if (!pgAvailable) return
    initEncryption('round-trip-key')

    const plaintext = 'super-secret-lidarr-key'
    const cipher = encryptField(plaintext)
    expect(cipher).toMatch(/^enc:v1:/)

    await db.insert(schema.settings).values({
      id: 1,
      setupComplete: true,
      lidarrApiKey: cipher,
    })

    const backup = await createBackup(db, {})
    expect(backup.encryptionKeyHash).toMatch(/^sha256:/)

    const result = await restoreBackup(db, backup, {})
    expect(result.encryptionMismatch).toBe(false)

    const rows = await db
      .select({ lidarrApiKey: schema.settings.lidarrApiKey })
      .from(schema.settings)
    // Ciphertext is byte-identical after the round-trip...
    expect(rows[0]?.lidarrApiKey).toBe(cipher)
    // ...and still decrypts to the original under the same key.
    expect(decryptField(rows[0]?.lidarrApiKey)).toBe(plaintext)

    initEncryption(undefined)
  })
})
