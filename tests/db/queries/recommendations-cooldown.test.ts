import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '@/db'
import {
  getExistingAlbumReleaseGroupMbids,
  getExistingRecommendationMbids,
  getRejectedArtistMbids,
} from '@/db/queries/recommendations'
import { artists, recommendationBatches, recommendations, users } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

describe('rejection cooldown ownership on migrated PGlite', () => {
  let fixture: Awaited<ReturnType<typeof makeTestDb>>
  const expected = new Map<number | null, string>()
  const mbidsByOwner = new Map<number | null, Map<string, string>>()

  beforeAll(async () => {
    fixture = await makeTestDb()
    const { db } = fixture
    await db.insert(users).values([
      { id: 1, username: 'cooldown-one', passwordHash: 'test' },
      { id: 2, username: 'cooldown-two', passwordHash: 'test' },
    ])
    const [batch] = await db.insert(recommendationBatches).values({}).returning()
    if (!batch) throw new Error('Missing cooldown batch fixture')
    const day = 24 * 60 * 60 * 1000
    const recent = new Date(Date.now() - day)
    const expired = new Date(Date.now() - 31 * day)
    let artistNumber = 0
    for (const userId of [1, 2, null]) {
      for (const variant of ['recent', 'expired', 'pending', 'unacted']) {
        const mbid = `00000000-0000-0000-0000-${String(++artistNumber).padStart(12, '0')}`
        const [artist] = await db
          .insert(artists)
          .values({ mbid, name: `Owner ${userId} ${variant}` })
          .returning()
        if (!artist) throw new Error('Missing cooldown artist fixture')
        const owned = mbidsByOwner.get(userId) ?? new Map<string, string>()
        owned.set(variant, mbid)
        mbidsByOwner.set(userId, owned)
        const row = {
          userId,
          artistId: artist.id,
          batchId: batch.id,
          score: 0.8,
          status: variant === 'pending' ? 'pending' : 'rejected',
          actedOnAt: variant === 'unacted' ? null : variant === 'expired' ? expired : recent,
        }
        await db.insert(recommendations).values(row)
        if (variant === 'recent') {
          expected.set(userId, mbid)
          await db.insert(recommendations).values(row)
        }
      }
    }
  }, 30_000)

  afterAll(async () => {
    await fixture?.close()
  })

  it.each([1, 2, null])(
    'returns only recent, acted-on rejections owned by %s, with duplicate MBIDs collapsed',
    async (userId) => {
      const result = await getRejectedArtistMbids(fixture.db as unknown as Database, 30, userId)

      expect(result).toEqual(new Set([expected.get(userId)]))
    },
  )

  it.each([1, 2])(
    'dedup set for user %s releases only rejections past the cooldown',
    async (userId) => {
      const result = await getExistingRecommendationMbids(
        fixture.db as unknown as Database,
        userId,
        { rejectionCooldownDays: 30 },
      )

      const kept = [userId, null].flatMap((owner) =>
        ['recent', 'pending', 'unacted'].map((variant) => mbidsByOwner.get(owner)?.get(variant)),
      )
      expect(result).toEqual(new Set(kept))
    },
  )

  it('keeps every existing recommendation when no cooldown is given', async () => {
    const result = await getExistingRecommendationMbids(fixture.db as unknown as Database, 1)

    expect(result.size).toBe(8)
  })

  it('album dedup set releases album rejections past the cooldown', async () => {
    const { db } = fixture
    const [batch] = await db.insert(recommendationBatches).values({}).returning()
    const [artist] = await db
      .insert(artists)
      .values({ mbid: '00000000-0000-0000-0001-000000000001', name: 'Album owner' })
      .returning()
    if (!batch || !artist) throw new Error('Missing album cooldown fixture')
    const day = 24 * 60 * 60 * 1000
    const rows = [
      { rg: 'rg-expired', status: 'rejected', actedOnAt: new Date(Date.now() - 31 * day) },
      { rg: 'rg-recent', status: 'rejected', actedOnAt: new Date(Date.now() - day) },
      { rg: 'rg-pending', status: 'pending', actedOnAt: null },
    ]
    for (const row of rows) {
      await db.insert(recommendations).values({
        userId: 1,
        artistId: artist.id,
        batchId: batch.id,
        score: 0.8,
        kind: 'album',
        recommendedReleaseGroupId: row.rg,
        status: row.status,
        actedOnAt: row.actedOnAt,
      })
    }

    const withCooldown = await getExistingAlbumReleaseGroupMbids(db as unknown as Database, 1, {
      rejectionCooldownDays: 30,
    })
    const withoutCooldown = await getExistingAlbumReleaseGroupMbids(db as unknown as Database, 1)

    expect(withCooldown).toEqual(new Set(['rg-recent', 'rg-pending']))
    expect(withoutCooldown).toEqual(new Set(['rg-expired', 'rg-recent', 'rg-pending']))
  })
})
