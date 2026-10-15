import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import {
  getPlaylistExport,
  getPlaylistExports,
  linkPlaylistExport,
  markPlaylistExportRecoveryRequired,
  reservePlaylistExport,
  resetPlaylistExport,
} from '@/db/queries/playlist-exports'
import { playlistExports, playlists, targets, users } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const scope = `v1:${'a'.repeat(64)}`
let testDb: Awaited<ReturnType<typeof makeTestDb>>
let db: Database

beforeAll(async () => {
  testDb = await makeTestDb()
  db = testDb.db as unknown as Database
})
afterAll(async () => testDb.close())
beforeEach(async () => {
  await db.execute(sql`TRUNCATE users CASCADE`)
  await db.insert(users).values([
    { id: 1, username: 'owner', passwordHash: 'hash' },
    { id: 2, username: 'other', passwordHash: 'hash' },
  ])
  await db.insert(playlists).values([
    { id: 1, userId: 1, name: 'Owned', strategy: 'weekly_digest' },
    { id: 2, userId: 2, name: 'Other', strategy: 'weekly_digest' },
  ])
  await db.insert(targets).values([
    { id: 1, userId: 1, name: 'Owned', type: 'spotify' },
    { id: 2, userId: 2, name: 'Other', type: 'spotify' },
  ])
})

describe('playlist export bindings', () => {
  it('reserves exactly once across concurrent callers and preserves the original scope', async () => {
    const results = await Promise.all([
      reservePlaylistExport(db, 1, 1, 1, scope),
      reservePlaylistExport(db, 1, 1, 1, 'v1:changed'),
    ])
    expect(results.filter((result) => result.created)).toHaveLength(1)
    expect(results[0]?.binding.id).toBe(results[1]?.binding.id)
    expect(await getPlaylistExport(db, 1, 1, 1)).toMatchObject({
      state: 'creating',
      remotePlaylistId: null,
      remoteScope: scope,
    })
    expect((await reservePlaylistExport(db, 1, 1, 1, 'v1:later')).binding.remoteScope).toBe(scope)
  })

  it('validates both parent owners for reads and every mutation', async () => {
    await reservePlaylistExport(db, 1, 1, 1, scope)
    for (const [userId, playlistId, targetId] of [
      [2, 1, 1],
      [1, 1, 2],
      [1, 2, 1],
    ] as const) {
      expect(await getPlaylistExport(db, userId, playlistId, targetId)).toBeNull()
      await expect(reservePlaylistExport(db, userId, playlistId, targetId, scope)).rejects.toThrow(
        /not owned/,
      )
      await expect(
        linkPlaylistExport(db, userId, playlistId, targetId, scope, 'remote'),
      ).rejects.toThrow(/not owned/)
      await expect(
        markPlaylistExportRecoveryRequired(db, userId, playlistId, targetId),
      ).rejects.toThrow(/not owned/)
      await expect(resetPlaylistExport(db, userId, playlistId, targetId)).rejects.toThrow(
        /not owned/,
      )
    }
    await db.update(targets).set({ userId: 2 }).where(eq(targets.id, 1))
    expect(await getPlaylistExports(db, 1, 1)).toEqual([])
    expect(await getPlaylistExports(db, 2, 1)).toEqual([])
    expect(await db.select().from(playlistExports)).toHaveLength(1)
  })

  it('checkpoints only a creating binding in the same scope and retains a linked ID on failures', async () => {
    await expect(linkPlaylistExport(db, 1, 1, 1, scope, 'remote')).rejects.toThrow(/checkpoint/)
    await reservePlaylistExport(db, 1, 1, 1, scope)
    await expect(linkPlaylistExport(db, 1, 1, 1, 'v1:changed', 'remote')).rejects.toThrow(
      /checkpoint/,
    )
    await linkPlaylistExport(db, 1, 1, 1, scope, 'remote')
    await markPlaylistExportRecoveryRequired(db, 1, 1, 1)
    await expect(linkPlaylistExport(db, 1, 1, 1, scope, 'replacement')).rejects.toThrow(
      /checkpoint/,
    )
    expect(await getPlaylistExport(db, 1, 1, 1)).toMatchObject({
      state: 'linked',
      remotePlaylistId: 'remote',
    })
    await resetPlaylistExport(db, 1, 1, 1)
    await reservePlaylistExport(db, 1, 1, 1, scope)
    await markPlaylistExportRecoveryRequired(db, 1, 1, 1)
    await expect(linkPlaylistExport(db, 1, 1, 1, scope, 'late')).rejects.toThrow(/checkpoint/)
    expect((await reservePlaylistExport(db, 1, 1, 1, scope)).created).toBe(false)
    expect(await getPlaylistExport(db, 1, 1, 1)).toMatchObject({
      state: 'recovery_required',
      remotePlaylistId: null,
    })
  })

  it('explicit reset removes only the binding and permits a new reservation', async () => {
    await reservePlaylistExport(db, 1, 1, 1, scope)
    await resetPlaylistExport(db, 1, 1, 1)
    expect(await getPlaylistExports(db, 1, 1)).toEqual([])
    expect(await db.select().from(playlists).where(eq(playlists.id, 1))).toHaveLength(1)
    expect(await db.select().from(targets).where(eq(targets.id, 1))).toHaveLength(1)
    expect((await reservePlaylistExport(db, 1, 1, 1, 'v1:new')).created).toBe(true)
  })

  it('rejects invalid remote values, invalid FKs and cascades when either parent is deleted', async () => {
    for (const invalid of ['', '  ', 'x'.repeat(2049)]) {
      await expect(reservePlaylistExport(db, 1, 1, 1, invalid)).rejects.toThrow(/Invalid/)
      await reservePlaylistExport(db, 1, 1, 1, scope)
      await expect(linkPlaylistExport(db, 1, 1, 1, scope, invalid)).rejects.toThrow(/Invalid/)
    }
    await expect(
      db.insert(playlistExports).values({ playlistId: 999, targetId: 1, remoteScope: scope }),
    ).rejects.toThrow()
    await expect(
      db.insert(playlistExports).values({ playlistId: 1, targetId: 999, remoteScope: scope }),
    ).rejects.toThrow()
    await db.delete(targets).where(eq(targets.id, 1))
    expect(await db.select().from(playlistExports)).toEqual([])
    await db.insert(targets).values({ id: 1, userId: 1, name: 'Owned', type: 'spotify' })
    await reservePlaylistExport(db, 1, 1, 1, scope)
    await db.delete(playlists).where(eq(playlists.id, 1))
    expect(await db.select().from(playlistExports)).toEqual([])
  })
})
