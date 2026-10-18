// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LidarrAlbum,
  LidarrArtist,
  MetadataProfile,
  QualityProfile,
  RootFolder,
} from '@/core/clients/lidarr'
import { createLidarrClient, LIDARR_MONITOR_TYPES } from '@/core/clients/lidarr'
import { monitorOptionSchema } from '@/server/schemas/recommendations'

// Mock the HTTP client module so we never hit a real server.
const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPut = vi.fn()

// Only createHttpClient is stubbed; the real error classes are kept so the
// timeout-wrapping assertions exercise the same types production throws.
vi.mock('@/core/clients/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/clients/http')>()),
  createHttpClient: vi.fn(() => ({
    get: mockGet,
    post: mockPost,
    put: mockPut,
    delete: vi.fn(),
  })),
}))

const { createHttpClient, HttpTimeoutError } = await import('@/core/clients/http')

const TEST_URL = 'http://lidarr.local:8686'
const TEST_KEY = 'abc123key'

const mockArtists: LidarrArtist[] = [
  {
    id: 1,
    artistName: 'Radiohead',
    foreignArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    qualityProfileId: 1,
    rootFolderPath: '/music',
    monitored: true,
    status: 'ended',
    genres: ['alternative rock', 'art rock'],
  },
  {
    id: 2,
    artistName: 'Portishead',
    foreignArtistId: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0a11',
    qualityProfileId: 1,
    rootFolderPath: '/music',
    monitored: true,
    status: 'continuing',
    genres: ['trip hop', 'electronic'],
  },
]

const mockProfiles: QualityProfile[] = [
  { id: 1, name: 'Any' },
  { id: 2, name: 'Lossless' },
]

const mockFolders: RootFolder[] = [
  { id: 1, path: '/music', freeSpace: 10_000_000_000 },
  { id: 2, path: '/music2', freeSpace: 5_000_000_000 },
]

const mockMetadataProfiles: MetadataProfile[] = [
  { id: 1, name: 'Standard' },
  { id: 2, name: 'None' },
]

// addArtist() fetches root folders and both profile lists in parallel, so
// order-based mockResolvedValueOnce chains are fragile -- dispatch by URL.
function mockLidarrGets(overrides?: {
  folders?: RootFolder[]
  qualityProfiles?: QualityProfile[]
  metadataProfiles?: MetadataProfile[]
}) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/v1/rootfolder') return Promise.resolve(overrides?.folders ?? mockFolders)
    if (url === '/api/v1/qualityprofile')
      return Promise.resolve(overrides?.qualityProfiles ?? mockProfiles)
    if (url === '/api/v1/metadataprofile')
      return Promise.resolve(overrides?.metadataProfiles ?? mockMetadataProfiles)
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

const mockAlbum: LidarrAlbum = {
  id: 101,
  title: 'OK Computer',
  artistId: 1,
  foreignAlbumId: 'a0a0a0a0-0000-0000-0000-000000000001',
  monitored: true,
  albumType: 'Album',
}

const alternateFolders: RootFolder[] = [
  { id: 5, path: '/music5', freeSpace: 10_000_000_000 },
  { id: 7, path: '/music7', freeSpace: 5_000_000_000 },
]

const wantedAlbum = {
  id: 44,
  title: 'Geogaddi',
  artistId: 7,
  foreignAlbumId: 'album-mbid-44',
  artist: {
    id: 7,
    artistName: 'Boards of Canada',
    foreignArtistId: '11111111-1111-1111-1111-111111111111',
  },
}

