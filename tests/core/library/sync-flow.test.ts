// @vitest-environment node

import { eq, or } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibrarySource } from '@/core/library/sources/types'
import { createLibrarySyncStore } from '@/core/library/store'
import { createSyncOrchestrator } from '@/core/library/sync'

const RADIOHEAD_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
const PORTISHEAD_MBID = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11'
const LIDARR_SOURCE_ID = 'lidarr-sync-flow'
const PLEX_SOURCE_ID = 'plex-sync-flow'
const GLOBAL_ANCHOR_NAME = 'Digarr Sync Flow Anchor'
const EXACT_MATCH_NAME = 'Digarr Sync Flow Exact'
const SHOULD_RUN =
  process.env.DATABASE_URL !== undefined ||
  (process.env.DB_HOST !== undefined &&
    process.env.DB_USER !== undefined &&
    process.env.DB_NAME !== undefined)
let db: import('@/db').Database
let libraryAlbums: typeof import('@/db/schema').libraryAlbums
let libraryArtists: typeof import('@/db/schema').libraryArtists
let librarySyncState: typeof import('@/db/schema').librarySyncState
let users: typeof import('@/db/schema').users

if (SHOULD_RUN) {
  ;({ db } = await import('@/db'))
  ;({ libraryAlbums, libraryArtists, librarySyncState, users } = await import('@/db/schema'))
}

const mbClient = {
  searchArtist: vi.fn(async (query: string) => {
    if (query === 'digarr sync flow anchor') {
      return { artists: [{ id: RADIOHEAD_MBID, name: GLOBAL_ANCHOR_NAME, score: 100 }] }
    }
    if (query === 'digarr sync flow exact') {
      return { artists: [{ id: PORTISHEAD_MBID, name: EXACT_MATCH_NAME, score: 100 }] }
    }
    return { artists: [] }
  }),
  getReleaseGroups: vi.fn(async () => []),
}

const recorder = {
  start: vi.fn(async () => 1),
  complete: vi.fn(async () => {}),
  fail: vi.fn(async () => {}),
  markStuck: vi.fn(async () => 0),
}

let userId: number

function makeSource(
  id: string,
  userIdForSource: number | null,
  mbidQuality: 'high' | 'low',
  artists: Array<{ sourceArtistId: string; name: string; mbid?: string }>,
): LibrarySource {
  return {
    id,
    name: id,
    capabilities: ['listArtists'],
    userId: userIdForSource,
    mbidQuality,
    listArtists: vi.fn(async () => artists),
    testConnection: async () => ({ success: true, message: 'ok' }),
  }
}

beforeEach(async () => {
  await db
    .delete(libraryArtists)
    .where(
      or(eq(libraryArtists.source, LIDARR_SOURCE_ID), eq(libraryArtists.source, PLEX_SOURCE_ID)),
    )
  await db
    .delete(libraryAlbums)
    .where(or(eq(libraryAlbums.source, LIDARR_SOURCE_ID), eq(libraryAlbums.source, PLEX_SOURCE_ID)))
  await db
    .delete(librarySyncState)
    .where(
      or(
        eq(librarySyncState.source, LIDARR_SOURCE_ID),
        eq(librarySyncState.source, PLEX_SOURCE_ID),
      ),
    )
  await db.delete(users).where(eq(users.username, 'sync-flow-test'))
  const inserted = await db
    .insert(users)
    .values({ username: 'sync-flow-test', passwordHash: 'x' })
    .returning({ id: users.id })
  if (!inserted[0]) throw new Error('seed failed')
  userId = inserted[0].id
  vi.clearAllMocks()
})

afterEach(async () => {
  await db
    .delete(libraryArtists)
    .where(
      or(eq(libraryArtists.source, LIDARR_SOURCE_ID), eq(libraryArtists.source, PLEX_SOURCE_ID)),
    )
  await db
    .delete(libraryAlbums)
    .where(or(eq(libraryAlbums.source, LIDARR_SOURCE_ID), eq(libraryAlbums.source, PLEX_SOURCE_ID)))
  await db
    .delete(librarySyncState)
    .where(
      or(
        eq(librarySyncState.source, LIDARR_SOURCE_ID),
        eq(librarySyncState.source, PLEX_SOURCE_ID),
      ),
    )
  await db.delete(users).where(eq(users.id, userId))
})

