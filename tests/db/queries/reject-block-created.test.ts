// @vitest-environment node

import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dbSuiteEnabled, failIfDbRequired } from '../../helpers/require-db'

const SHOULD_RUN = dbSuiteEnabled()
let db: import('@/db').Database
let schema: typeof import('@/db/schema')
let rejectRecommendation: typeof import('@/db/queries/recommendations').rejectRecommendation

if (SHOULD_RUN) {
  ;({ db } = await import('@/db'))
  schema = await import('@/db/schema')
  ;({ rejectRecommendation } = await import('@/db/queries/recommendations'))
}

describe.skipIf(!SHOULD_RUN)('rejectRecommendation blockCreated (DB)', () => {
  const mbids = ['11111111-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-0000000000a2']
  const rgMbid = '22222222-0000-4000-8000-0000000000b1'
  let userId = 0
  let artistIds: number[] = []
  let batchId = 0

  beforeAll(async () => {
    try {
      await db.delete(schema.users).where(eq(schema.users.username, 'reject-block-test'))
      await db.delete(schema.artists).where(inArray(schema.artists.mbid, mbids))
    } catch (err) {
      failIfDbRequired(err)
      throw err
    }
    const [user] = await db
      .insert(schema.users)
      .values({ username: 'reject-block-test', passwordHash: 'x' })
      .returning({ id: schema.users.id })
    userId = user?.id ?? 0
    const rows = await db
      .insert(schema.artists)
      .values(mbids.map((mbid, i) => ({ mbid, name: `Reject Block ${i}` })))
      .returning({ id: schema.artists.id })
    artistIds = rows.map((r) => r.id)
    const [batch] = await db
      .insert(schema.recommendationBatches)
      .values({})
      .returning({ id: schema.recommendationBatches.id })
    batchId = batch?.id ?? 0
  })

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId))
    await db.delete(schema.recommendations).where(eq(schema.recommendations.batchId, batchId))
    await db
      .delete(schema.recommendationBatches)
      .where(eq(schema.recommendationBatches.id, batchId))
    await db.delete(schema.artists).where(inArray(schema.artists.id, artistIds))
  })

  async function insertRec(artistId: number, album = false) {
    const [rec] = await db
      .insert(schema.recommendations)
      .values({
        userId,
        artistId,
        batchId,
        score: 0.5,
        kind: album ? 'album' : 'artist',
        recommendedReleaseGroupId: album ? rgMbid : null,
        recommendedReleaseGroupTitle: album ? 'Blocked Album' : null,
      })
      .returning({ id: schema.recommendations.id })
    return rec?.id ?? 0
  }

  const reject = (recommendationId: number) =>
    rejectRecommendation(db, {
      recommendationId,
      userId,
      reason: null,
      reasonText: null,
      permanent: true,
    })

  it('reports a new artist block, and an existing one as not created', async () => {
    const [first = 0, second = 0] = artistIds
    expect(await reject(await insertRec(first))).toEqual({ artistId: first, blockCreated: true })

    await db
      .insert(schema.artistBlocks)
      .values({ userId, artistId: second, source: 'manual', reasonText: 'my own block' })
    expect(await reject(await insertRec(second))).toEqual({
      artistId: second,
      blockCreated: false,
    })
    const [kept] = await db
      .select({ reasonText: schema.artistBlocks.reasonText })
      .from(schema.artistBlocks)
      .where(and(eq(schema.artistBlocks.userId, userId), eq(schema.artistBlocks.artistId, second)))
    expect(kept?.reasonText).toBe('my own block')
  })

  it('reports album blocks the same way and stores the album title', async () => {
    const artistId = artistIds[0] ?? 0
    expect((await reject(await insertRec(artistId, true)))?.blockCreated).toBe(true)
    expect((await reject(await insertRec(artistId, true)))?.blockCreated).toBe(false)
    const [block] = await db
      .select({ albumTitle: schema.albumBlocks.albumTitle })
      .from(schema.albumBlocks)
      .where(
        and(eq(schema.albumBlocks.userId, userId), eq(schema.albumBlocks.releaseGroupMbid, rgMbid)),
      )
    expect(block?.albumTitle).toBe('Blocked Album')
  })
})
