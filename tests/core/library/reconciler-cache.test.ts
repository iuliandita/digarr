// @vitest-environment node

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReconcilerContext, reconcileArtist } from '@/core/library/reconciler'
import { createLibrarySyncStore } from '@/core/library/store'

let userId: number
const SHOULD_RUN =
  process.env.DATABASE_URL !== undefined ||
  (process.env.DB_HOST !== undefined &&
    process.env.DB_USER !== undefined &&
    process.env.DB_NAME !== undefined)
let db: import('@/db').Database
let users: typeof import('@/db/schema').users

if (SHOULD_RUN) {
  ;({ db } = await import('@/db'))
  ;({ users } = await import('@/db/schema'))
}

beforeEach(async () => {
  await db.delete(users).where(eq(users.username, 'cache-perf-test'))
  const inserted = await db
    .insert(users)
    .values({ username: 'cache-perf-test', passwordHash: 'x' })
    .returning({ id: users.id })
  if (!inserted[0]) throw new Error('seed failed')
  userId = inserted[0].id
})

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId))
})

describe.skipIf(!SHOULD_RUN)('reconciler cache short-circuit performance', () => {
  it('warm cache yields cache hits without MB API calls', async () => {
    const store = createLibrarySyncStore(db)
    const names = Array.from({ length: 100 }, (_, i) => {
      const first = String.fromCharCode(65 + Math.floor(i / 26))
      const second = String.fromCharCode(65 + (i % 26))
      return `Artist ${first}${second}`
    })
    const seed = names.map((name, i) => ({
      sourceArtistId: `seed-${i}`,
      name,
      nameNormalized: name.toLowerCase(),
      mbid: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      matchMethod: 'mbid' as const,
      matchConfidence: 1.0,
      genres: [],
      unreconciledReason: undefined,
    }))

    await store.replaceLibraryArtists(userId, 'lidarr', seed)

    const mbSearch = vi.fn(async () => ({ artists: [] }))
    const ctx: ReconcilerContext = {
      userId,
      overrides: new Map(),
      knownMbids: await store.getKnownMbidsForUser(userId),
      mbClient: {
        searchArtist: mbSearch,
        getReleaseGroups: vi.fn(async () => []),
      },
      cacheLookup: (nameNormalized) => store.findReconciledByNormalizedName(userId, nameNormalized),
      counts: {
        total: 0,
        matchedMbid: 0,
        matchedNameExact: 0,
        matchedNameAnchored: 0,
        matchedDisambiguated: 0,
        unreconciledAmbiguous: 0,
        unreconciledNoCandidate: 0,
        cacheHits: 0,
        mbApiCalls: 0,
      },
    }

    for (const [i, name] of names.entries()) {
      await reconcileArtist({ sourceArtistId: `plex-${i}`, name }, 'plex', ctx)
    }

    expect(ctx.counts.cacheHits).toBe(100)
    expect(ctx.counts.mbApiCalls).toBe(0)
    expect(mbSearch).not.toHaveBeenCalled()
  })
})
