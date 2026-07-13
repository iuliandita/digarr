import { afterEach, describe, expect, it, vi } from 'vitest'
import { setMaintenance } from '@/core/ops/maintenance'
import {
  type ArtistGenreAliasCacheEntry,
  type ArtistGenreCacheEntry,
  type GenreBackfillDb,
  hydrateArtistGenres,
  waitForGenreWarmers,
  warmArtistGenres,
} from '@/core/pipeline/genre-backfill'
import type { TopArtistEntry } from '@/core/plugins/types'

const NOW = new Date('2026-07-13T00:00:00.000Z')
const FRESH = new Date('2026-07-01T00:00:00.000Z')
const STALE = new Date('2025-12-01T00:00:00.000Z')

afterEach(() => {
  setMaintenance(false)
})

function makeDb(
  rows: ArtistGenreCacheEntry[] = [],
  aliasRows: ArtistGenreAliasCacheEntry[] = [],
): GenreBackfillDb {
  return {
    getArtistGenreCacheByMbids: vi.fn(async () => rows),
    getArtistGenreCacheByAliases: vi.fn(async () => aliasRows),
    upsertArtistGenres: vi.fn(async () => undefined),
    upsertArtistGenreAlias: vi.fn(async () => undefined),
  }
}

describe('hydrateArtistGenres()', () => {
  it('prefers native genres, then library cache, then artist cache', async () => {
    const artists: TopArtistEntry[] = [
      {
        name: 'Native',
        mbid: '00000000-0000-0000-0000-000000000001',
        playCount: 30,
        source: 'spotify',
        genres: ['Pop'],
        genreSource: 'native',
      },
      { name: 'Library', playCount: 20, source: 'subsonic' },
      {
        name: 'Cached',
        mbid: '00000000-0000-0000-0000-000000000003',
        playCount: 10,
        source: 'listenbrainz',
      },
    ]
    const db = makeDb([
      {
        mbid: '00000000-0000-0000-0000-000000000003',
        name: 'Cached',
        genres: ['Ambient'],
        cachedAt: FRESH,
      },
    ])

    const result = await hydrateArtistGenres(
      artists,
      db,
      [
        {
          mbid: null,
          name: 'Library',
          source: 'subsonic',
          genres: ['Metal'],
        },
      ],
      NOW,
    )

    expect(result.artists.map((artist) => artist.genres)).toEqual([['Pop'], ['Metal'], ['Ambient']])
    expect(result.artists.map((artist) => artist.genreSource)).toEqual([
      'native',
      'library',
      'artist-cache',
    ])
    expect(result.coverage).toEqual({ coveredArtists: 3, pendingArtists: 0, totalArtists: 3 })
  })

  it('treats a fresh empty genre array as a negative cache hit', async () => {
    const mbid = '00000000-0000-0000-0000-000000000004'
    const db = makeDb([{ mbid, name: 'Sparse', genres: [], cachedAt: FRESH }])

    const result = await hydrateArtistGenres(
      [{ name: 'Sparse', mbid, playCount: 1, source: 'listenbrainz' }],
      db,
      [],
      NOW,
    )

    expect(result.coverage).toEqual({ coveredArtists: 0, pendingArtists: 0, totalArtists: 1 })
  })

  it('hydrates a name-only artist from one exact cached identity', async () => {
    const cached = {
      source: 'subsonic',
      nameNormalized: 'name only',
      mbid: '00000000-0000-0000-0000-000000000023',
      name: 'Name Only',
      genres: ['Ambient'],
      cachedAt: FRESH,
    }
    const db = makeDb([], [cached])

    const result = await hydrateArtistGenres(
      [{ name: ' name only ', playCount: 1, source: 'subsonic' }],
      db,
      [],
      NOW,
    )

    expect(result.artists[0]).toMatchObject({
      genres: ['Ambient'],
      genreSource: 'artist-cache',
    })
    expect(result.coverage).toEqual({ coveredArtists: 1, pendingArtists: 0, totalArtists: 1 })
  })

  it('does not trust a generic artist-name cache row without a verified alias', async () => {
    const db = makeDb([
      {
        mbid: '00000000-0000-0000-0000-000000000024',
        name: 'Echo',
        genres: ['Rock'],
        cachedAt: FRESH,
      },
    ])

    const result = await hydrateArtistGenres(
      [{ name: 'Echo', playCount: 1, source: 'subsonic' }],
      db,
      [],
      NOW,
    )

    expect(result.artists[0]?.genres).toBeUndefined()
    expect(result.coverage).toEqual({ coveredArtists: 0, pendingArtists: 1, totalArtists: 1 })
  })

  it('treats a fresh name-only negative-cache alias as not pending', async () => {
    const db = makeDb(
      [],
      [
        {
          source: 'subsonic',
          nameNormalized: 'sparse alias',
          mbid: '00000000-0000-0000-0000-000000000025',
          name: 'Sparse Alias',
          genres: [],
          cachedAt: FRESH,
        },
      ],
    )

    const result = await hydrateArtistGenres(
      [{ name: 'Sparse Alias', playCount: 1, source: 'subsonic' }],
      db,
      [],
      NOW,
    )

    expect(result.coverage).toEqual({ coveredArtists: 0, pendingArtists: 0, totalArtists: 1 })
  })

  it('does not use an ambiguous library name fallback', async () => {
    const result = await hydrateArtistGenres(
      [{ name: 'Echo', playCount: 1, source: 'subsonic' }],
      makeDb(),
      [
        {
          mbid: '00000000-0000-0000-0000-000000000026',
          name: 'Echo',
          source: 'subsonic',
          genres: ['Rock'],
        },
        {
          mbid: '00000000-0000-0000-0000-000000000027',
          name: 'Echo',
          source: 'subsonic',
          genres: ['Electronic'],
        },
      ],
      NOW,
    )

    expect(result.artists[0]?.genres).toBeUndefined()
    expect(result.coverage.pendingArtists).toBe(1)
  })

  it('marks missing, null, stale, and name-only entries pending', async () => {
    const rows: ArtistGenreCacheEntry[] = [
      {
        mbid: '00000000-0000-0000-0000-000000000005',
        name: 'Null',
        genres: null,
        cachedAt: FRESH,
      },
      {
        mbid: '00000000-0000-0000-0000-000000000006',
        name: 'Stale',
        genres: ['Rock'],
        cachedAt: STALE,
      },
    ]
    const db = makeDb(rows)
    const artists: TopArtistEntry[] = [
      {
        name: 'Missing',
        mbid: '00000000-0000-0000-0000-000000000007',
        playCount: 4,
        source: 'listenbrainz',
      },
      { name: 'Null', mbid: rows[0]?.mbid, playCount: 3, source: 'listenbrainz' },
      { name: 'Stale', mbid: rows[1]?.mbid, playCount: 2, source: 'listenbrainz' },
      { name: 'Name Only', playCount: 1, source: 'subsonic' },
    ]

    const result = await hydrateArtistGenres(artists, db, [], NOW)

    expect(result.coverage).toEqual({ coveredArtists: 1, pendingArtists: 4, totalArtists: 4 })
  })
})

