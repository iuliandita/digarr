import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_TABLE_BY_KEY, copyDatabaseTables } from '@/core/ops/backup'
import { migrateBackend } from '@/core/ops/migrate-backend'
import * as schema from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

type TestDatabase = Awaited<ReturnType<typeof makeTestDb>>['db']

// PGlite WASM cold-start + migrations can exceed the 5s default under full-suite
// parallel contention; these tests pass in isolation. Give them headroom.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

function tgt(name: string) {
  return join(process.env.DIGARR_MIGRATE_DATA_ROOT as string, name)
}

// Seed a minimal but representative dataset (user + a couple stateful rows).
async function seedFullFixtures(db: TestDatabase) {
  const [user] = await db
    .insert(schema.users)
    .values({ username: 'mig', passwordHash: 'x' })
    .returning()
  if (!user) throw new Error('user insert failed')
  await db.insert(schema.settings).values({ setupComplete: true })
  await db.insert(schema.genres).values({ name: 'Synthwave', slug: 'synthwave', source: 'manual' })
  const [artist] = await db
    .insert(schema.artists)
    .values({ mbid: '00000000-0000-0000-0000-000000000001', name: 'Migration Artist' })
    .returning()
  if (!artist) throw new Error('artist insert failed')
  await db.insert(schema.artistBlocks).values({ userId: user.id, artistId: artist.id })
  const [playlist] = await db
    .insert(schema.playlists)
    .values({ userId: user.id, name: 'Migration Playlist', strategy: 'weekly_digest' })
    .returning()
  if (!playlist) throw new Error('playlist insert failed')
  await db.insert(schema.playlistTracks).values({
    playlistId: playlist.id,
    artistName: artist.name,
    trackName: 'Migration Track',
    position: 1,
  })
  await db.insert(schema.libraryArtists).values({
    userId: user.id,
    source: 'lidarr',
    sourceArtistId: 'migration-artist',
    name: artist.name,
    nameNormalized: 'migration artist',
  })
  await db.insert(schema.recordingArtistCache).values({
    recordingMbid: '00000000-0000-0000-0000-000000000002',
    artistMbid: artist.mbid,
    artistName: artist.name,
  })
  return { user, artist, playlist }
}

async function installUserTrigger(db: TestDatabase, name: string, body: string) {
  await db.execute(
    sql.raw(`
    CREATE FUNCTION ${name}() RETURNS trigger AS $$
    BEGIN
      ${body}
    END;
    $$ LANGUAGE plpgsql
  `),
  )
  await db.execute(
    sql.raw(`
    CREATE TRIGGER ${name}
    BEFORE INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION ${name}()
  `),
  )
}

