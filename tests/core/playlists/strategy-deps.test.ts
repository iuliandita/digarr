// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildStrategyDeps } from '@/core/playlists/strategy-deps'
import type { Database } from '@/db'
import { artists, recommendationBatches, recommendations, users } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

describe('audition artist selection', () => {
  it('isolates users, excludes acted-on recommendations and deduplicates artists before the limit', async () => {
    const result = await makeTestDb()
    close = result.close
    const db = result.db as unknown as Database
    const listeners = await db
      .insert(users)
      .values([
        { username: 'first', passwordHash: 'hash' },
        { username: 'second', passwordHash: 'hash' },
      ])
      .returning()
    const records = await db
      .insert(artists)
      .values([
        { name: 'First', mbid: '00000000-0000-0000-0000-000000000001' },
        { name: 'Second', mbid: '00000000-0000-0000-0000-000000000002' },
        { name: 'Other', mbid: '00000000-0000-0000-0000-000000000003' },
      ])
      .returning()
    const batches = await db.insert(recommendationBatches).values({}).returning()
    const [firstUser, secondUser] = listeners
    const [firstArtist, secondArtist, otherArtist] = records
    const [batch] = batches
    if (!firstUser || !secondUser || !firstArtist || !secondArtist || !otherArtist || !batch) {
      throw new Error('Fixture insert did not return all rows')
    }
    const userId = firstUser.id
    const batchId = batch.id
    await db.insert(recommendations).values([
      { userId, batchId, artistId: firstArtist.id, status: 'pending', score: 0.7 },
      { userId, batchId, artistId: firstArtist.id, status: 'pending', score: 0.9 },
      { userId, batchId, artistId: secondArtist.id, status: 'pending', score: 0.8 },
      { userId, batchId, artistId: otherArtist.id, status: 'approved', score: 1 },
      { userId: secondUser.id, batchId, artistId: otherArtist.id, status: 'pending', score: 1 },
    ])
    const selected = await buildStrategyDeps(db, userId).getPendingArtists({ limit: 2 })
    expect(selected.map((artist) => artist.name)).toEqual(['First', 'Second'])
    expect(await buildStrategyDeps(db, null).getPendingArtists({ limit: 2 })).toEqual([])
  })
})
