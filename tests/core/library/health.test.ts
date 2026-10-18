// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarrAlbum, LidarrArtist } from '@/core/clients/lidarr'
import { LibraryHealthService } from '@/core/library/health'
import type { LibraryHealthState } from '@/core/library/types'

vi.mock('p-queue', () => {
  const mockAdd = vi.fn((fn: () => unknown) => Promise.resolve(fn()))
  const mockOnIdle = vi.fn(() => Promise.resolve())
  // Must use a real class (not arrow fn) so `new PQueue()` works as a constructor
  class MockPQueue {
    add = mockAdd
    onIdle = mockOnIdle
  }
  return { default: MockPQueue }
})

const lidarrArtist = (overrides: Partial<LidarrArtist> & Pick<LidarrArtist, 'id' | 'artistName'>) =>
  ({
    foreignArtistId: `mbid-${overrides.id}`,
    qualityProfileId: 1,
    rootFolderPath: '/music',
    monitored: true,
    status: 'ended',
    genres: [],
    ...overrides,
  }) as LidarrArtist

const ARTIST_RADIOHEAD = lidarrArtist({
  id: 1,
  artistName: 'Radiohead',
  foreignArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
  genres: ['alternative rock', 'art rock'],
})
const ARTIST_PORTISHEAD = lidarrArtist({
  id: 2,
  artistName: 'Portishead',
  foreignArtistId: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
  status: 'continuing',
  genres: ['trip hop'],
})
const ARTIST_BJORK = lidarrArtist({
  id: 3,
  artistName: 'Bjork',
  foreignArtistId: '87c7bda4-9a31-4e8c-a09c-7a595dc55c40',
  monitored: false,
  status: 'continuing',
})
const ARTIST_NO_META = lidarrArtist({
  id: 4,
  artistName: 'Unknown Artist',
  foreignArtistId: 'aaaa-bbbb-cccc-dddd-eeeeffffffff',
})

const SPECIAL_PURPOSE_MBIDS = [
  '89ad4ac3-39f7-470e-963a-56509c546377',
  '125ec42a-7229-4250-afc5-e057484327fe',
]

const ALBUM_WITH_FILES: LidarrAlbum = {
  id: 10,
  title: 'OK Computer',
  artistId: 1,
  foreignAlbumId: 'abcdef-01',
  monitored: true,
  albumType: 'Album',
  statistics: { trackCount: 12, trackFileCount: 12, percentOfTracks: 100 },
}

const ALBUM_NO_FILES: LidarrAlbum = {
  id: 11,
  title: 'Portishead',
  artistId: 2,
  foreignAlbumId: 'abcdef-02',
  monitored: true,
  albumType: 'Album',
  statistics: { trackCount: 11, trackFileCount: 0, percentOfTracks: 0 },
}

const cached = (artist: LidarrArtist, overrides: Record<string, unknown> = {}) => ({
  id: artist.id,
  mbid: artist.foreignArtistId,
  name: artist.artistName,
  genres: null,
  tags: null,
  imageUrl: null,
  streamingUrls: null,
  ...overrides,
})

const unmonitoredTrio = [
  { ...ARTIST_RADIOHEAD, monitored: false },
  { ...ARTIST_PORTISHEAD, monitored: false },
  ARTIST_BJORK,
]
const TRIO_IDS = [ARTIST_RADIOHEAD.id, ARTIST_PORTISHEAD.id, ARTIST_BJORK.id]

type SaveInput = {
  checks: LibraryHealthState['checks']
  lastCompletedAt: Date
  lastError: string | null
}

function makeMocks() {
  return {
    getArtists: vi.fn().mockResolvedValue([]),
    getAlbums: vi.fn().mockResolvedValue([]),
    lookupArtist: vi.fn().mockResolvedValue([]),
    setArtistsMonitored: vi.fn().mockResolvedValue([]),
    triggerCommand: vi.fn().mockResolvedValue({}),
    getRootFolders: vi
      .fn()
      .mockResolvedValue([{ id: 1, path: '/music', freeSpace: 5_000_000_000 }]),
    cacheGetAll: vi.fn().mockResolvedValue([]),
    cacheUpdateImageUrl: vi.fn().mockResolvedValue(undefined),
    healthStateGet: vi.fn(async (): Promise<LibraryHealthState | null> => null),
    healthStateStart: vi.fn(async () => {}),
    healthStateSave: vi.fn(async (_input: SaveInput) => {}),
    healthStateFailed: vi.fn(async (_error: string) => {}),
  }
}
type Mocks = ReturnType<typeof makeMocks>