describe('migrateBackend', () => {
  beforeEach(() => {
    process.env.DIGARR_MIGRATE_DATA_ROOT = mkdtempSync(join(tmpdir(), 'digarr-mig-'))
  })
  afterEach(() => {
    delete process.env.DIGARR_MIGRATE_DATA_ROOT
  })

  it('refuses when the pipeline is running', async () => {
    // The guard throws before sourceDb or the target is ever touched, so no real
    // DB is needed — avoids a slow PGlite cold-start that flakes the default timeout.
    await expect(
      migrateBackend({
        sourceDb: null as never,
        target: { backend: 'pglite', path: tgt('a') },
        isPipelineRunning: () => true,
      }),
    ).rejects.toThrow(/pipeline is running/i)
  })

  it('copies all data and verifies counts AND content hashes', async () => {
    const src = await makeTestDb()
    await seedFullFixtures(src.db)
    const report = await migrateBackend({
      sourceDb: src.db as never,
      target: { backend: 'pglite', path: tgt('ok') },
      isPipelineRunning: () => false,
    })
    expect(report.ok).toBe(true)
    expect(report.verified).toBe(true)
    expect(report.contentVerified).toBe(true)
    expect(report.tablesMigrated.users).toBeGreaterThan(0)
    expect(Object.keys(report.tablesMigrated).sort()).toEqual(
      Object.keys(BACKUP_TABLE_BY_KEY).sort(),
    )
    expect(report.excludedTables).toEqual(['sessions', 'rateLimitBuckets'])
    expect(report.mismatches).toEqual([])
    expect(report.targetEnvHint).toMatch(/DB_PATH=/)
    await src.close()
  })

  it('excludes legacy OIDC tokens from the database-copy registry', () => {
    expect(BACKUP_TABLE_BY_KEY).not.toHaveProperty('oidcTokens')
  })

  it('does not copy legacy OIDC token rows between databases', async () => {
    const src = await makeTestDb()
    const target = await makeTestDb()
    try {
      const [user] = await src.db
        .insert(schema.users)
        .values({ username: 'oidc-copy-source', passwordHash: 'x' })
        .returning()
      if (!user) throw new Error('user insert failed')
      await src.db.insert(schema.oidcTokens).values({
        userId: user.id,
        issuerUrl: 'https://issuer.example',
        accessToken: 'legacy-access-token',
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      })

      const result = await copyDatabaseTables(src.db as never, target.db as never)

      expect(result.tablesRestored).not.toHaveProperty('oidcTokens')
      expect(await target.db.select().from(schema.oidcTokens)).toEqual([])
    } finally {
      await src.close()
      await target.close()
    }
  })

  it('reports a row-count mismatch from the copied table', async () => {
    const src = await makeTestDb()
    const target = await makeTestDb()
    try {
      await src.db.insert(schema.users).values({ username: 'mig', passwordHash: 'x' })
      await installUserTrigger(target.db, 'skip_migrated_user', 'RETURN NULL;')

      const result = await copyDatabaseTables(src.db as never, target.db as never)

      expect(result.mismatches).toContainEqual({ table: 'users', source: 1, target: 0 })
    } finally {
      await src.close()
      await target.close()
    }
  })

  it('reports a content mismatch when row counts agree', async () => {
    const src = await makeTestDb()
    const target = await makeTestDb()
    try {
      await src.db.insert(schema.users).values({ username: 'mig', passwordHash: 'x' })
      await installUserTrigger(
        target.db,
        'mutate_migrated_user',
        "NEW.username := NEW.username || '-changed'; RETURN NEW;",
      )

      const result = await copyDatabaseTables(src.db as never, target.db as never)

      expect(result.mismatches).toContainEqual({
        table: 'users',
        source: 1,
        target: 1,
        contentDiffers: true,
      })
    } finally {
      await src.close()
      await target.close()
    }
  })

  it('rolls back the target when a later table fails to restore', async () => {
    const src = await makeTestDb()
    const target = await makeTestDb()
    try {
      await src.db.insert(schema.users).values({ username: 'copied', passwordHash: 'x' })
      await target.db.insert(schema.users).values({ username: 'survivor', passwordHash: 'x' })
      const failingSource = {
        select: () => ({
          from: async (table: unknown) => {
            if (table === schema.slskdJobs) {
              return [
                {
                  id: 1,
                  userId: 999,
                  targetId: 999,
                  sourceType: 'recommendation',
                  workKey: 'invalid-job',
                  artistMbid: '00000000-0000-0000-0000-000000000003',
                  artistName: 'Invalid Artist',
                  releaseTitle: 'Invalid Release',
                },
              ]
            }
            return src.db.select().from(table as never)
          },
        }),
      }

      await expect(copyDatabaseTables(failingSource as never, target.db as never)).rejects.toThrow()
      expect(await target.db.select().from(schema.users)).toMatchObject([{ username: 'survivor' }])
    } finally {
      await src.close()
      await target.close()
    }
  })

  it('refuses a non-empty target without overwrite, succeeds with overwrite', async () => {
    const src = await makeTestDb()
    await seedFullFixtures(src.db)
    const path = tgt('reuse')
    await migrateBackend({
      sourceDb: src.db as never,
      target: { backend: 'pglite', path },
      isPipelineRunning: () => false,
    })
    await expect(
      migrateBackend({
        sourceDb: src.db as never,
        target: { backend: 'pglite', path },
        isPipelineRunning: () => false,
      }),
    ).rejects.toThrow(/not empty/i)
    const report = await migrateBackend({
      sourceDb: src.db as never,
      target: { backend: 'pglite', path },
      isPipelineRunning: () => false,
      overwrite: true,
    })
    expect(report.verified).toBe(true)
    await src.close()
  })

  it('refuses when the target is the same cluster as the source (fingerprint match)', async () => {
    // File-backed source so a second handle on the same dir yields the same system_identifier.
    const src = await makeTestDb({ path: tgt('self') })
    await expect(
      migrateBackend({
        sourceDb: src.db as never,
        target: { backend: 'pglite', path: tgt('self') },
        isPipelineRunning: () => false,
      }),
    ).rejects.toThrow(/same .* source/i)
    await src.close()
  })
})