describe.skipIf(!SHOULD_RUN)('library sync flow integration', () => {
  it('syncs global Lidarr and per-user Plex end-to-end into library_artists', async () => {
    const store = createLibrarySyncStore(db)
    const lidarr = makeSource(LIDARR_SOURCE_ID, null, 'high', [
      { sourceArtistId: '1', name: GLOBAL_ANCHOR_NAME, mbid: RADIOHEAD_MBID },
    ])
    const plex = makeSource(PLEX_SOURCE_ID, userId, 'low', [
      { sourceArtistId: 'rk-1', name: EXACT_MATCH_NAME },
    ])

    const orchestrator = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [plex],
      buildGlobalSources: async () => [lidarr],
      staleHours: 6,
    })

    await orchestrator.syncGlobal({ force: true })
    await orchestrator.syncForUser(userId, { force: true })

    const rows = await db.select().from(libraryArtists)
    const lidarrRow = rows.find((row) => row.source === LIDARR_SOURCE_ID)
    const plexRow = rows.find((row) => row.source === PLEX_SOURCE_ID)

    expect(lidarrRow?.userId).toBeNull()
    expect(lidarrRow?.mbid).toBe(RADIOHEAD_MBID)
    expect(plexRow?.userId).toBe(userId)
    expect(plexRow?.mbid).toBe(PORTISHEAD_MBID)
    expect(plexRow?.matchMethod).toBe('name_exact')
  })

  it('uses the cache short-circuit for Plex after Lidarr seeded the same artist', async () => {
    const store = createLibrarySyncStore(db)
    const lidarr = makeSource(LIDARR_SOURCE_ID, null, 'high', [
      { sourceArtistId: '1', name: GLOBAL_ANCHOR_NAME, mbid: RADIOHEAD_MBID },
    ])
    const plex = makeSource(PLEX_SOURCE_ID, userId, 'low', [
      { sourceArtistId: 'rk-1', name: GLOBAL_ANCHOR_NAME },
    ])

    const orchestrator = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [plex],
      buildGlobalSources: async () => [lidarr],
      staleHours: 6,
    })

    await orchestrator.syncGlobal({ force: true })
    mbClient.searchArtist.mockClear()
    const summary = await orchestrator.syncForUser(userId, { force: true })

    const plexRows = await db
      .select()
      .from(libraryArtists)
      .where(eq(libraryArtists.source, PLEX_SOURCE_ID))

    expect(plexRows[0]?.matchMethod).toBe('name_anchored')
    expect(summary.results[0]?.status).toBe('completed')
    if (summary.results[0]?.status !== 'completed') {
      throw new Error('expected completed sync result')
    }
    expect(summary.results[0].counts.cacheHits).toBe(1)
    expect(summary.results[0].counts.mbApiCalls).toBe(0)
    expect(mbClient.searchArtist).not.toHaveBeenCalled()
  })

  it('writes library_albums rows for matched artists during sync', async () => {
    const store = createLibrarySyncStore(db)
    const lidarr = {
      id: LIDARR_SOURCE_ID,
      name: 'lidarr',
      capabilities: ['listArtists', 'listAlbums'],
      userId: null,
      mbidQuality: 'high' as const,
      listArtists: vi.fn(async () => [
        { sourceArtistId: '1', name: 'Radiohead', mbid: RADIOHEAD_MBID },
      ]),
      listAlbums: vi.fn(async () => [
        { sourceAlbumId: 'alb-1', sourceArtistId: '1', title: 'OK Computer' },
      ]),
      testConnection: async () => ({ success: true, message: 'ok' }),
    } satisfies LibrarySource

    const orchestrator = createSyncOrchestrator({
      store,
      recorder,
      mbClient: {
        ...mbClient,
        getReleaseGroups: vi.fn(async () => [
          {
            id: '11111111-1111-1111-1111-111111111111',
            title: 'OK Computer',
            type: 'Album',
            firstReleaseDate: '1997-06-16',
          },
        ]),
      },
      buildPerUserSources: async () => [],
      buildGlobalSources: async () => [lidarr],
      staleHours: 6,
    })

    await orchestrator.syncGlobal({ force: true })

    const rows = await db
      .select()
      .from(libraryAlbums)
      .where(eq(libraryAlbums.source, LIDARR_SOURCE_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('OK Computer')
    expect(rows[0]?.albumMbid).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('does not leave artist rows behind when album sync fails', async () => {
    const store = createLibrarySyncStore(db)
    const lidarr = {
      id: LIDARR_SOURCE_ID,
      name: 'lidarr',
      capabilities: ['listArtists', 'listAlbums'],
      userId: null,
      mbidQuality: 'high' as const,
      listArtists: vi.fn(async () => [
        { sourceArtistId: '1', name: 'Radiohead', mbid: RADIOHEAD_MBID },
      ]),
      listAlbums: vi.fn(async () => {
        throw new Error('album boom')
      }),
      testConnection: async () => ({ success: true, message: 'ok' }),
    } satisfies LibrarySource

    const orchestrator = createSyncOrchestrator({
      store,
      recorder,
      mbClient,
      buildPerUserSources: async () => [],
      buildGlobalSources: async () => [lidarr],
      staleHours: 6,
    })

    const summary = await orchestrator.syncGlobal({ force: true })

    expect(summary.results[0]?.status).toBe('failed')
    const artistRows = await db
      .select()
      .from(libraryArtists)
      .where(eq(libraryArtists.source, LIDARR_SOURCE_ID))
    expect(artistRows).toHaveLength(0)
  })
})