const mockAlbums: LidarrAlbum[] = [
  {
    id: 101,
    title: 'OK Computer',
    artistId: 1,
    foreignAlbumId: 'a0a0a0a0-0000-0000-0000-000000000001',
    monitored: true,
    albumType: 'Album',
    statistics: { trackCount: 12, trackFileCount: 12, percentOfTracks: 100 },
  },
  {
    id: 102,
    title: 'Kid A',
    artistId: 1,
    foreignAlbumId: 'a0a0a0a0-0000-0000-0000-000000000002',
    monitored: true,
    albumType: 'Album',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createLidarrClient', () => {
  describe('constructor / auth header', () => {
    it('creates an HTTP client with X-Api-Key header', () => {
      createLidarrClient(TEST_URL, TEST_KEY)
      expect(createHttpClient).toHaveBeenCalledOnce()
      const config = vi.mocked(createHttpClient).mock.calls[0]?.[0]
      expect(config?.baseUrl).toBe(TEST_URL)
      expect(config?.headers?.['X-Api-Key']).toBe(TEST_KEY)
    })
  })

  describe('getArtists()', () => {
    // Retrying a timeout makes Lidarr serialize the entire library again (#589).
    it.each([undefined, 300_000])(
      'uses a long, non-retrying library read with timeout %s (#589)',
      async (listTimeoutMs) => {
        mockGet.mockResolvedValueOnce(mockArtists)
        const client = createLidarrClient(TEST_URL, TEST_KEY, false, { listTimeoutMs })
        expect(await client.getArtists()).toEqual(mockArtists)
        expect(mockGet).toHaveBeenCalledExactlyOnceWith('/api/v1/artist', {
          timeout: listTimeoutMs ?? 120_000,
          retries: 0,
        })
      },
    )

    it.each([
      {
        error: new HttpTimeoutError(120_000, 'GET', `${TEST_URL}/api/v1/artist`),
        message: /DIGARR_LIDARR_TIMEOUT_SECONDS/,
      },
      { error: new Error('connection refused'), message: /connection refused/ },
    ])('reports library read failures: $message', async ({ error, message }) => {
      mockGet.mockRejectedValueOnce(error)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await expect(client.getArtists()).rejects.toThrow(message)
    })
  })

  describe('findArtistByMbid()', () => {
    // Older servers ignore mbId and return the full library.
    const radioheadMbid = mockArtists[0]?.foreignArtistId as string

    it.each([
      {
        name: 'filtered response',
        response: [mockArtists[0]],
        mbid: radioheadMbid,
        expected: mockArtists[0],
      },
      { name: 'empty response', response: [], mbid: radioheadMbid, expected: null },
      {
        name: 'ignored mbId with no match',
        response: mockArtists,
        mbid: '00000000-0000-0000-0000-000000000000',
        expected: null,
      },
      {
        name: 'ignored mbId with a match',
        response: mockArtists,
        mbid: radioheadMbid,
        expected: mockArtists[0],
      },
    ])('selects only the requested MBID from $name', async ({ response, mbid, expected }) => {
      mockGet.mockResolvedValueOnce(response)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await expect(client.findArtistByMbid(mbid)).resolves.toEqual(expected)
      expect(mockGet).toHaveBeenCalledWith(`/api/v1/artist?mbId=${mbid}`)
    })
  })

  describe('lookupArtist()', () => {
    it.each([
      { term: 'Radiohead', encoded: 'Radiohead', response: [mockArtists[0]] },
      { term: 'At the Drive-In', encoded: 'At+the+Drive-In', response: [] },
    ])('encodes lookup term $term', async ({ term, encoded, response }) => {
      mockGet.mockResolvedValueOnce(response)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await expect(client.lookupArtist(term)).resolves.toEqual(response)
      expect(mockGet).toHaveBeenCalledWith(`/api/v1/artist/lookup?term=${encoded}`)
    })
  })

  describe('profile and folder endpoints', () => {
    it.each([
      { method: 'getQualityProfiles', path: '/api/v1/qualityprofile', response: mockProfiles },
      { method: 'getRootFolders', path: '/api/v1/rootfolder', response: mockFolders },
    ] as const)('reads $method from $path', async ({ method, path, response }) => {
      mockGet.mockResolvedValueOnce(response)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await expect(client[method]()).resolves.toEqual(response)
      expect(mockGet).toHaveBeenCalledWith(path)
    })
  })

  describe('addArtist()', () => {
    // Lidarr rejects `new`; its equivalent monitor type is `future` (#611).
    it.each([
      ['all', 'all'],
      ['new', 'future'],
      ['missing', 'missing'],
      ['existing', 'existing'],
      ['latest', 'latest'],
      ['first', 'first'],
      ['none', 'none'],
    ] as const)(
      'sends %s as %s with tags on the add request (#611)',
      async (monitorOption, monitor) => {
        mockLidarrGets()
        mockPost.mockResolvedValue(mockArtists[0])
        const client = createLidarrClient(TEST_URL, TEST_KEY)
        await client.addArtist('mbid', 'Artist', 1, 1, 1, { monitorOption, tags: [2, 7] })
        expect(mockPost).toHaveBeenCalledWith(
          '/api/v1/artist',
          expect.objectContaining({
            tags: [2, 7],
            addOptions: {
              monitor,
              searchForMissingAlbums: monitorOption !== 'new' && monitorOption !== 'none',
            },
          }),
        )
      },
    )

    it('loads and creates tags using the instance tag endpoint', async () => {
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      mockGet.mockResolvedValue([{ id: 2, label: 'discovery' }])
      mockPost.mockResolvedValue({ id: 3, label: 'digarr' })
      expect(await client.getTags()).toEqual([{ id: 2, label: 'discovery' }])
      expect(await client.createTag('digarr')).toEqual({ id: 3, label: 'digarr' })
      expect(mockGet).toHaveBeenCalledWith('/api/v1/tag')
      expect(mockPost).toHaveBeenCalledWith('/api/v1/tag', { label: 'digarr' })
    })

    it('resolves rootFolderId to path and POSTs to /api/v1/artist', async () => {
      mockLidarrGets()
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 10 })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.addArtist(
        'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        'Radiohead',
        1,
        1,
        1,
      )

      expect(mockGet).toHaveBeenCalledWith('/api/v1/rootfolder')
      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({
          foreignArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
          artistName: 'Radiohead',
          metadataProfileId: 1,
          qualityProfileId: 1,
          rootFolderPath: '/music',
          monitored: true,
          addOptions: { monitor: 'none', searchForMissingAlbums: false },
        }),
      )
      expect(result).toMatchObject({ id: 10 })
    })

    it('caches root folder and profile lookups across multiple addArtist calls', async () => {
      mockLidarrGets()
      mockPost.mockResolvedValue({ id: 11 })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('mbid-a', 'Artist A', 1, 1, 1)
      await client.addArtist('mbid-b', 'Artist B', 1, 1, 2)

      for (const url of [
        '/api/v1/rootfolder',
        '/api/v1/qualityprofile',
        '/api/v1/metadataprofile',
      ]) {
        expect(mockGet.mock.calls.filter((c) => c[0] === url)).toHaveLength(1)
      }
    })

    it.each([
      { rootFolderId: undefined, path: '/music5', folders: alternateFolders },
      { rootFolderId: null, path: '/music5', folders: alternateFolders },
      { rootFolderId: 2, path: '/music2', folders: mockFolders },
    ])('resolves folder $rootFolderId to $path', async ({ rootFolderId, path, folders }) => {
      mockLidarrGets({ folders })
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 20 })
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist(
        'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        'Radiohead',
        1,
        1,
        rootFolderId,
      )
      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({ rootFolderPath: path }),
      )
    })

    it('throws with id in message when rootFolderId does not match any folder', async () => {
      mockLidarrGets()
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await expect(
        client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, 42),
      ).rejects.toThrow('Root folder with id 42 not found')
    })

    it('throws when no root folders are configured in Lidarr', async () => {
      mockLidarrGets({ folders: [] })
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await expect(
        client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1),
      ).rejects.toThrow('No root folders configured in Lidarr')
    })

    it.each([
      {
        name: 'quality',
        overrides: { qualityProfiles: [{ id: 3, name: 'Stefan' }] },
        expected: { qualityProfileId: 3 },
      },
      {
        name: 'metadata',
        overrides: { metadataProfiles: [{ id: 5, name: 'Custom' }] },
        expected: { metadataProfileId: 5 },
      },
    ])(
      'snaps a stale $name profile ID to the first available profile',
      async ({ overrides, expected }) => {
        mockLidarrGets(overrides)
        mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 23 })
        const client = createLidarrClient(TEST_URL, TEST_KEY)
        await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, 1)
        expect(mockPost).toHaveBeenCalledWith('/api/v1/artist', expect.objectContaining(expected))
      },
    )

    it('keeps valid profile ids untouched', async () => {
      mockLidarrGets()
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 25 })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 2, 2, 1)

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({ qualityProfileId: 2, metadataProfileId: 2 }),
      )
    })

    it('throws when Lidarr has no quality profiles configured', async () => {
      mockLidarrGets({ qualityProfiles: [] })
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await expect(
        client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, 1),
      ).rejects.toThrow('No quality profiles configured in Lidarr')
    })
  })

  describe('getAlbums()', () => {
    it('GETs /api/v1/album with artistId query param', async () => {
      mockGet.mockResolvedValueOnce(mockAlbums)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.getAlbums(1)
      expect(mockGet).toHaveBeenCalledWith('/api/v1/album?artistId=1')
      expect(result).toEqual(mockAlbums)
    })

    it('returns empty array when artist has no albums', async () => {
      mockGet.mockResolvedValueOnce([])
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.getAlbums(99)
      expect(result).toEqual([])
    })
  })

  describe('getWantedMissing()', () => {
    it.each([
      { name: 'array', response: [wantedAlbum] },
      {
        name: 'paginated records',
        response: { page: 1, pageSize: 10, totalRecords: 1, records: [wantedAlbum] },
      },
    ])('reads wanted albums from $name responses', async ({ response }) => {
      mockGet.mockResolvedValueOnce(response)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await expect(client.getWantedMissing()).resolves.toEqual([wantedAlbum])
      expect(mockGet).toHaveBeenCalledWith(
        '/api/v1/wanted/missing?page=1&pageSize=250&includeArtist=true',
      )
    })

    it('fetches every page until totalRecords is reached', async () => {
      const row = (id: number) => ({ id, title: `t${id}`, artistId: 1, foreignAlbumId: `a${id}` })
      mockGet
        .mockResolvedValueOnce({
          totalRecords: 252,
          records: Array.from({ length: 250 }, (_, i) => row(i)),
        })
        .mockResolvedValueOnce({ totalRecords: 252, records: [row(250), row(251)] })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.getWantedMissing()

      expect(result).toHaveLength(252)
      expect(mockGet).toHaveBeenCalledTimes(2)
      expect(mockGet).toHaveBeenLastCalledWith(
        '/api/v1/wanted/missing?page=2&pageSize=250&includeArtist=true',
      )
    })
  })

  describe('setArtistsMonitored()', () => {
    // Regression #393 class: monitor flips must use the bulk editor endpoint
    // (see the rationale comment in src/core/clients/lidarr.ts).
    it.each([
      { ids: [1], monitored: false },
      { ids: [1, 2], monitored: true },
    ])(
      'uses the bulk artist editor for $ids with monitored $monitored (#393)',
      async ({ ids, monitored }) => {
        const updated = ids.map((id) => ({ ...mockArtists[id - 1], monitored }))
        mockPut.mockResolvedValueOnce(updated)
        const client = createLidarrClient(TEST_URL, TEST_KEY)
        await expect(client.setArtistsMonitored(ids, monitored)).resolves.toEqual(updated)
        expect(mockPut).toHaveBeenCalledExactlyOnceWith('/api/v1/artist/editor', {
          artistIds: ids,
          monitored,
        })
      },
    )
  })

  describe('setAlbumsMonitored()', () => {
    // Regression #393: monitor flips must use the bulk monitor endpoint
    // (see the rationale comment in src/core/clients/lidarr.ts).
    it.each([
      { ids: [101], monitored: true },
      { ids: [101], monitored: false },
      { ids: [101, 202], monitored: true },
    ])(
      'uses the bulk album monitor for $ids with monitored $monitored (#393)',
      async ({ ids, monitored }) => {
        const updated = ids.map((id) => ({ ...mockAlbum, id, monitored }))
        mockPut.mockResolvedValueOnce(updated)
        const client = createLidarrClient(TEST_URL, TEST_KEY)
        await expect(client.setAlbumsMonitored(ids, monitored)).resolves.toEqual(updated)
        expect(mockPut).toHaveBeenCalledExactlyOnceWith('/api/v1/album/monitor', {
          albumIds: ids,
          monitored,
        })
      },
    )
  })

  describe('triggerCommand()', () => {
    it.each([
      {
        name: 'RescanArtist',
        body: undefined,
        command: { id: 55, name: 'RescanArtist', status: 'queued' },
      },
      {
        name: 'ArtistSearch',
        body: { artistId: 1 },
        command: { id: 56, name: 'ArtistSearch', status: 'queued' },
      },
      {
        name: 'RefreshArtist',
        body: { artistId: 2 },
        command: { id: 57, name: 'RefreshArtist', status: 'started' },
      },
    ])(
      'submits $name with optional fields and returns command state',
      async ({ name, body, command }) => {
        mockPost.mockResolvedValueOnce(command)
        const client = createLidarrClient(TEST_URL, TEST_KEY)
        await expect(client.triggerCommand(name, body)).resolves.toEqual(command)
        expect(mockPost).toHaveBeenCalledWith('/api/v1/command', { name, ...body })
      },
    )
  })

  describe('manual import', () => {
    it('requests candidates with filterExistingFiles enabled', async () => {
      mockGet.mockResolvedValueOnce([])
      const client = createLidarrClient(TEST_URL, TEST_KEY)

      await client.getManualImport('/downloads/Artist Album')

      expect(mockGet).toHaveBeenCalledWith(
        '/api/v1/manualimport?folder=%2Fdownloads%2FArtist+Album&filterExistingFiles=true',
      )
    })

    it('submits ManualImport with move mode and no replacement', async () => {
      mockPost.mockResolvedValueOnce({ id: 91, name: 'ManualImport', status: 'queued' })
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const files = [
        {
          path: '/downloads/Album/01.flac',
          artistId: 7,
          albumId: 8,
          trackIds: [9],
          quality: { quality: { id: 7, name: 'FLAC' } },
          disableReleaseSwitching: false as const,
        },
      ]

      await client.manualImport(files)

      expect(mockPost).toHaveBeenCalledWith('/api/v1/command', {
        name: 'ManualImport',
        importMode: 'move',
        replaceExistingFiles: false,
        files,
      })
    })

    it('reads command status and album track file state', async () => {
      mockGet
        .mockResolvedValueOnce({ id: 91, name: 'ManualImport', status: 'completed' })
        .mockResolvedValueOnce([{ id: 9, albumId: 8, hasFile: true }])
      const client = createLidarrClient(TEST_URL, TEST_KEY)

      await expect(client.getCommand(91)).resolves.toMatchObject({ status: 'completed' })
      await expect(client.getTracks(8)).resolves.toEqual([{ id: 9, albumId: 8, hasFile: true }])
      expect(mockGet).toHaveBeenNthCalledWith(1, '/api/v1/command/91')
      expect(mockGet).toHaveBeenNthCalledWith(2, '/api/v1/track?albumId=8')
    })
  })

  describe('testConnection()', () => {
    it('returns success:true when getQualityProfiles() resolves', async () => {
      mockGet.mockResolvedValueOnce(mockProfiles)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.testConnection()
      expect(result.success).toBe(true)
      expect(typeof result.message).toBe('string')
    })

    it('returns success:false with error message when getQualityProfiles() rejects', async () => {
      mockGet.mockRejectedValueOnce(new Error('connection refused'))
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.testConnection()
      expect(result.success).toBe(false)
      expect(result.message).toMatch(/connection refused/)
    })
  })
})

