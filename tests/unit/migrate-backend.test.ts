import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertDatabaseCopyTargetEmpty,
  BACKUP_TABLE_BY_KEY,
  copyDatabaseTables,
  DatabaseCopyTargetNotEmptyError,
} from '@/core/ops/backup'
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
  const [target] = await db
    .insert(schema.targets)
    .values({ userId: user.id, type: 'spotify', name: 'Migration target' })
    .returning()
  if (!target) throw new Error('target insert failed')
  await db.insert(schema.playlistExports).values({
    playlistId: playlist.id,
    targetId: target.id,
    remoteScope: 'v1:migration-scope',
    remotePlaylistId: 'migration-remote',
    state: 'linked',
  })
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
    expect(report.tablesMigrated.playlistExports).toBe(1)
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

  it.each(['settings', 'artists', 'recordingArtistCache'] as const)(
    'preserves a populated %s target with no users unless overwrite is explicit',
    async (key) => {
      const src = await makeTestDb()
      const path = tgt(`userless-${key}`)
      const target = await makeTestDb({ path })
      const table = {
        settings: schema.settings,
        artists: schema.artists,
        recordingArtistCache: schema.recordingArtistCache,
      }[key]
      let expected: unknown[]
      try {
        if (key === 'settings') {
          await target.db.insert(schema.settings).values({ setupComplete: true })
        } else if (key === 'artists') {
          await target.db
            .insert(schema.artists)
            .values({ mbid: '00000000-0000-0000-0000-000000000010', name: 'Keep me' })
        } else {
          await target.db.insert(schema.recordingArtistCache).values({
            recordingMbid: '00000000-0000-0000-0000-000000000011',
            artistMbid: '00000000-0000-0000-0000-000000000010',
            artistName: 'Keep me',
          })
        }
        expected = await target.db.select().from(table)
        await expect(
          copyDatabaseTables(src.db as never, target.db as never, { requireEmptyTarget: true }),
        ).rejects.toBeInstanceOf(DatabaseCopyTargetNotEmptyError)
        expect(await target.db.select().from(table)).toEqual(expected)
      } finally {
        await target.close()
      }
      try {
        await expect(
          migrateBackend({
            sourceDb: src.db as never,
            target: { backend: 'pglite', path },
            isPipelineRunning: () => false,
          }),
        ).rejects.toMatchObject({ code: 'target_not_empty' })
        const unchanged = await makeTestDb({ path })
        try {
          expect(await unchanged.db.select().from(table)).toEqual(expected)
          expect(await unchanged.db.select().from(schema.users)).toEqual([])
        } finally {
          await unchanged.close()
        }
        const report = await migrateBackend({
          sourceDb: src.db as never,
          target: { backend: 'pglite', path },
          isPipelineRunning: () => false,
          overwrite: true,
        })
        expect(report.verified).toBe(true)
      } finally {
        await src.close()
      }
    },
  )

  it.each([false, true])(
    'accepts an empty pre-migration target with partial schema: %s',
    async (partial) => {
      const client = new PGlite()
      const db = drizzle(client)
      try {
        if (partial) await db.execute(sql`CREATE TABLE settings (id integer)`)
        await expect(
          assertDatabaseCopyTargetEmpty(db as never, { allowMissingTables: true }),
        ).resolves.toBeUndefined()
        await expect(assertDatabaseCopyTargetEmpty(db as never)).rejects.toThrow()
      } finally {
        await client.close()
      }
    },
  )

  it.each([
    { stage: 'catalog', response: undefined },
    { stage: 'catalog', response: { rows: [] } },
    { stage: 'catalog', response: { rows: [{ present: 'false' }] } },
    { stage: 'table', response: { rows: null } },
    { stage: 'table', response: { rows: [{}] } },
  ])('fails closed for a malformed $stage response: $response', async ({ stage, response }) => {
    const execute = vi.fn()
    if (stage === 'table') execute.mockResolvedValueOnce({ rows: [{ present: true }] })
    execute.mockResolvedValueOnce(response)
    await expect(
      assertDatabaseCopyTargetEmpty({ execute } as never, { allowMissingTables: true }),
    ).rejects.toThrow(/Cannot verify target database emptiness/)
  })

  it.each(['catalog', 'table'])(
    'propagates %s read failures without treating them as empty',
    async (stage) => {
      const execute = vi.fn()
      if (stage === 'table') execute.mockResolvedValueOnce({ rows: [{ present: true }] })
      execute.mockRejectedValueOnce(new Error('permission denied'))
      await expect(
        assertDatabaseCopyTargetEmpty({ execute } as never, { allowMissingTables: true }),
      ).rejects.toThrow('permission denied')
    },
  )

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
