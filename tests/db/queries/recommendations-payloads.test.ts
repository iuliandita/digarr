// @vitest-environment node

import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Database } from '@/db'
import {
  bulkRejectRecommendations,
  listRecommendations,
  listRecommendationsForExport,
} from '@/db/queries/recommendations'
import {
  albumBlocks,
  artistBlocks,
  artists,
  recommendationBatches,
  recommendations,
  users,
} from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

const RG = '33333333-0000-4000-8000-000000000001'

async function seed() {
  const { db: testDb, close } = await makeTestDb()
  const db = testDb as unknown as Database
  const [owner, other] = await db
    .insert(users)
    .values([
      { username: 'bulk-owner', passwordHash: 'x' },
      { username: 'bulk-other', passwordHash: 'x' },
    ])
    .returning()
  const [batch] = await db.insert(recommendationBatches).values({}).returning()
  const catalog = await db
    .insert(artists)
    .values(
      ['a', 'b', 'c', 'd'].map((name, i) => ({
        mbid: `00000000-0000-4000-8000-00000000030${i}`,
        name,
        genres: ['rock'],
        imageUrl: `https://img/${name}`,
        streamingUrls: { spotify: `https://s/${name}` },
        disambiguation: 'dis',
        tags: ['t'],
        topTracks: { tracks: [{ title: 'x' }], fetchedAt: 1 } as never,
        description: { en: 'long text', de: 'langer text' },
        externalLinks: { wiki: 'https://w' },
        cachedAt: new Date(),
      })),
    )
    .returning()
  const [a, b, c, d] = catalog
  if (!owner || !other || !batch || !a || !b || !c || !d) throw new Error('fixture missing')
  const recs = await db
    .insert(recommendations)
    .values([
      { userId: owner.id, artistId: a.id, batchId: batch.id, score: 0.9 },
      { userId: owner.id, artistId: b.id, batchId: batch.id, score: 0.8 },
      {
        userId: owner.id,
        artistId: c.id,
        batchId: batch.id,
        score: 0.7,
        kind: 'album',
        recommendedReleaseGroupId: RG,
        recommendedReleaseGroupTitle: 'Album C',
      },
      // legacy album rec without a release group falls back to an artist block
      { userId: owner.id, artistId: d.id, batchId: batch.id, score: 0.6, kind: 'album' },
      { userId: other.id, artistId: a.id, batchId: batch.id, score: 0.5 },
    ])
    .returning()
  return { db, close, owner, other, artistIds: { a: a.id, b: b.id, c: c.id, d: d.id }, recs }
}

describe('bulkRejectRecommendations', () => {
  it('rejects owned ids and creates artist and album blocks once without overwriting', async () => {
    const { db, close, owner, other, artistIds, recs } = await seed()
    try {
      await db.insert(artistBlocks).values({
        userId: owner.id,
        artistId: artistIds.b,
        source: 'manual',
        reasonText: 'mine',
      })
      const ids = recs.slice(0, 4).map((r) => r.id)
      const params = {
        ids,
        userId: owner.id,
        reason: 'wrong_style' as const,
        reasonText: null,
        permanent: true,
      }
      expect(await bulkRejectRecommendations(db, params)).toEqual({
        rejected: 4,
        blocksCreated: 3,
      })

      for (const r of await db.select().from(recommendations)) {
        const mine = r.userId === owner.id
        expect(r.status === 'rejected').toBe(mine)
        expect(r.rejectionReason).toBe(mine ? 'wrong_style' : null)
      }

      const aBlocks = await db.select().from(artistBlocks)
      expect(aBlocks.map((b) => b.artistId).sort()).toEqual(
        [artistIds.a, artistIds.b, artistIds.d].sort(),
      )
      const kept = aBlocks.find((b) => b.artistId === artistIds.b)
      expect([kept?.reasonText, kept?.source]).toEqual(['mine', 'manual'])
      expect(aBlocks.every((b) => b.userId === owner.id && b.userId !== other.id)).toBe(true)

      const albums = await db.select().from(albumBlocks)
      expect(albums).toHaveLength(1)
      expect(albums[0]).toMatchObject({
        userId: owner.id,
        releaseGroupMbid: RG,
        albumTitle: 'Album C',
        reason: 'wrong_style',
      })

      expect((await bulkRejectRecommendations(db, params)).blocksCreated).toBe(0)
    } finally {
      await close()
    }
  })

  it('leaves other users untouched and skips blocks without permanent', async () => {
    const { db, close, owner, recs } = await seed()
    try {
      const first = recs[0]
      const foreign = recs[4]
      if (!first || !foreign) throw new Error('fixture missing')
      const result = await bulkRejectRecommendations(db, {
        ids: [first.id, foreign.id],
        userId: owner.id,
        reason: 'not_interested',
        reasonText: null,
        permanent: false,
      })
      expect(result).toEqual({ rejected: 1, blocksCreated: 0 })
      const [row] = await db
        .select()
        .from(recommendations)
        .where(eq(recommendations.id, foreign.id))
      expect(row?.status).toBe('pending')
      expect(await db.select().from(artistBlocks)).toHaveLength(0)
      expect(await db.select().from(albumBlocks)).toHaveLength(0)
    } finally {
      await close()
    }
  })
})

describe('recommendation list and export projections', () => {
  it('list keeps every artist field a consumer reads and drops the heavy caches', async () => {
    const { db, close, owner } = await seed()
    try {
      const { items } = await listRecommendations(db, { userId: owner.id })
      expect(items).toHaveLength(4)
      const artist = items[0]?.artist as Record<string, unknown>
      for (const key of [
        'id',
        'mbid',
        'name',
        'disambiguation',
        'genres',
        'tags',
        'imageUrl',
        'logoUrl',
        'streamingUrls',
        'beginYear',
        'endYear',
        'imageFailedAt',
      ]) {
        expect(artist).toHaveProperty(key)
      }
      for (const key of [
        'topTracks',
        'description',
        'externalLinks',
        'wikidataId',
        'cachedAt',
        'genresCachedAt',
      ]) {
        expect(artist).not.toHaveProperty(key)
      }
    } finally {
      await close()
    }
  })

  it('export returns only the written fields with the same filtering and order', async () => {
    const { db, close, owner } = await seed()
    try {
      const rows = await listRecommendationsForExport(db, { userId: owner.id, limit: 10000 })
      expect(rows.map((r) => r.artist.name)).toEqual(['a', 'b', 'c', 'd'])
      expect(Object.keys(rows[0]?.artist ?? {}).sort()).toEqual([
        'genres',
        'imageUrl',
        'mbid',
        'name',
        'streamingUrls',
      ])
      expect(rows[2]?.recommendedReleaseGroupTitle).toBe('Album C')
    } finally {
      await close()
    }
  })
})
