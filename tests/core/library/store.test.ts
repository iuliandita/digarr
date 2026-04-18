// @vitest-environment node

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReconciledAlbum } from '@/core/library/album-reconciler'
import type { ReconciledArtist } from '@/core/library/reconciler'
import { createLibrarySyncStore } from '@/core/library/store'

const TEST_USER = { username: 'libstore-test-user', passwordHash: 'x' }
const LIDARR_SOURCE = 'lidarr-store-test'
const PLEX_SOURCE = 'plex-store-test'
const JELLYFIN_SOURCE = 'jellyfin-store-test'
const SHOULD_RUN =
  process.env.DATABASE_URL !== undefined ||
  (process.env.DB_HOST !== undefined &&
    process.env.DB_USER !== undefined &&
    process.env.DB_NAME !== undefined)
let db: import('@/db').Database
let libraryAlbums: typeof import('@/db/schema').libraryAlbums
let libraryAlbumMatchOverrides: typeof import('@/db/schema').libraryAlbumMatchOverrides
let libraryArtists: typeof import('@/db/schema').libraryArtists
let libraryMatchOverrides: typeof import('@/db/schema').libraryMatchOverrides
let librarySyncState: typeof import('@/db/schema').librarySyncState
let users: typeof import('@/db/schema').users

if (SHOULD_RUN) {
  ;({ db } = await import('@/db'))
  ;({
    libraryAlbums,
    libraryAlbumMatchOverrides,
    libraryArtists,
    libraryMatchOverrides,
    librarySyncState,
    users,
  } = await import('@/db/schema'))
}

let userId: number

beforeEach(async () => {
  await db.delete(libraryAlbums).where(eq(libraryAlbums.source, LIDARR_SOURCE))
  await db.delete(libraryAlbums).where(eq(libraryAlbums.source, PLEX_SOURCE))
  await db.delete(libraryAlbums).where(eq(libraryAlbums.source, JELLYFIN_SOURCE))
  await db.delete(libraryArtists).where(eq(libraryArtists.source, LIDARR_SOURCE))
  await db.delete(libraryArtists).where(eq(libraryArtists.source, PLEX_SOURCE))
  await db.delete(libraryArtists).where(eq(libraryArtists.source, JELLYFIN_SOURCE))
  await db
    .delete(libraryAlbumMatchOverrides)
    .where(eq(libraryAlbumMatchOverrides.source, PLEX_SOURCE))
  await db.delete(librarySyncState).where(eq(librarySyncState.source, LIDARR_SOURCE))
  await db.delete(librarySyncState).where(eq(librarySyncState.source, PLEX_SOURCE))
  await db.delete(librarySyncState).where(eq(librarySyncState.source, JELLYFIN_SOURCE))
  await db.delete(libraryMatchOverrides).where(eq(libraryMatchOverrides.source, PLEX_SOURCE))
  await db.delete(users).where(eq(users.username, TEST_USER.username))
  const inserted = await db.insert(users).values(TEST_USER).returning({ id: users.id })
  if (!inserted[0]) throw new Error('failed to seed user')
  userId = inserted[0].id
})

afterEach(async () => {
  await db.delete(libraryAlbums).where(eq(libraryAlbums.source, LIDARR_SOURCE))
  await db.delete(libraryAlbums).where(eq(libraryAlbums.source, PLEX_SOURCE))
  await db.delete(libraryAlbums).where(eq(libraryAlbums.source, JELLYFIN_SOURCE))
  await db.delete(libraryArtists).where(eq(libraryArtists.source, LIDARR_SOURCE))
  await db.delete(libraryArtists).where(eq(libraryArtists.source, PLEX_SOURCE))
  await db.delete(libraryArtists).where(eq(libraryArtists.source, JELLYFIN_SOURCE))
  await db
    .delete(libraryAlbumMatchOverrides)
    .where(eq(libraryAlbumMatchOverrides.source, PLEX_SOURCE))
  await db.delete(librarySyncState).where(eq(librarySyncState.source, LIDARR_SOURCE))
  await db.delete(librarySyncState).where(eq(librarySyncState.source, PLEX_SOURCE))
  await db.delete(librarySyncState).where(eq(librarySyncState.source, JELLYFIN_SOURCE))
  await db.delete(libraryMatchOverrides).where(eq(libraryMatchOverrides.source, PLEX_SOURCE))
  await db.delete(users).where(eq(users.id, userId))
})