// digarr's monitor vocabulary and Lidarr's MonitorTypes enum drifted apart once
// already (#611): `new` was forwarded verbatim and rejected with a 400. Mocks
// cannot catch that -- they accept any string -- so pin both ends here.
describe('monitor vocabulary', () => {
  // NzbDrone.Core.Music.MonitorTypes, lowercased as the API serializes it.
  // Source: src/NzbDrone.Core/Music/Model/MonitorTypes.cs
  const LIDARR_MONITOR_TYPE_MEMBERS = [
    'all',
    'future',
    'missing',
    'existing',
    'latest',
    'first',
    'none',
    'unknown',
  ]

  it('maps every digarr monitor option onto a real Lidarr MonitorTypes member', () => {
    for (const target of Object.values(LIDARR_MONITOR_TYPES)) {
      expect(LIDARR_MONITOR_TYPE_MEMBERS).toContain(target)
    }
  })

  it('handles every monitorOptionSchema value somewhere in the chain', () => {
    // `selected` collapses to `none` in the Lidarr target and `popular` becomes
    // `selected` in the approve route, so neither reaches the client. Every
    // other value must have a mapping here.
    const TRANSLATED_UPSTREAM = ['selected', 'popular']
    const handled = [...Object.keys(LIDARR_MONITOR_TYPES), ...TRANSLATED_UPSTREAM]

    for (const option of monitorOptionSchema.options) {
      expect(handled).toContain(option)
    }
  })
})