describe('warmArtistGenres()', () => {
  it('enforces the ten-artist external fetch cap', async () => {
    const artists = Array.from({ length: 12 }, (_, index) => ({
      name: `Artist ${index}`,
      mbid: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
      playCount: 12 - index,
      source: 'listenbrainz',
    }))
    const db = makeDb()
    const musicbrainz = {
      lookupArtist: vi.fn(async (mbid: string) => ({
        id: mbid,
        name: mbid,
        tags: [{ name: 'rock', count: 1 }],
      })),
      searchArtist: vi.fn(),
    }

    const result = await warmArtistGenres(artists, { db, musicbrainz, now: NOW })

    expect(result.attempted).toBe(10)
    expect(musicbrainz.lookupArtist).toHaveBeenCalledTimes(10)
    expect(db.upsertArtistGenres).toHaveBeenCalledTimes(10)
  })

  it('skips ambiguous name-only MusicBrainz results', async () => {
    const db = makeDb()
    const musicbrainz = {
      lookupArtist: vi.fn(),
      searchArtist: vi.fn(async () => ({
        artists: [
          { id: '00000000-0000-0000-0000-000000000010', name: 'Echo', score: 100 },
          { id: '00000000-0000-0000-0000-000000000011', name: 'Echo', score: 95 },
        ],
      })),
    }

    const result = await warmArtistGenres([{ name: 'Echo', playCount: 1, source: 'subsonic' }], {
      db,
      musicbrainz,
      now: NOW,
    })

    expect(result.skippedAmbiguous).toBe(1)
    expect(musicbrainz.lookupArtist).not.toHaveBeenCalled()
    expect(db.upsertArtistGenres).not.toHaveBeenCalled()
  })

  it('treats a malformed source MBID as name-only instead of querying UUID storage', async () => {
    const db = makeDb()
    const resolvedMbid = '00000000-0000-0000-0000-000000000016'
    const musicbrainz = {
      searchArtist: vi.fn(async () => ({
        artists: [{ id: resolvedMbid, name: 'Recovered', score: 100 }],
      })),
      lookupArtist: vi.fn(async () => ({
        id: resolvedMbid,
        name: 'Recovered',
        tags: [{ name: 'ambient', count: 1 }],
      })),
    }

    await warmArtistGenres(
      [{ name: 'Recovered', mbid: 'not-a-uuid', playCount: 1, source: 'lastfm' }],
      { db, musicbrainz, now: NOW },
    )

    expect(db.getArtistGenreCacheByMbids).not.toHaveBeenCalled()
    expect(db.getArtistGenreCacheByAliases).toHaveBeenCalledWith([
      { source: 'lastfm', nameNormalized: 'recovered' },
    ])
    expect(musicbrainz.searchArtist).toHaveBeenCalledWith('Recovered')
    expect(musicbrainz.lookupArtist).toHaveBeenCalledWith(resolvedMbid)
    expect(db.upsertArtistGenreAlias).toHaveBeenCalledWith({
      source: 'lastfm',
      nameNormalized: 'recovered',
      mbid: resolvedMbid,
    })
  })

  it('skips warming a name-only artist with a fresh unique cache entry', async () => {
    const db = makeDb(
      [],
      [
        {
          source: 'subsonic',
          nameNormalized: 'already warm',
          mbid: '00000000-0000-0000-0000-000000000028',
          name: 'Already Warm',
          genres: ['Jazz'],
          cachedAt: FRESH,
        },
      ],
    )
    const musicbrainz = { lookupArtist: vi.fn(), searchArtist: vi.fn() }

    const result = await warmArtistGenres(
      [{ name: 'Already Warm', playCount: 1, source: 'subsonic' }],
      { db, musicbrainz, now: NOW },
    )

    expect(result.attempted).toBe(0)
    expect(musicbrainz.searchArtist).not.toHaveBeenCalled()
  })

  it('uses Last.fm when MusicBrainz returns no positive tags', async () => {
    const mbid = '00000000-0000-0000-0000-000000000012'
    const db = makeDb()
    const musicbrainz = {
      lookupArtist: vi.fn(async () => ({ id: mbid, name: 'Sparse', tags: [] })),
      searchArtist: vi.fn(),
    }
    const lastfm = { getArtistGenres: vi.fn(async () => ['doom metal']) }

    await warmArtistGenres([{ name: 'Sparse', mbid, playCount: 1, source: 'lastfm' }], {
      db,
      musicbrainz,
      lastfm,
      now: NOW,
    })

    expect(lastfm.getArtistGenres).toHaveBeenCalledWith('Sparse', mbid)
    expect(db.upsertArtistGenres).toHaveBeenCalledWith({
      mbid,
      name: 'Sparse',
      genres: ['doom metal'],
    })
  })

  it('stores the canonical MusicBrainz name instead of a source-controlled alias', async () => {
    const mbid = '00000000-0000-0000-0000-000000000031'
    const db = makeDb()
    const musicbrainz = {
      lookupArtist: vi.fn(async () => ({
        id: mbid,
        name: 'Canonical Artist',
        tags: [{ name: 'ambient', count: 1 }],
      })),
      searchArtist: vi.fn(),
    }

    await warmArtistGenres([{ name: 'Source Alias', mbid, playCount: 1, source: 'jellyfin' }], {
      db,
      musicbrainz,
      now: NOW,
    })

    expect(db.upsertArtistGenres).toHaveBeenCalledWith({
      mbid,
      name: 'Canonical Artist',
      genres: ['ambient'],
    })
  })

  it('does not create a name-addressable row from Last.fm alone', async () => {
    const mbid = '00000000-0000-0000-0000-000000000032'
    const db = makeDb()
    const musicbrainz = {
      lookupArtist: vi.fn(async () => {
        throw new Error('temporary MusicBrainz outage')
      }),
      searchArtist: vi.fn(),
    }
    const lastfm = { getArtistGenres: vi.fn(async () => ['ambient']) }

    const result = await warmArtistGenres(
      [{ name: 'Untrusted Alias', mbid, playCount: 1, source: 'jellyfin' }],
      { db, musicbrainz, lastfm, now: NOW },
    )

    expect(result.failed).toBe(1)
    expect(lastfm.getArtistGenres).not.toHaveBeenCalled()
    expect(db.upsertArtistGenres).not.toHaveBeenCalled()
  })

  it('writes a fresh empty array only after a successful no-tags lookup', async () => {
    const mbid = '00000000-0000-0000-0000-000000000013'
    const db = makeDb()
    const musicbrainz = {
      lookupArtist: vi.fn(async () => ({ id: mbid, name: 'Sparse', tags: [] })),
      searchArtist: vi.fn(),
    }

    const result = await warmArtistGenres(
      [{ name: 'Sparse', mbid, playCount: 1, source: 'listenbrainz' }],
      { db, musicbrainz, now: NOW },
    )

    expect(result.updated).toBe(1)
    expect(db.upsertArtistGenres).toHaveBeenCalledWith({ mbid, name: 'Sparse', genres: [] })
  })

  it('does not poison the negative cache after an upstream failure', async () => {
    const mbid = '00000000-0000-0000-0000-000000000014'
    const db = makeDb()
    const musicbrainz = {
      lookupArtist: vi.fn(async () => {
        throw new Error('temporary outage')
      }),
      searchArtist: vi.fn(),
    }

    const result = await warmArtistGenres(
      [{ name: 'Retry Later', mbid, playCount: 1, source: 'listenbrainz' }],
      { db, musicbrainz, now: NOW },
    )

    expect(result.failed).toBe(1)
    expect(db.upsertArtistGenres).not.toHaveBeenCalled()
  })

  it('does not write a negative cache entry when the Last.fm fallback fails', async () => {
    const mbid = '00000000-0000-0000-0000-000000000029'
    const db = makeDb()
    const musicbrainz = {
      lookupArtist: vi.fn(async () => ({ id: mbid, name: 'Sparse', tags: [] })),
      searchArtist: vi.fn(),
    }
    const lastfm = {
      getArtistGenres: vi.fn(async () => {
        throw new Error('temporary Last.fm outage')
      }),
    }

    const result = await warmArtistGenres(
      [{ name: 'Sparse', mbid, playCount: 1, source: 'lastfm' }],
      { db, musicbrainz, lastfm, now: NOW },
    )

    expect(result.failed).toBe(1)
    expect(db.upsertArtistGenres).not.toHaveBeenCalled()
  })

  it('suppresses fetches and writes during maintenance', async () => {
    setMaintenance(true)
    const db = makeDb()
    const musicbrainz = { lookupArtist: vi.fn(), searchArtist: vi.fn() }

    const result = await warmArtistGenres(
      [
        {
          name: 'Paused',
          mbid: '00000000-0000-0000-0000-000000000015',
          playCount: 1,
          source: 'listenbrainz',
        },
      ],
      { db, musicbrainz, now: NOW },
    )

    expect(result.attempted).toBe(0)
    expect(musicbrainz.lookupArtist).not.toHaveBeenCalled()
    expect(db.upsertArtistGenres).not.toHaveBeenCalled()
  })

  it('reports idle only after an in-flight cache write finishes', async () => {
    const mbid = '00000000-0000-0000-0000-000000000030'
    let finishWrite: (() => void) | undefined
    const writePending = new Promise<void>((resolve) => {
      finishWrite = resolve
    })
    const db = makeDb()
    vi.mocked(db.upsertArtistGenres).mockReturnValue(writePending)
    const musicbrainz = {
      lookupArtist: vi.fn(async () => ({
        id: mbid,
        name: 'Slow Write',
        tags: [{ name: 'ambient', count: 1 }],
      })),
      searchArtist: vi.fn(),
    }

    const warming = warmArtistGenres(
      [{ name: 'Slow Write', mbid, playCount: 1, source: 'listenbrainz' }],
      { db, musicbrainz, now: NOW },
    )
    await vi.waitFor(() => expect(db.upsertArtistGenres).toHaveBeenCalledOnce())
    let idle = false
    const waiting = waitForGenreWarmers().then(() => {
      idle = true
    })
    await Promise.resolve()

    expect(idle).toBe(false)
    finishWrite?.()
    await Promise.all([warming, waiting])
    expect(idle).toBe(true)
  })
})