function reconciled(
  opts: Partial<ReconciledArtist> & { sourceArtistId: string; name: string },
): ReconciledArtist {
  return {
    sourceArtistId: opts.sourceArtistId,
    name: opts.name,
    nameNormalized: opts.nameNormalized ?? opts.name.toLowerCase(),
    mbid: opts.mbid ?? null,
    matchMethod: opts.matchMethod ?? null,
    matchConfidence: opts.matchConfidence ?? null,
    genres: opts.genres ?? [],
    unreconciledReason: opts.unreconciledReason,
  }
}

function reconciledAlbum(
  overrides: Partial<ReconciledAlbum> & {
    sourceAlbumId: string
    sourceArtistId: string
    title: string
    artistMbid: string
  },
): ReconciledAlbum {
  return {
    sourceAlbumId: overrides.sourceAlbumId,
    sourceArtistId: overrides.sourceArtistId,
    title: overrides.title,
    titleNormalized: overrides.titleNormalized ?? overrides.title.toLowerCase(),
    albumMbid: overrides.albumMbid ?? null,
    artistMbid: overrides.artistMbid,
    releaseYear: overrides.releaseYear ?? null,
    primaryType: overrides.primaryType ?? 'Album',
    matchMethod: overrides.matchMethod ?? null,
    matchConfidence: overrides.matchConfidence ?? null,
  }
}

