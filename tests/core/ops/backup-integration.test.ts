// @vitest-environment node

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initEncryption } from '@/core/crypto'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import * as schema from '@/db/schema'

const { Pool } = pg

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://digarr:digarr@localhost:5432/digarr'

const pool = new Pool({ connectionString: DATABASE_URL })
const db = drizzle(pool, { schema })

let pgAvailable = true

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
  // Clear all backup-managed tables in FK-safe order (children first)
  await db.execute(sql`TRUNCATE
    artist_blocks, playlist_tracks, recommendations, job_runs,
    recommendation_batches, playlists, subscriptions, targets,
    oidc_tokens, oauth_tokens, artist_metadata, genres, artists,
    users, settings
    CASCADE`)
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
})
