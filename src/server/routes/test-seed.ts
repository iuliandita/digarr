import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { artists, recommendationBatches, recommendations } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { notAuthenticated } from '@/server/helpers/auth-problems'
import type { HonoEnv } from '@/server/types'

// Fixed, deterministic seed set. UUIDs are stable so re-seeding upserts the same
// artist rows instead of accumulating duplicates. Each artist carries a cached
// Wikidata enrichment (description + externalLinks + wikidataId + a fresh
// wikidataFetchedAt) so the enrichment endpoint serves the bio from cache with
// no live upstream call, keeping the metadata-enrichment E2E deterministic.
const SEED_ARTISTS = [
  {
    mbid: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Seed Artist Alpha',
    genres: ['indie rock', 'art rock'],
    score: 0.92,
    wikidataId: 'Q100000001',
    description: 'Seed Artist Alpha is a fictional indie rock act used by the E2E harness.',
    streamingUrls: { spotify: 'https://open.spotify.com/artist/seed-alpha' },
    externalLinks: {
      wikipedia: 'https://en.wikipedia.org/wiki/Seed_Artist_Alpha',
      officialSite: 'https://example.com/seed-alpha',
      discogs: 'https://www.discogs.com/artist/seed-alpha',
    },
  },
  {
    mbid: 'aaaaaaaa-0000-4000-8000-000000000002',
    name: 'Seed Artist Bravo',
    genres: ['synthpop'],
    score: 0.81,
    wikidataId: 'Q100000002',
    description: 'Seed Artist Bravo is a fictional synthpop act used by the E2E harness.',
    streamingUrls: { spotify: 'https://open.spotify.com/artist/seed-bravo' },
    externalLinks: {
      wikipedia: 'https://en.wikipedia.org/wiki/Seed_Artist_Bravo',
    },
  },
  {
    mbid: 'aaaaaaaa-0000-4000-8000-000000000003',
    name: 'Seed Artist Charlie',
    genres: ['folk'],
    score: 0.74,
    wikidataId: 'Q100000003',
    description: 'Seed Artist Charlie is a fictional folk act used by the E2E harness.',
    streamingUrls: { spotify: 'https://open.spotify.com/artist/seed-charlie' },
    externalLinks: {
      wikipedia: 'https://en.wikipedia.org/wiki/Seed_Artist_Charlie',
    },
  },
] as const

/**
 * Test-only routes. Registered by `createApp` ONLY when `NODE_ENV === 'test'`.
 * The production Docker image sets `NODE_ENV=production` before `bun run build`,
 * so Bun inlines that guard to `false` and tree-shakes this whole module out of
 * the bundle: the seed endpoint cannot exist in a production build.
 */
export function testSeedRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  // Seed a fixed set of pending recommendations (and their artists) for the
  // authenticated user so browser tests have something to approve/reject.
  router.post('/api/v1/test/seed-recommendations', async (c) => {
    const userId = c.get('userId')
    if (typeof userId !== 'number') return notAuthenticated(c)

    const db = deps.db
    const now = new Date()

    const artistIds: number[] = []
    for (const seed of SEED_ARTISTS) {
      const [row] = await db
        .insert(artists)
        .values({
          mbid: seed.mbid,
          name: seed.name,
          tags: [...seed.genres],
          genres: [...seed.genres],
          streamingUrls: seed.streamingUrls,
          description: { en: seed.description },
          externalLinks: seed.externalLinks,
          wikidataId: seed.wikidataId,
          wikidataFetchedAt: now,
          cachedAt: now,
        })
        .onConflictDoUpdate({
          target: artists.mbid,
          set: {
            name: seed.name,
            description: { en: seed.description },
            externalLinks: seed.externalLinks,
            wikidataId: seed.wikidataId,
            wikidataFetchedAt: now,
            cachedAt: now,
          },
        })
        .returning({ id: artists.id })
      if (row) artistIds.push(row.id)
    }

    // Clear any prior seeded recommendations for this user so repeated seed
    // calls leave a known, duplicate-free state.
    if (artistIds.length > 0) {
      await db
        .delete(recommendations)
        .where(
          and(eq(recommendations.userId, userId), inArray(recommendations.artistId, artistIds)),
        )
    }

    const [batch] = await db
      .insert(recommendationBatches)
      .values({
        status: 'completed',
        stats: { discovered: SEED_ARTISTS.length, added: SEED_ARTISTS.length, failed: 0 },
      })
      .returning({ id: recommendationBatches.id })

    if (!batch) throw new Error('seed-recommendations: failed to create batch')

    for (let i = 0; i < artistIds.length; i++) {
      const seed = SEED_ARTISTS[i]
      const artistId = artistIds[i]
      if (!seed || artistId === undefined) continue
      await db.insert(recommendations).values({
        userId,
        artistId,
        batchId: batch.id,
        score: seed.score,
        sources: { similarity: seed.score, consensus: seed.score },
        status: 'pending',
      })
    }

    return c.json({
      batchId: batch.id,
      seeded: artistIds.length,
      artists: SEED_ARTISTS.map((s, i) => ({ id: artistIds[i], mbid: s.mbid, name: s.name })),
    })
  })

  return router
}
