// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { type RecommendationEntry, saveRecommendationChunk } from '@/core/pipeline/store'
import type { Database } from '@/db'
import { bulkUpsert, getPopularityMap } from '@/db/queries/artist-metadata'
import { upsertArtist } from '@/db/queries/artists'
import { insertRecommendation } from '@/db/queries/recommendations'
import * as schema from '@/db/schema'

const client = new PGlite()
const statements: string[] = []
const db = drizzle(client, {
  schema,
  logger: {
    logQuery(query) {
      statements.push(query)
    },
  },
})

const transactions = vi.spyOn(db, 'transaction')

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
}, 120_000)
afterAll(async () => {
  await client.close()
})

it.each([200, 20])(
  'preserves 200 recommendation rows with %i distinct artists using two inserts and one transaction',
  async (artistCount) => {
    const [batch] = await db
      .insert(schema.recommendationBatches)
      .values({ status: 'running' })
      .returning()
    if (!batch) throw new Error('Missing batch')
    const entries: RecommendationEntry[] = Array.from({ length: 200 }, (_, index) => ({
      artist: {
        mbid: `00000000-0000-0000-0000-${String(index % artistCount).padStart(12, '0')}`,
        name: `Artist ${index}`,
        tags: ['rock'],
        genres: ['rock'],
        streamingUrls: {},
        imageUrl: index < artistCount ? 'https://example.com/image.jpg' : undefined,
        imageFailed: index >= artistCount,
        beginYear: index < artistCount ? 1990 : undefined,
      },
      recommendation: {
        batchId: batch.id,
        score: index / 200,
        sources: { similarity: 0.8 },
        status: 'pending',
        kind: 'album',
        recommendedReleaseGroupTitle: `Album ${index}`,
      },
    }))
    async function snapshot() {
      const rows = await db
        .select({ artist: schema.artists, rec: schema.recommendations })
        .from(schema.recommendations)
        .innerJoin(schema.artists, eq(schema.recommendations.artistId, schema.artists.id))
        .orderBy(schema.recommendations.id)
      return rows.map(({ artist, rec }) => ({
        mbid: artist.mbid,
        name: artist.name,
        genres: artist.genres,
        tags: artist.tags,
        image: artist.imageUrl,
        failed: artist.imageFailedAt !== null,
        year: artist.beginYear,
        score: rec.score,
        sources: rec.sources,
        title: rec.recommendedReleaseGroupTitle,
        kind: rec.kind,
      }))
    }
    statements.length = 0
    transactions.mockClear()
    for (const entry of entries) {
      await db.transaction(async (tx) => {
        const artist = await upsertArtist(tx as never, entry.artist)
        await insertRecommendation(tx as never, { ...entry.recommendation, artistId: artist.id })
      })
    }
    expect(statements.filter((q) => q.startsWith('insert into'))).toHaveLength(400)
    expect(transactions).toHaveBeenCalledTimes(200)
    const before = await snapshot()
    await db.delete(schema.recommendations)
    await db.delete(schema.artists)
    statements.length = 0
    transactions.mockClear()
    await saveRecommendationChunk(db as unknown as Database, entries)
    expect(statements.filter((q) => q.startsWith('insert into'))).toHaveLength(2)
    expect(transactions).toHaveBeenCalledOnce()
    expect(await snapshot()).toEqual(before)
    // Repeat against existing rows to exercise conflict updates as well as inserts.
    await saveRecommendationChunk(db as unknown as Database, entries)
    const twice = await snapshot()
    expect(twice.slice(200)).toEqual(before)
    const first = entries[0]
    if (!first) throw new Error('Missing entry')
    await expect(
      saveRecommendationChunk(db as unknown as Database, [
        {
          artist: { ...first.artist, name: 'Must roll back' },
          recommendation: { ...first.recommendation, batchId: -1 },
        },
      ]),
    ).rejects.toThrow()
    expect(await snapshot()).toEqual(twice)
    await db.delete(schema.recommendations)
    await db.delete(schema.artists)
  },
  30_000,
)

it('restricts popularity reads to distinct normalized resolved names', async () => {
  await bulkUpsert(
    db as unknown as Database,
    Array.from({ length: 1000 }, (_, index) => ({
      name: `Artist ${index}`,
      nameNormalized: `artist ${index}`,
      spotifyPopularity: index % 100,
    })),
  )
  await bulkUpsert(db as unknown as Database, [
    { name: 'Unknown', nameNormalized: 'unknown', spotifyPopularity: null },
  ])
  statements.length = 0
  const before = await getPopularityMap(db as unknown as Database)
  const after = await getPopularityMap(db as unknown as Database, [
    ' Artist 0 ',
    'ARTIST 50',
    'artist 50',
    'Unknown',
    'Missing',
  ])
  expect(before.size).toBe(1000)
  expect(after).toEqual(
    new Map([
      ['artist 0', 0],
      ['artist 50', 0.5],
    ]),
  )
  expect(after.get('unknown')).toBe(before.get('unknown'))
  expect(after.get('missing')).toBeUndefined()
  expect(statements).toHaveLength(2)
  expect(statements[1]).toContain(' in ')
  expect(await getPopularityMap(db as unknown as Database, [])).toEqual(new Map())
  expect(statements).toHaveLength(2)
})
