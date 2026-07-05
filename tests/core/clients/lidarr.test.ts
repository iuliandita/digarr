// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AddArtistOptions,
  LidarrAlbum,
  LidarrArtist,
  MetadataProfile,
  QualityProfile,
  RootFolder,
} from '@/core/clients/lidarr'
import { createLidarrClient } from '@/core/clients/lidarr'

// Mock the HTTP client module so we never hit a real server.
const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPut = vi.fn()

vi.mock('@/core/clients/http', () => ({
  createHttpClient: vi.fn(() => ({
    get: mockGet,
    post: mockPost,
    put: mockPut,
    delete: vi.fn(),
  })),
}))

const { createHttpClient } = await import('@/core/clients/http')

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
    it('GETs /api/v1/artist and returns artist array', async () => {
      mockGet.mockResolvedValueOnce(mockArtists)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.getArtists()
      expect(mockGet).toHaveBeenCalledWith('/api/v1/artist')
      expect(result).toEqual(mockArtists)
    })
  })

  describe('lookupArtist()', () => {
    it('GETs /api/v1/artist/lookup with encoded term', async () => {
      const searchResults = [mockArtists[0]]
      mockGet.mockResolvedValueOnce(searchResults)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.lookupArtist('Radiohead')
      expect(mockGet).toHaveBeenCalledWith('/api/v1/artist/lookup?term=Radiohead')
      expect(result).toEqual(searchResults)
    })

    it('URL-encodes terms with special characters', async () => {
      mockGet.mockResolvedValueOnce([])
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.lookupArtist('At the Drive-In')
      expect(mockGet).toHaveBeenCalledWith('/api/v1/artist/lookup?term=At+the+Drive-In')
    })
  })

  describe('getQualityProfiles()', () => {
    it('GETs /api/v1/qualityprofile and returns profiles', async () => {
      mockGet.mockResolvedValueOnce(mockProfiles)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.getQualityProfiles()
      expect(mockGet).toHaveBeenCalledWith('/api/v1/qualityprofile')
      expect(result).toEqual(mockProfiles)
    })
  })

  describe('getRootFolders()', () => {
    it('GETs /api/v1/rootfolder and returns folders', async () => {
      mockGet.mockResolvedValueOnce(mockFolders)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.getRootFolders()
      expect(mockGet).toHaveBeenCalledWith('/api/v1/rootfolder')
      expect(result).toEqual(mockFolders)
    })
  })

  describe('addArtist()', () => {
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
          qualityProfileId: 1,
          rootFolderPath: '/music',
          monitored: true,
          addOptions: { monitor: 'none', searchForMissingAlbums: false },
        }),
      )
      expect(result).toMatchObject({ id: 10 })
    })

    it('throws if rootFolderId does not exist', async () => {
      mockLidarrGets()
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await expect(client.addArtist('mbid-xyz', 'Unknown', 1, 1, 999)).rejects.toThrow(
        /root folder/i,
      )
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

    it('defaults to monitor:"none" and searchForMissingAlbums:false when no options provided', async () => {
      mockLidarrGets()
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 12 })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, 1)

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({
          addOptions: { monitor: 'none', searchForMissingAlbums: false },
        }),
      )
    })

    it('uses monitorOption:"new" and sets searchForMissingAlbums:false', async () => {
      mockLidarrGets()
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 13 })

      const options: AddArtistOptions = { monitorOption: 'new' }
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, 1, options)

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({
          addOptions: { monitor: 'new', searchForMissingAlbums: false },
        }),
      )
    })

    it('uses monitorOption:"none" and sets searchForMissingAlbums:false', async () => {
      mockLidarrGets()
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 14 })

      const options: AddArtistOptions = { monitorOption: 'none' }
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, 1, options)

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({
          addOptions: { monitor: 'none', searchForMissingAlbums: false },
        }),
      )
    })

    it('uses monitorOption:"all" explicitly and sets searchForMissingAlbums:true', async () => {
      mockLidarrGets()
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 15 })

      const options: AddArtistOptions = { monitorOption: 'all' }
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, 1, options)

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({
          addOptions: { monitor: 'all', searchForMissingAlbums: true },
        }),
      )
    })

    it('uses first available folder when rootFolderId is undefined (id not 1)', async () => {
      const altFolders: RootFolder[] = [
        { id: 5, path: '/music5', freeSpace: 10_000_000_000 },
        { id: 7, path: '/music7', freeSpace: 5_000_000_000 },
      ]
      mockLidarrGets({ folders: altFolders })
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 20 })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1)

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({ rootFolderPath: '/music5' }),
      )
    })

    it('uses first available folder when rootFolderId is null', async () => {
      const altFolders: RootFolder[] = [
        { id: 5, path: '/music5', freeSpace: 10_000_000_000 },
        { id: 7, path: '/music7', freeSpace: 5_000_000_000 },
      ]
      mockLidarrGets({ folders: altFolders })
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 21 })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, null)

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({ rootFolderPath: '/music5' }),
      )
    })

    it('uses the explicit folder path when a valid rootFolderId is provided', async () => {
      mockLidarrGets()
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 22 })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, 2)

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({ rootFolderPath: '/music2' }),
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

    it('snaps a stale qualityProfileId to the first available profile', async () => {
      mockLidarrGets({ qualityProfiles: [{ id: 3, name: 'Stefan' }] })
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 23 })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, 1)

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({ qualityProfileId: 3 }),
      )
    })

    it('snaps a stale metadataProfileId to the first available profile', async () => {
      mockLidarrGets({ metadataProfiles: [{ id: 5, name: 'Custom' }] })
      mockPost.mockResolvedValueOnce({ ...mockArtists[0], id: 24 })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.addArtist('a74b1b7f-71a5-4011-9441-d0b5e4122711', 'Radiohead', 1, 1, 1)

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/artist',
        expect.objectContaining({ metadataProfileId: 5 }),
      )
    })

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

    it('GETs /api/v1/album with artistId query param', async () => {
      mockGet.mockResolvedValueOnce(mockAlbums)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.getAlbums(1)
      expect(mockGet).toHaveBeenCalledWith('/api/v1/album?artistId=1')
      expect(result).toEqual(mockAlbums)
    })

    it('passes the correct artistId in the URL', async () => {
      mockGet.mockResolvedValueOnce([])
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.getAlbums(42)
      expect(mockGet).toHaveBeenCalledWith('/api/v1/album?artistId=42')
    })

    it('returns empty array when artist has no albums', async () => {
      mockGet.mockResolvedValueOnce([])
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.getAlbums(99)
      expect(result).toEqual([])
    })
  })

  describe('getWantedMissing()', () => {
    it('GETs /api/v1/wanted/missing and returns the trimmed wanted payload', async () => {
      mockGet.mockResolvedValueOnce([
        {
          id: 44,
          title: 'Geogaddi',
          artistId: 7,
          foreignAlbumId: 'album-mbid-44',
          artist: {
            id: 7,
            artistName: 'Boards of Canada',
            foreignArtistId: '11111111-1111-1111-1111-111111111111',
          },
        },
      ])

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.getWantedMissing()

      expect(mockGet).toHaveBeenCalledWith('/api/v1/wanted/missing')
      expect(result).toEqual([
        {
          id: 44,
          title: 'Geogaddi',
          artistId: 7,
          foreignAlbumId: 'album-mbid-44',
          artist: {
            id: 7,
            artistName: 'Boards of Canada',
            foreignArtistId: '11111111-1111-1111-1111-111111111111',
          },
        },
      ])
    })

    it('reads paginated wanted responses from the records array', async () => {
      mockGet.mockResolvedValueOnce({
        page: 1,
        pageSize: 10,
        totalRecords: 1,
        records: [
          {
            id: 44,
            title: 'Geogaddi',
            artistId: 7,
            foreignAlbumId: 'album-mbid-44',
            artist: {
              id: 7,
              artistName: 'Boards of Canada',
              foreignArtistId: '11111111-1111-1111-1111-111111111111',
            },
          },
        ],
      })

      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.getWantedMissing()

      expect(result).toEqual([
        {
          id: 44,
          title: 'Geogaddi',
          artistId: 7,
          foreignAlbumId: 'album-mbid-44',
          artist: {
            id: 7,
            artistName: 'Boards of Canada',
            foreignArtistId: '11111111-1111-1111-1111-111111111111',
          },
        },
      ])
    })
  })

  describe('setArtistsMonitored()', () => {
    // Regression #393 class: monitor flips must use the bulk editor endpoint
    // (see the rationale comment in src/core/clients/lidarr.ts).
    it('PUTs artistIds and monitored to /api/v1/artist/editor', async () => {
      const updated = [{ ...mockArtists[0], monitored: false }]
      mockPut.mockResolvedValueOnce(updated)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.setArtistsMonitored([1], false)
      expect(mockPut).toHaveBeenCalledWith('/api/v1/artist/editor', {
        artistIds: [1],
        monitored: false,
      })
      expect(result).toEqual(updated)
    })

    it('sends multiple artist ids in one call', async () => {
      mockPut.mockResolvedValueOnce(mockArtists)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.setArtistsMonitored([1, 2], true)
      expect(mockPut).toHaveBeenCalledWith('/api/v1/artist/editor', {
        artistIds: [1, 2],
        monitored: true,
      })
    })
  })

  describe('setAlbumsMonitored()', () => {
    const mockAlbum: LidarrAlbum = {
      id: 101,
      title: 'OK Computer',
      artistId: 1,
      foreignAlbumId: 'a0a0a0a0-0000-0000-0000-000000000001',
      monitored: true,
      albumType: 'Album',
    }

    // Regression #393: monitor flips must use the bulk monitor endpoint
    // (see the rationale comment in src/core/clients/lidarr.ts).
    it('PUTs albumIds and monitored:true to /api/v1/album/monitor', async () => {
      mockPut.mockResolvedValueOnce([{ ...mockAlbum, monitored: true }])
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.setAlbumsMonitored([101], true)
      expect(mockPut).toHaveBeenCalledWith('/api/v1/album/monitor', {
        albumIds: [101],
        monitored: true,
      })
      expect(result[0]?.monitored).toBe(true)
    })

    it('PUTs monitored:false', async () => {
      mockPut.mockResolvedValueOnce([{ ...mockAlbum, monitored: false }])
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.setAlbumsMonitored([101], false)
      expect(mockPut).toHaveBeenCalledWith('/api/v1/album/monitor', {
        albumIds: [101],
        monitored: false,
      })
      expect(result[0]?.monitored).toBe(false)
    })

    it('sends multiple album ids in one call', async () => {
      mockPut.mockResolvedValueOnce([mockAlbum, { ...mockAlbum, id: 202 }])
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.setAlbumsMonitored([101, 202], true)
      expect(mockPut).toHaveBeenCalledWith('/api/v1/album/monitor', {
        albumIds: [101, 202],
        monitored: true,
      })
    })
  })

  describe('triggerCommand()', () => {
    it('POSTs to /api/v1/command with name only when no extra body', async () => {
      const mockCmd = { id: 55, name: 'RescanArtist', status: 'queued' }
      mockPost.mockResolvedValueOnce(mockCmd)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.triggerCommand('RescanArtist')
      expect(mockPost).toHaveBeenCalledWith('/api/v1/command', { name: 'RescanArtist' })
      expect(result).toEqual(mockCmd)
    })

    it('merges extra body fields into the command payload', async () => {
      const mockCmd = { id: 56, name: 'ArtistSearch', status: 'queued' }
      mockPost.mockResolvedValueOnce(mockCmd)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      await client.triggerCommand('ArtistSearch', { artistId: 1 })
      expect(mockPost).toHaveBeenCalledWith('/api/v1/command', {
        name: 'ArtistSearch',
        artistId: 1,
      })
    })

    it('returns the command object with id, name, status', async () => {
      const mockCmd = { id: 57, name: 'RefreshArtist', status: 'started' }
      mockPost.mockResolvedValueOnce(mockCmd)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.triggerCommand('RefreshArtist', { artistId: 2 })
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'RefreshArtist')
      expect(result).toHaveProperty('status')
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

    it('returns ServiceTestResult shape (success, message)', async () => {
      mockGet.mockResolvedValueOnce(mockProfiles)
      const client = createLidarrClient(TEST_URL, TEST_KEY)
      const result = await client.testConnection()
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('message')
    })
  })
})
