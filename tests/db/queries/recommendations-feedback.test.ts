import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '@/db'
import { getGenreFeedbackHistory } from '@/db/queries/recommendations'
import { artists, recommendationBatches, recommendations, users } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

describe('genre feedback counts on migrated PGlite', () => {
  let fixture: Awaited<ReturnType<typeof makeTestDb>>

  beforeAll(async () => {
    fixture = await makeTestDb()
    const { db } = fixture
    await db.insert(users).values([
      { id: 1, username: 'feedback-one', passwordHash: 'test' },
      { id: 2, username: 'feedback-two', passwordHash: 'test' },
    ])
    const [batch] = await db.insert(recommendationBatches).values({}).returning()
    if (!batch) throw new Error('Missing feedback batch fixture')
    const actedOnAt = new Date('2026-01-01T00:00:00Z')
    for (const userId of [1, 2, null]) {
      const [artist] = await db
        .insert(artists)
        .values({
          mbid: `00000000-0000-0000-0000-${String(userId ?? 3).padStart(12, '0')}`,
          name: `Feedback owner ${userId}`,
          genres: ['shared', `owner-${userId}`],
        })
        .returning()
      if (!artist) throw new Error('Missing feedback artist fixture')
      await db.insert(recommendations).values(
        [
          { status: 'approved', rejectionReason: null, actedOnAt },
          { status: 'added_to_lidarr', rejectionReason: null, actedOnAt },
          { status: 'rejected', rejectionReason: 'wrong_style', actedOnAt },
          { status: 'rejected', rejectionReason: 'tried_didnt_like', actedOnAt },
          { status: 'rejected', rejectionReason: null, actedOnAt },
          { status: 'add_failed', rejectionReason: 'wrong_style', actedOnAt },
          { status: 'pending', rejectionReason: 'tried_didnt_like', actedOnAt },
          { status: 'pending', rejectionReason: null, actedOnAt: null },
          { status: 'rejected', rejectionReason: 'wrong_style', actedOnAt: null },
        ].map((row) => ({ ...row, userId, artistId: artist.id, batchId: batch.id, score: 0.8 })),
      )
    }
  }, 30_000)

  afterAll(async () => {
    await fixture?.close()
  })

  it.each([1, 2, undefined])(
    'counts only explicit rejections and preserves acted-on ownership for user %s',
    async (userId) => {
      const result = await getGenreFeedbackHistory(fixture.db as unknown as Database, userId)
      const tally = { approved: 2, rejected: 3, total: 7, strongNegative: 2 }
      const expected = new Map([['shared', tally]])
      if (userId === undefined) {
        expected.set('shared', { approved: 6, rejected: 9, total: 21, strongNegative: 6 })
        for (const owner of [1, 2, null]) expected.set(`owner-${owner}`, tally)
      } else {
        expected.set(`owner-${userId}`, tally)
      }
      expect(result).toEqual(expected)
    },
  )
})