function makeService(mocks: Mocks): LibraryHealthService {
  return new LibraryHealthService({
    lidarrClient: {
      getArtists: mocks.getArtists,
      getAlbums: mocks.getAlbums,
      lookupArtist: mocks.lookupArtist,
      setArtistsMonitored: mocks.setArtistsMonitored,
      triggerCommand: mocks.triggerCommand,
      getRootFolders: mocks.getRootFolders,
    },
    artistCache: { getAll: mocks.cacheGetAll, updateImageUrl: mocks.cacheUpdateImageUrl },
    stateStore: {
      get: mocks.healthStateGet,
      markScanStarted: mocks.healthStateStart,
      save: mocks.healthStateSave,
      markScanFailed: mocks.healthStateFailed,
    },
  } as never)
}

describe('LibraryHealthService', () => {
  let mocks: Mocks
  let service: LibraryHealthService

  beforeEach(() => {
    mocks = makeMocks()
    service = makeService(mocks)
  })

  async function scan(
    artists: LidarrArtist[],
    cache: Array<ReturnType<typeof cached>> = [],
    albums?: LidarrAlbum[],
  ) {
    mocks.getArtists.mockResolvedValue(artists)
    mocks.cacheGetAll.mockResolvedValue(cache)
    if (albums) mocks.getAlbums.mockResolvedValue(albums)
    return service.runChecks()
  }

  describe('state persistence', () => {
    it('persists the computed snapshot and exposes it via getState', async () => {
      const savedStates: LibraryHealthState[] = []
      mocks.healthStateSave.mockImplementation(async ({ checks, lastCompletedAt, lastError }) => {
        savedStates.push({
          checks,
          lastStartedAt: new Date('2026-04-13T10:00:00.000Z'),
          lastCompletedAt,
          lastError,
        })
      })
      mocks.healthStateGet.mockImplementation(async () => savedStates.at(-1) ?? null)

      await scan(
        [ARTIST_RADIOHEAD, ARTIST_BJORK],
        [cached(ARTIST_RADIOHEAD, { genres: ['rock'], imageUrl: 'http://img' })],
      )
      const state = await service.getState()

      expect(mocks.healthStateSave).toHaveBeenCalledTimes(1)
      expect(state?.lastStartedAt?.toISOString()).toBe('2026-04-13T10:00:00.000Z')
      expect(state?.lastCompletedAt).toBeInstanceOf(Date)
      expect(state?.lastError).toBeNull()
      expect(state?.checks.find((check) => check.id === 'unmonitored')?.count).toBe(1)
    })

    it('reports partial missing-album results when some album lookups fail', async () => {
      mocks.getAlbums.mockImplementation(async (artistId: number) => {
        if (artistId === ARTIST_PORTISHEAD.id) throw new Error('Lidarr 503')
        return [ALBUM_NO_FILES]
      })

      const results = await scan([ARTIST_RADIOHEAD, ARTIST_PORTISHEAD])

      expect(results.find((check) => check.id === 'missing-albums')?.count).toBe(1)
      expect(mocks.healthStateSave).toHaveBeenCalledWith(
        expect.objectContaining({
          lastError: expect.stringContaining('failed for 1 of 2 monitored artists'),
        }),
      )
    })

    it('records a failed scan when every album lookup fails', async () => {
      mocks.getArtists.mockResolvedValue([ARTIST_RADIOHEAD, ARTIST_PORTISHEAD])
      mocks.getAlbums.mockRejectedValue(new Error('Lidarr 503'))
      vi.spyOn(console, 'error').mockImplementation(() => {})

      service.startScan()
      await vi.waitFor(() => expect(service.scanning).toBe(false))

      expect(mocks.healthStateSave).not.toHaveBeenCalled()
      expect(mocks.healthStateFailed).toHaveBeenCalledWith(
        expect.stringContaining('Album lookups failed for all 2 monitored artists'),
      )
    })
  })

  describe('checks', () => {
    const dupe = (id: number, artistName: string) =>
      lidarrArtist({ ...ARTIST_RADIOHEAD, id, artistName, foreignArtistId: `mbid-${id}` })

    it.each([
      {
        name: 'unmonitored artist is flagged',
        check: 'unmonitored',
        artists: [ARTIST_RADIOHEAD, ARTIST_BJORK],
        count: 1,
        first: { artistName: 'Bjork', detail: 'Not monitored' },
      },
      {
        name: 'unmonitored: all monitored is empty',
        check: 'unmonitored',
        artists: [ARTIST_RADIOHEAD, ARTIST_PORTISHEAD],
        count: 0,
      },
      {
        name: 'genre-gaps: null genres in both sources',
        check: 'genre-gaps',
        artists: [{ ...ARTIST_BJORK, genres: undefined }],
        cache: [cached(ARTIST_BJORK)],
        count: 1,
        first: { detail: 'No genre tags' },
      },
      {
        name: 'genre-gaps: empty genres in both sources',
        check: 'genre-gaps',
        artists: [ARTIST_BJORK],
        cache: [cached(ARTIST_BJORK, { genres: [] })],
        count: 1,
      },
      {
        name: 'genre-gaps: skipped when Lidarr has genres',
        check: 'genre-gaps',
        artists: [ARTIST_RADIOHEAD],
        cache: [cached(ARTIST_RADIOHEAD)],
        count: 0,
      },
      {
        name: 'genre-gaps: skipped when cache has genres',
        check: 'genre-gaps',
        artists: [ARTIST_BJORK],
        cache: [cached(ARTIST_BJORK, { genres: ['electronic'] })],
        count: 0,
      },
      {
        name: 'image-gaps: cached artist without image',
        check: 'image-gaps',
        artists: [ARTIST_RADIOHEAD],
        cache: [cached(ARTIST_RADIOHEAD, { genres: ['rock'] })],
        count: 1,
        first: { detail: 'No image' },
      },
      {
        name: 'image-gaps: skipped when imageUrl exists',
        check: 'image-gaps',
        artists: [ARTIST_RADIOHEAD],
        cache: [cached(ARTIST_RADIOHEAD, { imageUrl: 'https://img.example.com/1.jpg' })],
        count: 0,
      },
      {
        name: 'duplicate-artists: same name, different MBIDs grouped once',
        check: 'duplicate-artists',
        artists: [dupe(10, 'Radiohead'), dupe(11, 'Radiohead')],
        count: 1,
        first: { detail: /2 entries/ },
      },
      {
        name: 'duplicate-artists: case-insensitive',
        check: 'duplicate-artists',
        artists: [dupe(10, 'radiohead'), dupe(11, 'RADIOHEAD')],
        count: 1,
      },
      {
        name: 'duplicate-artists: none',
        check: 'duplicate-artists',
        artists: [ARTIST_RADIOHEAD, ARTIST_PORTISHEAD],
        count: 0,
      },
      {
        name: 'missing-metadata: no genres and no image',
        check: 'missing-metadata',
        artists: [ARTIST_NO_META],
        cache: [cached(ARTIST_NO_META)],
        count: 1,
        first: { detail: 'Missing: genres, image' },
      },
      {
        name: 'missing-metadata: skipped when cache has image',
        check: 'missing-metadata',
        artists: [ARTIST_NO_META],
        cache: [cached(ARTIST_NO_META, { imageUrl: 'http://img.example.com/no_meta.jpg' })],
        count: 0,
      },
      {
        name: 'missing-albums: monitored artist with empty monitored albums',
        check: 'missing-albums',
        artists: [ARTIST_PORTISHEAD],
        albums: [ALBUM_NO_FILES],
        count: 1,
        first: { detail: '1 monitored album with no files' },
      },
      {
        name: 'missing-albums: albums with files skipped',
        check: 'missing-albums',
        artists: [ARTIST_RADIOHEAD],
        albums: [ALBUM_WITH_FILES],
        count: 0,
      },
    ] as Array<{
      name: string
      check: string
      artists: LidarrArtist[]
      cache?: Array<ReturnType<typeof cached>>
      albums?: LidarrAlbum[]
      count: number
      first?: { artistName?: string; detail?: string | RegExp }
    }>)('$name', async ({ check, artists, cache, albums, count, first }) => {
      const result = (await scan(artists, cache, albums)).find((r) => r.id === check)

      expect(result?.count).toBe(count)
      expect(result?.items).toHaveLength(count)
      if (first?.artistName) expect(result?.items[0]?.artistName).toBe(first.artistName)
      if (first?.detail) expect(result?.items[0]?.detail).toMatch(first.detail)
    })

    it('skips unmonitored artists in missing-albums without fetching their albums', async () => {
      const results = await scan([ARTIST_BJORK])

      expect(results.find((r) => r.id === 'missing-albums')?.count).toBe(0)
      expect(mocks.getAlbums).not.toHaveBeenCalled()
    })

    it.each(SPECIAL_PURPOSE_MBIDS)('excludes special-purpose artist %s', async (mbid) => {
      const results = await scan(
        [{ ...ARTIST_PORTISHEAD, foreignArtistId: mbid }],
        [],
        [ALBUM_NO_FILES],
      )

      expect(results.find((r) => r.id === 'missing-albums')?.count).toBe(0)
      expect(mocks.getAlbums).not.toHaveBeenCalled()
    })

    it('still fails when every attempted lookup fails alongside skipped artists', async () => {
      mocks.getAlbums.mockRejectedValue(new Error('Lidarr unavailable'))

      await expect(
        scan([
          ARTIST_PORTISHEAD,
          { ...ARTIST_RADIOHEAD, foreignArtistId: SPECIAL_PURPOSE_MBIDS[0] as string },
        ]),
      ).rejects.toThrow('Album lookups failed for all 1 monitored artists')
      expect(mocks.getAlbums).toHaveBeenCalledExactlyOnceWith(ARTIST_PORTISHEAD.id)
    })
  })

  describe('caching', () => {
    it('getLastResults is null before a scan and tracks the latest fresh run', async () => {
      expect(service.getLastResults()).toBeNull()

      mocks.getArtists.mockResolvedValueOnce([]).mockResolvedValueOnce([ARTIST_BJORK])
      const first = await service.runChecks()
      expect(service.getLastResults()).toBe(first)
      const second = await service.runChecks()

      expect(service.getLastResults()).toBe(second)
      expect(second).not.toBe(first)
      expect(mocks.getArtists).toHaveBeenCalledTimes(2)
      expect(mocks.cacheGetAll).toHaveBeenCalledTimes(2)
    })
  })

  describe('fixCheck', () => {
    it('throws for duplicate-artists', async () => {
      await scan([ARTIST_BJORK, ARTIST_PORTISHEAD])

      await expect(service.fixCheck('duplicate-artists')).rejects.toThrow('not fixable')
    })

    it.each([
      {
        check: 'genre-gaps',
        artists: [ARTIST_BJORK],
        cache: [cached(ARTIST_BJORK, { genres: [] })],
        expectCall: (m: Mocks) =>
          expect(m.triggerCommand).toHaveBeenCalledWith('RefreshArtist', {
            artistId: ARTIST_BJORK.id,
          }),
      },
      {
        check: 'unmonitored',
        artists: [ARTIST_BJORK],
        cache: [],
        expectCall: (m: Mocks) =>
          expect(m.setArtistsMonitored).toHaveBeenCalledWith([ARTIST_BJORK.id], true),
      },
    ])(
      'fixes $check through the matching Lidarr call',
      async ({ check, artists, cache, expectCall }) => {
        await scan(artists, cache)

        const progress = await service.fixCheck(check as 'genre-gaps' | 'unmonitored')

        expectCall(mocks)
        expect(progress).toMatchObject({ completed: 1, failed: 0, status: 'completed' })
      },
    )

    it('queues one ArtistSearch per item for missing-albums', async () => {
      await scan([ARTIST_PORTISHEAD, ARTIST_RADIOHEAD], [], [ALBUM_NO_FILES])

      const progress = await service.fixCheck('missing-albums')

      expect(mocks.triggerCommand).toHaveBeenCalledTimes(2)
      expect(mocks.triggerCommand).toHaveBeenCalledWith('ArtistSearch', {
        artistId: ARTIST_PORTISHEAD.id,
      })
      expect(mocks.triggerCommand).toHaveBeenCalledWith('ArtistSearch', {
        artistId: ARTIST_RADIOHEAD.id,
      })
      expect(progress).toMatchObject({ completed: 2, status: 'completed' })
    })

    it.each([
      { name: 'stores the image found by lookup', lookup: true },
      { name: 'completes without updating when lookup finds no image', lookup: false },
    ])('image-gaps $name', async ({ lookup }) => {
      const mbid = ARTIST_BJORK.foreignArtistId
      const imageUrl = 'https://fanart.tv/img/bjork-poster.jpg'
      await scan([ARTIST_BJORK], [cached(ARTIST_BJORK, { genres: ['electronic'] })])
      mocks.lookupArtist.mockResolvedValue(
        lookup ? [{ images: [{ coverType: 'poster', remoteUrl: imageUrl }] }] : [],
      )

      const progress = await service.fixCheck('image-gaps')

      expect(mocks.lookupArtist).toHaveBeenCalledWith(`lidarr:${mbid}`)
      if (lookup) expect(mocks.cacheUpdateImageUrl).toHaveBeenCalledWith(mbid, imageUrl)
      else expect(mocks.cacheUpdateImageUrl).not.toHaveBeenCalled()
      expect(progress).toMatchObject({ completed: 1, status: 'completed' })
    })

    it('counts failures when fix throws', async () => {
      await scan([ARTIST_BJORK])
      mocks.setArtistsMonitored.mockRejectedValue(new Error('Lidarr down'))

      const progress = await service.fixCheck('unmonitored')

      expect(progress).toMatchObject({ failed: 1, completed: 0, status: 'failed' })
      expect(progress.errors[0]).toContain('Lidarr down')
    })

    it('refuses to fix without any scan results instead of reporting success', async () => {
      await expect(makeService(mocks).fixCheck('unmonitored')).rejects.toThrow(
        'run a library health scan',
      )
      expect(mocks.setArtistsMonitored).not.toHaveBeenCalled()
    })

    it('fixes from persisted results after a restart', async () => {
      mocks.healthStateGet.mockResolvedValue({
        checks: [
          {
            id: 'unmonitored',
            name: 'Unmonitored Artists',
            description: '',
            severity: 'info',
            fixable: true,
            count: 1,
            items: [{ artistId: 7, artistName: 'Bjork', mbid: 'x', detail: 'Not monitored' }],
          },
        ],
        lastStartedAt: null,
        lastCompletedAt: new Date(),
        lastError: null,
      })

      const progress = await makeService(mocks).fixCheck('unmonitored')

      expect(mocks.setArtistsMonitored).toHaveBeenCalledWith([7], true)
      expect(progress).toMatchObject({ total: 1, completed: 1, status: 'completed' })
    })

    it('bulk-flips all unmonitored artists in a single setArtistsMonitored call', async () => {
      await scan(unmonitoredTrio)

      const progress = await service.fixCheck('unmonitored')

      expect(mocks.setArtistsMonitored).toHaveBeenCalledTimes(1)
      expect(mocks.setArtistsMonitored).toHaveBeenCalledWith(TRIO_IDS, true)
      expect(progress).toMatchObject({ total: 3, completed: 3, failed: 0, status: 'completed' })
    })

    it.each([
      {
        name: 'falls back to per-artist calls when the bulk unmonitored call fails',
        reject: () => Promise.reject(new Error('Lidarr down')),
        completed: 0,
        errors: [
          `${ARTIST_RADIOHEAD.artistName}: Lidarr down`,
          `${ARTIST_PORTISHEAD.artistName}: Lidarr down`,
          `${ARTIST_BJORK.artistName}: Lidarr down`,
        ],
      },
      {
        name: 'recovers healthy artists and names the culprit when one item poisons the bulk call',
        reject: (ids: number[]) =>
          ids.length > 1 || ids[0] === ARTIST_PORTISHEAD.id
            ? Promise.reject(new Error('artist not found'))
            : Promise.resolve([]),
        completed: 2,
        errors: [`${ARTIST_PORTISHEAD.artistName}: artist not found`],
      },
    ])('$name', async ({ reject, completed, errors }) => {
      await scan(unmonitoredTrio)
      mocks.setArtistsMonitored.mockImplementation(reject)

      const progress = await service.fixCheck('unmonitored')

      expect(mocks.setArtistsMonitored.mock.calls).toEqual([
        [TRIO_IDS, true],
        [[TRIO_IDS[0]], true],
        [[TRIO_IDS[1]], true],
        [[TRIO_IDS[2]], true],
      ])
      expect(progress).toMatchObject({
        total: 3,
        completed,
        failed: 3 - completed,
        status: 'failed',
      })
      expect(progress.errors).toEqual(errors)
    })
  })

  describe('getStats', () => {
    it('returns correct counts and genre distribution', async () => {
      mocks.getArtists.mockResolvedValue([ARTIST_RADIOHEAD, ARTIST_PORTISHEAD, ARTIST_BJORK])
      mocks.getRootFolders.mockResolvedValue([{ id: 1, path: '/music', freeSpace: 10_000_000_000 }])

      const stats = await service.getStats()

      expect(stats).toMatchObject({ totalArtists: 3, monitoredArtists: 2, totalAlbums: 0 })
      expect(stats.rootFolders.map((folder) => folder.path)).toEqual(['/music'])
      expect(stats.genreDistribution.some((g) => g.genre === 'alternative rock')).toBe(true)
    })

    it('limits genre distribution to top 30', async () => {
      mocks.getArtists.mockResolvedValue(
        Array.from({ length: 35 }, (_, i) =>
          lidarrArtist({ id: i + 1, artistName: `Artist ${i}`, genres: [`genre-${i}`] }),
        ),
      )
      mocks.getRootFolders.mockResolvedValue([])

      const stats = await service.getStats()

      expect(stats.genreDistribution).toHaveLength(30)
    })
  })
})