describe.skipIf(!SHOULD_RUN)('LibrarySyncStore', () => {
  it('replaceLibraryArtists writes rows and reports counts', async () => {
    const store = createLibrarySyncStore(db)
    const counts = await store.replaceLibraryArtists(userId, PLEX_SOURCE, [
      reconciled({
        sourceArtistId: 'rk-1',
        name: 'Bush',
        mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        matchMethod: 'mbid',
        matchConfidence: 1.0,
      }),
      reconciled({
        sourceArtistId: 'rk-2',
        name: 'NoMatch',
        unreconciledReason: 'no_candidate',
      }),
    ])

    expect(counts.total).toBe(2)
    expect(counts.matchedMbid).toBe(1)
    expect(counts.unreconciledNoCandidate).toBe(1)

    const rows = await db.select().from(libraryArtists).where(eq(libraryArtists.userId, userId))
    expect(rows).toHaveLength(2)
  })

  it('replaceLibraryArtists is truncate-and-replace per source/user', async () => {
    const store = createLibrarySyncStore(db)
    await store.replaceLibraryArtists(userId, PLEX_SOURCE, [
      reconciled({ sourceArtistId: 'rk-1', name: 'Bush' }),
    ])
    await store.replaceLibraryArtists(userId, PLEX_SOURCE, [
      reconciled({ sourceArtistId: 'rk-2', name: 'Radiohead' }),
    ])
    const rows = await db.select().from(libraryArtists).where(eq(libraryArtists.userId, userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.sourceArtistId).toBe('rk-2')
  })

  it('replaceLibraryArtists for source A does not touch source B', async () => {
    const store = createLibrarySyncStore(db)
    await store.replaceLibraryArtists(userId, PLEX_SOURCE, [
      reconciled({ sourceArtistId: 'rk-1', name: 'Bush' }),
    ])
    await store.replaceLibraryArtists(userId, JELLYFIN_SOURCE, [
      reconciled({ sourceArtistId: 'jf-1', name: 'Radiohead' }),
    ])
    await store.replaceLibraryArtists(userId, PLEX_SOURCE, [
      reconciled({ sourceArtistId: 'rk-3', name: 'Portishead' }),
    ])
    const rows = await db.select().from(libraryArtists).where(eq(libraryArtists.userId, userId))
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.source).sort()).toEqual([JELLYFIN_SOURCE, PLEX_SOURCE])
  })

  it('replaceLibraryAlbums writes rows and returns total count', async () => {
    const store = createLibrarySyncStore(db)
    const result = await store.replaceLibraryAlbums(userId, PLEX_SOURCE, [
      reconciledAlbum({
        sourceAlbumId: 'alb-1',
        sourceArtistId: 'rk-1',
        title: 'Dummy',
        artistMbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        albumMbid: '11111111-1111-1111-1111-111111111111',
        matchMethod: 'title_exact',
        matchConfidence: 0.8,
      }),
    ])

    expect(result.total).toBe(1)
    const rows = await db.select().from(libraryAlbums).where(eq(libraryAlbums.userId, userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Dummy')
    expect(rows[0]?.albumMbid).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('replaceLibraryAlbums is truncate-and-replace per source/user', async () => {
    const store = createLibrarySyncStore(db)
    await store.replaceLibraryAlbums(userId, PLEX_SOURCE, [
      reconciledAlbum({
        sourceAlbumId: 'alb-1',
        sourceArtistId: 'rk-1',
        title: 'Dummy',
        artistMbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
      }),
    ])
    await store.replaceLibraryAlbums(userId, PLEX_SOURCE, [
      reconciledAlbum({
        sourceAlbumId: 'alb-2',
        sourceArtistId: 'rk-2',
        title: 'Dummy 2',
        artistMbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
      }),
    ])

    const rows = await db.select().from(libraryAlbums).where(eq(libraryAlbums.userId, userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.sourceAlbumId).toBe('alb-2')
  })

  it('replaceLibrarySnapshot rolls back artist and album writes on persistence failure', async () => {
    const store = createLibrarySyncStore(db)
    await store.replaceLibraryArtists(userId, PLEX_SOURCE, [
      reconciled({
        sourceArtistId: 'rk-seed',
        name: 'Seed Artist',
        mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
      }),
    ])
    await store.replaceLibraryAlbums(userId, PLEX_SOURCE, [
      reconciledAlbum({
        sourceAlbumId: 'alb-seed',
        sourceArtistId: 'rk-seed',
        title: 'Seed Album',
        artistMbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
      }),
    ])

    await expect(
      store.replaceLibrarySnapshot(
        userId,
        PLEX_SOURCE,
        [
          reconciled({
            sourceArtistId: 'rk-1',
            name: 'Radiohead',
            mbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
            matchMethod: 'mbid',
          }),
        ],
        [
          reconciledAlbum({
            sourceAlbumId: 'alb-1',
            sourceArtistId: 'rk-1',
            title: 'OK Computer',
            artistMbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
          }),
          reconciledAlbum({
            sourceAlbumId: 'alb-1',
            sourceArtistId: 'rk-1',
            title: 'OK Computer (duplicate)',
            artistMbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
          }),
        ],
      ),
    ).rejects.toThrow()

    const artists = await db.select().from(libraryArtists).where(eq(libraryArtists.userId, userId))
    const albums = await db.select().from(libraryAlbums).where(eq(libraryAlbums.userId, userId))
    expect(artists).toHaveLength(1)
    expect(artists[0]?.sourceArtistId).toBe('rk-seed')
    expect(albums).toHaveLength(1)
    expect(albums[0]?.sourceAlbumId).toBe('alb-seed')
  })

  it('findReconciledByNormalizedName returns rows scoped to user + global', async () => {
    const store = createLibrarySyncStore(db)
    // Global Lidarr row (userId = null)
    await store.replaceLibraryArtists(null, LIDARR_SOURCE, [
      reconciled({
        sourceArtistId: '1',
        name: 'Bush',
        nameNormalized: 'bush',
        mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        matchMethod: 'mbid',
      }),
    ])
    // Per-user Plex row
    await store.replaceLibraryArtists(userId, PLEX_SOURCE, [
      reconciled({
        sourceArtistId: 'rk-1',
        name: 'Radiohead',
        nameNormalized: 'radiohead',
        mbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
        matchMethod: 'mbid',
      }),
    ])

    const bushHits = await store.findReconciledByNormalizedName(userId, 'bush')
    expect(bushHits).toHaveLength(1)
    expect(bushHits[0]?.source).toBe(LIDARR_SOURCE)

    const radioheadHits = await store.findReconciledByNormalizedName(userId, 'radiohead')
    expect(radioheadHits).toHaveLength(1)
    expect(radioheadHits[0]?.source).toBe(PLEX_SOURCE)
  })

  it('findReconciledByNormalizedName excludes rows with null mbid', async () => {
    const store = createLibrarySyncStore(db)
    await store.replaceLibraryArtists(userId, PLEX_SOURCE, [
      reconciled({
        sourceArtistId: 'rk-1',
        name: 'Bush',
        nameNormalized: 'bush',
        unreconciledReason: 'no_candidate',
      }),
    ])
    const hits = await store.findReconciledByNormalizedName(userId, 'bush')
    expect(hits).toHaveLength(0)
  })

  it('upsert/get sync state round-trips', async () => {
    const store = createLibrarySyncStore(db)
    await store.upsertLibrarySyncState(userId, PLEX_SOURCE, {
      lastSyncStartedAt: new Date('2026-04-06T12:00:00Z'),
      lastSyncStatus: 'running',
    })
    const state = await store.getLibrarySyncState(userId, PLEX_SOURCE)
    expect(state?.lastSyncStatus).toBe('running')

    await store.upsertLibrarySyncState(userId, PLEX_SOURCE, {
      lastSyncCompletedAt: new Date('2026-04-06T12:05:00Z'),
      lastSyncStatus: 'completed',
      lastSyncCounts: {
        total: 100,
        matchedMbid: 80,
        matchedNameExact: 10,
        matchedNameAnchored: 5,
        matchedDisambiguated: 0,
        unreconciledAmbiguous: 2,
        unreconciledNoCandidate: 3,
        cacheHits: 0,
        mbApiCalls: 20,
      },
    })
    const state2 = await store.getLibrarySyncState(userId, PLEX_SOURCE)
    expect(state2?.lastSyncStatus).toBe('completed')
    expect(state2?.lastSyncCounts?.total).toBe(100)
  })

  it('clearRunningSyncStates flips stale running rows to failed', async () => {
    const store = createLibrarySyncStore(db)
    // One stale 'running' row, one 'completed', one 'failed'
    await store.upsertLibrarySyncState(userId, PLEX_SOURCE, { lastSyncStatus: 'running' })
    await store.upsertLibrarySyncState(null, 'lidarr', { lastSyncStatus: 'completed' })
    await store.upsertLibrarySyncState(null, 'jellyfin', { lastSyncStatus: 'failed' })

    const cleared = await store.clearRunningSyncStates()
    expect(cleared).toBe(1)

    expect((await store.getLibrarySyncState(userId, PLEX_SOURCE))?.lastSyncStatus).toBe('failed')
    expect((await store.getLibrarySyncState(userId, PLEX_SOURCE))?.lastSyncError).toMatch(
      /Interrupted/i,
    )
    expect((await store.getLibrarySyncState(null, 'lidarr'))?.lastSyncStatus).toBe('completed')
    expect((await store.getLibrarySyncState(null, 'jellyfin'))?.lastSyncStatus).toBe('failed')
  })

  it('override CRUD round-trips', async () => {
    const store = createLibrarySyncStore(db)
    await store.upsertOverride(
      userId,
      PLEX_SOURCE,
      'rk-1',
      '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
      'fix',
    )
    const got = await store.getOverride(userId, PLEX_SOURCE, 'rk-1')
    expect(got?.correctMbid).toBe('8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11')

    const all = await store.getAllOverrides(userId)
    expect(all.size).toBe(1)
    expect(all.get(`${PLEX_SOURCE}:rk-1`)?.correctMbid).toBe('8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11')

    await store.deleteOverride(userId, PLEX_SOURCE, 'rk-1')
    expect(await store.getOverride(userId, PLEX_SOURCE, 'rk-1')).toBeNull()
  })

  it('listUnreconciledForUser hides rows once an override exists', async () => {
    const store = createLibrarySyncStore(db)
    await store.replaceLibraryArtists(userId, PLEX_SOURCE, [
      reconciled({
        sourceArtistId: 'rk-1',
        name: 'Bush',
        nameNormalized: 'bush',
        unreconciledReason: 'no_candidate',
      }),
    ])

    expect(await store.listUnreconciledForUser(userId)).toHaveLength(1)

    await store.upsertOverride(
      userId,
      PLEX_SOURCE,
      'rk-1',
      'a74b1b7f-71a5-4011-9441-d0b5e4122711',
      'manual fix',
    )

    expect(await store.listUnreconciledForUser(userId)).toHaveLength(0)
  })

  it('album override CRUD round-trips', async () => {
    const store = createLibrarySyncStore(db)

    await store.upsertAlbumOverride(
      userId,
      'plex',
      'album-1',
      '11111111-1111-1111-1111-111111111111',
      'manual fix',
    )

    const overrides = await store.listAlbumOverrides(userId)
    expect(overrides).toEqual([
      {
        source: 'plex',
        sourceAlbumId: 'album-1',
        correctAlbumMbid: '11111111-1111-1111-1111-111111111111',
      },
    ])

    await store.upsertAlbumOverride(userId, 'plex', 'album-1', null, 'ignore')

    const updated = await store.listAlbumOverrides(userId)
    expect(updated).toEqual([
      {
        source: 'plex',
        sourceAlbumId: 'album-1',
        correctAlbumMbid: null,
      },
    ])

    await store.deleteAlbumOverride(userId, 'plex', 'album-1')
    expect(await store.listAlbumOverrides(userId)).toEqual([])
  })

  it('listUnreconciledAlbumsForUser hides rows that already have an override', async () => {
    const store = createLibrarySyncStore(db)
    const artistMbid = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'

    await store.replaceLibraryAlbums(userId, 'plex', [
      reconciledAlbum({
        sourceAlbumId: 'album-1',
        sourceArtistId: 'artist-1',
        title: 'Unknown Album',
        titleNormalized: 'unknown album',
        albumMbid: null,
        artistMbid,
        primaryType: 'Album',
      }),
    ])

    expect(await store.listUnreconciledAlbumsForUser(userId)).toHaveLength(1)

    await store.upsertAlbumOverride(userId, 'plex', 'album-1', null, 'ignore')

    expect(await store.listUnreconciledAlbumsForUser(userId)).toHaveLength(0)
  })

  it('listOwnedAlbumsForArtist returns full album shape for user and global rows only', async () => {
    const store = createLibrarySyncStore(db)
    const artistMbid = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'

    await store.replaceLibraryAlbums(userId, PLEX_SOURCE, [
      reconciledAlbum({
        sourceAlbumId: 'album-user',
        sourceArtistId: 'artist-1',
        title: 'Dummy',
        artistMbid,
        albumMbid: '11111111-1111-1111-1111-111111111111',
        releaseYear: 1991,
        primaryType: 'Album',
      }),
      reconciledAlbum({
        sourceAlbumId: 'album-ep',
        sourceArtistId: 'artist-1',
        title: 'Bonus EP',
        artistMbid,
        albumMbid: '33333333-3333-3333-3333-333333333333',
        releaseYear: 1992,
        primaryType: 'EP',
      }),
      reconciledAlbum({
        sourceAlbumId: 'album-null-mbid',
        sourceArtistId: 'artist-1',
        title: 'Unknown Album',
        artistMbid,
        albumMbid: null,
        releaseYear: 1993,
        primaryType: 'Album',
      }),
      reconciledAlbum({
        sourceAlbumId: 'album-other-artist',
        sourceArtistId: 'artist-2',
        title: 'Other Artist Album',
        artistMbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
        albumMbid: '44444444-4444-4444-4444-444444444444',
        releaseYear: 1995,
        primaryType: 'Album',
      }),
    ])

    await store.replaceLibraryAlbums(null, LIDARR_SOURCE, [
      reconciledAlbum({
        sourceAlbumId: 'album-global',
        sourceArtistId: 'artist-global',
        title: 'Hex',
        artistMbid,
        albumMbid: '22222222-2222-2222-2222-222222222222',
        releaseYear: 1994,
        primaryType: 'Album',
      }),
    ])

    const owned = await store.listOwnedAlbumsForArtist(userId, artistMbid)

    expect(owned).toEqual([
      {
        source: PLEX_SOURCE,
        sourceAlbumId: 'album-user',
        albumMbid: '11111111-1111-1111-1111-111111111111',
        title: 'Dummy',
        releaseYear: 1991,
        primaryType: 'Album',
      },
      {
        source: LIDARR_SOURCE,
        sourceAlbumId: 'album-global',
        albumMbid: '22222222-2222-2222-2222-222222222222',
        title: 'Hex',
        releaseYear: 1994,
        primaryType: 'Album',
      },
    ])
  })

  // Regression: check-then-write upserts could insert duplicate rows when two
  // sync cycles overlapped. Now uses INSERT ... ON CONFLICT DO UPDATE with
  // NULLS NOT DISTINCT so concurrent callers resolve to a single row.
  it('upsertLibrarySyncState concurrent calls do not duplicate', async () => {
    const store = createLibrarySyncStore(db)
    await Promise.all([
      store.upsertLibrarySyncState(userId, PLEX_SOURCE, { lastSyncStatus: 'running' }),
      store.upsertLibrarySyncState(userId, PLEX_SOURCE, { lastSyncStatus: 'completed' }),
      store.upsertLibrarySyncState(userId, PLEX_SOURCE, { lastSyncStatus: 'running' }),
    ])
    const rows = await db.select().from(librarySyncState).where(eq(librarySyncState.userId, userId))
    expect(rows).toHaveLength(1)
  })

  it('upsertOverride concurrent calls do not duplicate', async () => {
    const store = createLibrarySyncStore(db)
    await Promise.all([
      store.upsertOverride(userId, PLEX_SOURCE, 'artist-1', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
      store.upsertOverride(userId, PLEX_SOURCE, 'artist-1', 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ])
    const rows = await db
      .select()
      .from(libraryMatchOverrides)
      .where(eq(libraryMatchOverrides.userId, userId))
    expect(rows).toHaveLength(1)
  })

  it('upsertAlbumOverride concurrent calls do not duplicate', async () => {
    const store = createLibrarySyncStore(db)
    await Promise.all([
      store.upsertAlbumOverride(
        userId,
        PLEX_SOURCE,
        'album-1',
        'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      ),
      store.upsertAlbumOverride(
        userId,
        PLEX_SOURCE,
        'album-1',
        'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      ),
    ])
    const rows = await db
      .select()
      .from(libraryAlbumMatchOverrides)
      .where(eq(libraryAlbumMatchOverrides.userId, userId))
    expect(rows).toHaveLength(1)
  })
})
