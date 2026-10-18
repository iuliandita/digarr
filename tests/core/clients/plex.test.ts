// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpClient } from '@/core/clients/http'
import { createPlexClient } from '@/core/clients/plex'

const mockGet = vi.fn()

vi.mock('@/core/clients/http', () => ({
  createHttpClient: vi.fn(() => ({
    get: mockGet,
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}))

beforeEach(() => {
  mockGet.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const TEST_URL = 'http://plex.local:32400'
const TEST_TOKEN = 'test-plex-token'
const LISTENING_OPTIONS = {
  sectionId: '1',
  accountId: 7,
  machineIdentifier: 'machine-1',
}

const historyRow = (accountID: number, title: string) => ({
  type: 'track',
  accountID,
  librarySectionID: 1,
  grandparentRatingKey: `artist-${accountID}`,
  grandparentTitle: `Artist ${accountID}`,
  ratingKey: `track-${accountID}`,
  title,
  viewedAt: 1710000000,
})

const row = {
  type: 'track',
  accountID: 7,
  librarySectionID: 1,
  grandparentKey: '/library/metadata/101',
  grandparentTitle: 'Portishead',
  key: '/library/metadata/102',
  title: 'Roads',
  viewedAt: 1710000000,
}

const TWO_SECTIONS = {
  MediaContainer: {
    Directory: [
      { key: '3', type: 'artist', title: 'Audiobooks' },
      { key: '5', type: 'artist', title: 'Music' },
      { key: '7', type: 'movie', title: 'Movies' },
    ],
  },
}

const sections = {
  MediaContainer: {
    Directory: [
      { key: '7', type: 'movie', title: 'Movies' },
      { key: '3', type: 'artist', title: 'Music' },
      { key: '5', type: 'artist', title: 'Other music' },
    ],
  },
}
const track = {
  type: 'track',
  title: 'Roads',
  grandparentTitle: 'Portishead',
  duration: 302500,
  Media: [{ Part: [{ file: '/music/Portishead/Roads.flac' }] }],
}

function historyResponse(metadata: unknown[], totalSize = metadata.length) {
  return { MediaContainer: { Metadata: metadata, totalSize } }
}

function albumRow(ratingKey: string, title: string, year: number) {
  return { ratingKey, parentRatingKey: 'artist-1', title, year }
}

const IDENTITY_RESPONSE = { MediaContainer: { machineIdentifier: 'machine-1' } }

describe('plex history metadata paths', () => {
  const mockWarn = vi.fn()

  beforeEach(() => {
    mockWarn.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(mockWarn)
  })

  it.each(['recent', 'top'] as const)(
    'uses metadata paths for %s listening history',
    async (method) => {
      mockGet.mockResolvedValueOnce(IDENTITY_RESPONSE).mockResolvedValueOnce({
        MediaContainer: {
          totalSize: 2,
          Metadata: [row, { ...row, key: '/library/metadata/103', title: 'Wandering Star' }],
        },
      })
      const client = createPlexClient(TEST_URL, TEST_TOKEN, LISTENING_OPTIONS)

      if (method === 'recent') {
        await expect(client.getRecentlyPlayed()).resolves.toEqual([
          {
            artistName: 'Portishead',
            trackName: 'Roads',
            artistRatingKey: '101',
            viewedAt: 1710000000000,
          },
          {
            artistName: 'Portishead',
            trackName: 'Wandering Star',
            artistRatingKey: '101',
            viewedAt: 1710000000000,
          },
        ])
      } else {
        await expect(client.getTopArtists()).resolves.toEqual([
          { name: 'Portishead', ratingKey: '101', viewCount: 2, genres: [] },
        ])
      }
      expect(mockWarn).not.toHaveBeenCalled()
    },
  )

  it.each([
    { grandparentRatingKey: '201', ratingKey: '202' },
    { grandparentRatingKey: 201, ratingKey: 202 },
    { grandparentRatingKey: 'artist-201', ratingKey: 'track-202' },
  ])('prefers bare rating keys over metadata paths: %j', async (keys) => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: { totalSize: 1, Metadata: [{ ...row, ...keys }] },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    const history = await client.getHistory({ accountId: 7, librarySectionId: '1' })

    expect(history).toEqual([
      expect.objectContaining({
        artistRatingKey: String(keys.grandparentRatingKey),
        ratingKey: String(keys.ratingKey),
      }),
    ])
  })

  it.each([
    { grandparentKey: undefined, key: undefined },
    { grandparentKey: '/removed/101', key: '/removed/102' },
    {
      grandparentKey: 'https://plex.local/library/metadata/101',
      key: 'https://plex.local/library/metadata/102',
    },
    { grandparentKey: '/library/metadata/101/children', key: '/library/metadata/102?token=secret' },
    { grandparentKey: '/library/metadata/', key: '/library/metadata/' },
  ])('skips invalid or removed metadata paths: %j', async (keys) => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: { totalSize: 2, Metadata: [{ ...row, ...keys }, row] },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    const history = await client.getHistory({ accountId: 7, librarySectionId: '1' })

    expect(history).toEqual([expect.objectContaining({ artistRatingKey: '101', ratingKey: '102' })])
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('warns with counts only when all track candidates have malformed required fields', async () => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 3,
        Metadata: [
          { ...row, grandparentTitle: 123 },
          { ...row, title: '' },
          { ...row, viewedAt: undefined },
        ],
      },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    await expect(client.getHistory({ accountId: 7, librarySectionId: '1' })).resolves.toEqual([])

    expect(mockWarn).toHaveBeenCalledExactlyOnceWith(
      '[plex] History page contained 3 track entries but 0 usable tracks; required fields are missing or malformed',
    )
  })

  it.each([
    { name: 'empty', metadata: [] },
    { name: 'non-track', metadata: [{ ...row, type: 'movie' }] },
    { name: 'outside since', metadata: [{ ...row, viewedAt: 1600000000 }] },
  ])('does not warn for $name history pages', async ({ metadata }) => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: { totalSize: metadata.length, Metadata: metadata },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    await expect(
      client.getHistory({ accountId: 7, librarySectionId: '1', since: 1700000000 }),
    ).resolves.toEqual([])

    expect(mockWarn).not.toHaveBeenCalled()
  })
})

describe('plex client.getTopArtists()', () => {
  it('aggregates the selected account history instead of library-wide view counts', async () => {
    mockGet.mockResolvedValueOnce(IDENTITY_RESPONSE).mockResolvedValueOnce(
      historyResponse([
        {
          ...historyRow(7, 'Roads'),
          grandparentRatingKey: '101',
          grandparentTitle: 'Portishead',
          ratingKey: '101',
        },
        {
          ...historyRow(7, 'Wandering Star'),
          grandparentRatingKey: '101',
          grandparentTitle: 'Portishead',
          ratingKey: '102',
          viewedAt: 1709990000,
        },
        {
          ...historyRow(7, 'Teardrop'),
          grandparentRatingKey: '201',
          grandparentTitle: 'Massive Attack',
          ratingKey: '202',
          viewedAt: 1709980000,
        },
      ]),
    )
    const client = createPlexClient(TEST_URL, TEST_TOKEN, LISTENING_OPTIONS)
    await expect(client.getTopArtists(10)).resolves.toEqual([
      { ratingKey: '101', name: 'Portishead', viewCount: 2, genres: [] },
      { ratingKey: '201', name: 'Massive Attack', viewCount: 1, genres: [] },
    ])
    expect(mockGet.mock.calls[1]?.[0]).toContain('accountID=7')
    expect(mockGet.mock.calls[1]?.[0]).toContain('librarySectionID=1')
  })
})

describe('plex client history isolation', () => {
  it('keeps two listeners on the same server in disjoint account-filtered requests', async () => {
    mockGet
      .mockResolvedValueOnce(historyResponse([historyRow(7, 'Seven')], 1))
      .mockResolvedValueOnce(historyResponse([historyRow(8, 'Eight')], 1))
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    const first = await client.getHistory({ accountId: 7, librarySectionId: '1' })
    const second = await client.getHistory({ accountId: 8, librarySectionId: '1' })

    expect(first.map((item) => item.trackName)).toEqual(['Seven'])
    expect(second.map((item) => item.trackName)).toEqual(['Eight'])
    expect(mockGet.mock.calls[0]?.[0]).toContain('accountID=7')
    expect(mockGet.mock.calls[1]?.[0]).toContain('accountID=8')
  })

  it.each([
    {
      name: 'account',
      row: historyRow(8, 'Wrong listener'),
      message: 'account 8 while account 7 was requested',
    },
    {
      name: 'section',
      row: { ...historyRow(7, 'Wrong library'), librarySectionID: 2 },
      message: 'library section 2 while section 1 was requested',
    },
  ])('fails closed for a different $name in a history response', async ({ row, message }) => {
    mockGet.mockResolvedValueOnce(historyResponse([row]))
    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    await expect(client.getHistory({ accountId: 7, librarySectionId: '1' })).rejects.toThrow(
      message,
    )
  })

  it('drops rows older than since when Plex ignores the upstream time filter', async () => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 2,
        Metadata: [
          historyRow(7, 'In range'),
          { ...historyRow(7, 'Too old'), viewedAt: 1600000000 },
        ],
      },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    const history = await client.getHistory({
      accountId: 7,
      librarySectionId: '1',
      since: 1700000000,
    })

    expect(history.map((item) => item.trackName)).toEqual(['In range'])
    expect(mockGet.mock.calls[0]?.[0]).toContain('viewedAt%3E%3D=1700000000')
  })

  it('honors the explicit page bound even when Plex reports more history', async () => {
    mockGet
      .mockResolvedValueOnce(historyResponse([historyRow(7, 'One')], 50))
      .mockResolvedValueOnce(historyResponse([historyRow(7, 'Two')], 50))
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    const history = await client.getHistory({
      accountId: 7,
      librarySectionId: '1',
      pageSize: 1,
      maxPages: 2,
    })

    expect(history).toHaveLength(2)
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(mockGet.mock.calls[1]?.[0]).toContain('X-Plex-Container-Start=1')
  })

  it.each([
    {
      name: 'item',
      totalSize: 3,
      rows: [historyRow(7, 'One'), historyRow(7, 'Two')],
      pageSize: undefined,
      maxPages: undefined,
      message: 'bounded retrieval limit (2 items or 25 pages)',
    },
    {
      name: 'page',
      totalSize: 2,
      rows: [historyRow(7, 'One')],
      pageSize: 1,
      maxPages: 1,
      message: 'bounded retrieval limit (2 items or 1 pages)',
    },
  ])(
    'rejects incomplete history at its $name cap',
    async ({ totalSize, rows, pageSize, maxPages, message }) => {
      mockGet.mockResolvedValueOnce(historyResponse(rows, totalSize))
      const client = createPlexClient(TEST_URL, TEST_TOKEN)
      await expect(
        client.getHistory({
          accountId: 7,
          librarySectionId: '1',
          pageSize,
          maxItems: 2,
          maxPages,
          requireComplete: true,
        }),
      ).rejects.toThrow(message)
    },
  )

  it('accepts an exact-cap complete history when Plex reports the total', async () => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 2,
        Metadata: [historyRow(7, 'One'), historyRow(7, 'Two')],
      },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    const history = await client.getHistory({
      accountId: 7,
      librarySectionId: '1',
      maxItems: 2,
      requireComplete: true,
    })

    expect(history.map((item) => item.trackName)).toEqual(['One', 'Two'])
  })
})

describe('plex client similar artists', () => {
  it('returns an empty list when artist metadata has no Similar entries', async () => {
    mockGet
      .mockResolvedValueOnce(IDENTITY_RESPONSE)
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [{}] } })
    const client = createPlexClient(TEST_URL, TEST_TOKEN, LISTENING_OPTIONS)

    await expect(client.getSimilarArtists('artist-1')).resolves.toEqual([])
  })

  it('surfaces metadata request failures to the pipeline fail-soft boundary', async () => {
    mockGet
      .mockResolvedValueOnce(IDENTITY_RESPONSE)
      .mockRejectedValueOnce(new Error('metadata unavailable'))
    const client = createPlexClient(TEST_URL, TEST_TOKEN, LISTENING_OPTIONS)

    await expect(client.getSimilarArtists('artist-1')).rejects.toThrow('metadata unavailable')
  })
})

describe('plex client.getAllArtists()', () => {
  it('paginates through the music library', async () => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        Directory: [{ key: '1', type: 'artist', title: 'Music' }],
      },
    })
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 3,
        Metadata: [
          { ratingKey: '101', title: 'Bush', Genre: [{ tag: 'rock' }] },
          { ratingKey: '102', title: 'Portishead', Genre: [{ tag: 'trip hop' }] },
        ],
      },
    })
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 3,
        Metadata: [{ ratingKey: '103', title: 'Radiohead', Genre: [{ tag: 'art rock' }] }],
      },
    })

    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    const artists = await client.getAllArtists({ pageSize: 2 })

    expect(artists).toEqual([
      { ratingKey: '101', name: 'Bush', genres: ['rock'] },
      { ratingKey: '102', name: 'Portishead', genres: ['trip hop'] },
      { ratingKey: '103', name: 'Radiohead', genres: ['art rock'] },
    ])
  })

  it('returns empty array when library is empty', async () => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        Directory: [{ key: '1', type: 'artist', title: 'Music' }],
      },
    })
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 0,
        Metadata: [],
      },
    })

    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    const artists = await client.getAllArtists({ pageSize: 100 })

    expect(artists).toEqual([])
  })
})

describe('plex library section selection', () => {
  it('getMusicSections returns only artist-type sections', async () => {
    mockGet.mockResolvedValueOnce(TWO_SECTIONS)
    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    const sections = await client.getMusicSections()
    expect(sections).toEqual([
      { key: '3', title: 'Audiobooks' },
      { key: '5', title: 'Music' },
    ])
  })

  it('uses the configured section without hitting /library/sections', async () => {
    mockGet.mockResolvedValueOnce({
      MediaContainer: {
        totalSize: 1,
        Metadata: [{ ratingKey: '201', title: 'Radiohead', Genre: [] }],
      },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN, { sectionId: '5' })
    const artists = await client.getAllArtists()
    expect(artists).toHaveLength(1)
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockGet.mock.calls[0]?.[0]).toContain('/library/sections/5/all')
  })

  it('auto-picks the first artist section when none is configured', async () => {
    mockGet.mockResolvedValueOnce(TWO_SECTIONS)
    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    await expect(client.getMusicSectionId()).resolves.toBe('3')
  })

  it('testConnection reports the selected library and all music sections', async () => {
    mockGet
      .mockResolvedValueOnce(IDENTITY_RESPONSE)
      .mockResolvedValueOnce(TWO_SECTIONS)
      .mockResolvedValueOnce({
        MediaContainer: { Account: [{ id: 7, name: 'Listener' }] },
      })
    const client = createPlexClient(TEST_URL, TEST_TOKEN, { sectionId: '5' })
    const result = await client.testConnection()
    expect(result.success).toBe(true)
    expect(result.message).toContain('"Music"')
    expect(result.details).toEqual({
      sectionId: '5',
      sections: [
        { key: '3', title: 'Audiobooks' },
        { key: '5', title: 'Music' },
      ],
      machineIdentifier: 'machine-1',
      accounts: [{ id: 7, name: 'Listener' }],
    })
  })

  it('testConnection fails when the configured section no longer exists', async () => {
    mockGet.mockResolvedValueOnce(IDENTITY_RESPONSE).mockResolvedValueOnce(TWO_SECTIONS)
    const client = createPlexClient(TEST_URL, TEST_TOKEN, { sectionId: '99' })
    const result = await client.testConnection()
    expect(result.success).toBe(false)
    expect(result.message).toContain('99')
    expect(result.message).toContain('Music (5)')
  })

  it('testConnection fails when no music sections exist', async () => {
    mockGet.mockResolvedValueOnce(IDENTITY_RESPONSE).mockResolvedValueOnce({
      MediaContainer: { Directory: [{ key: '7', type: 'movie', title: 'Movies' }] },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    const result = await client.testConnection()
    expect(result.success).toBe(false)
    expect(result.message).toContain('No music library section')
  })
})

describe('plex client.getAlbumsForArtist()', () => {
  it.each([
    {
      name: 'partial first page without totalSize',
      pages: [{ Metadata: [albumRow('alb-final', 'A Moon Shaped Pool', 2016)] }],
      expected: [
        {
          ratingKey: 'alb-final',
          artistRatingKey: 'artist-1',
          title: 'A Moon Shaped Pool',
          releaseYear: 2016,
          primaryType: 'Album',
        },
      ],
    },
    {
      name: 'multiple pages retaining the first totalSize',
      pages: [
        {
          totalSize: 5,
          Metadata: [albumRow('alb-1', 'Kid A', 2000), albumRow('alb-2', 'Amnesiac', 2001)],
        },
        {
          Metadata: [
            albumRow('alb-3', 'Hail to the Thief', 2003),
            albumRow('alb-4', 'In Rainbows', 2007),
          ],
        },
        { Metadata: [albumRow('alb-5', 'The King of Limbs', 2011)] },
      ],
      expected: [
        {
          ratingKey: 'alb-1',
          artistRatingKey: 'artist-1',
          title: 'Kid A',
          releaseYear: 2000,
          primaryType: 'Album',
        },
        {
          ratingKey: 'alb-2',
          artistRatingKey: 'artist-1',
          title: 'Amnesiac',
          releaseYear: 2001,
          primaryType: 'Album',
        },
        {
          ratingKey: 'alb-3',
          artistRatingKey: 'artist-1',
          title: 'Hail to the Thief',
          releaseYear: 2003,
          primaryType: 'Album',
        },
        {
          ratingKey: 'alb-4',
          artistRatingKey: 'artist-1',
          title: 'In Rainbows',
          releaseYear: 2007,
          primaryType: 'Album',
        },
        {
          ratingKey: 'alb-5',
          artistRatingKey: 'artist-1',
          title: 'The King of Limbs',
          releaseYear: 2011,
          primaryType: 'Album',
        },
      ],
    },
  ])('collects albums from $name', async ({ pages, expected }) => {
    for (const page of pages) mockGet.mockResolvedValueOnce({ MediaContainer: page })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    await expect(client.getAlbumsForArtist('artist-1')).resolves.toEqual(expected)
  })
})

describe('plex client.searchTracks()', () => {
  it.each([
    { sectionId: '5', expectedSection: '5', token: 'selected-user-token', limit: 2 },
    { sectionId: undefined, expectedSection: '3', token: 'fallback-user-token', limit: 200 },
  ])('bounds search to the authorized section and token: %j', async (options) => {
    mockGet
      .mockResolvedValueOnce(sections)
      .mockResolvedValueOnce({ MediaContainer: { Metadata: [] } })
    const client = createPlexClient(TEST_URL, options.token, { sectionId: options.sectionId })

    await client.searchTracks(' AC/DC & Friends? ', options.limit)

    expect(createHttpClient).toHaveBeenLastCalledWith({
      baseUrl: TEST_URL,
      headers: { 'X-Plex-Token': options.token, Accept: 'application/json' },
    })
    expect(mockGet.mock.calls[0]?.[0]).toBe('/library/sections')
    const request = new URL(String(mockGet.mock.calls[1]?.[0]), TEST_URL)
    expect(request.pathname).toBe(`/library/sections/${options.expectedSection}/all`)
    expect(Object.fromEntries(request.searchParams)).toEqual({
      type: '10',
      sourceType: '8',
      'title=': 'AC/DC & Friends?',
      limit: String(Math.min(options.limit, 100)),
      'X-Plex-Container-Start': '0',
      'X-Plex-Container-Size': String(Math.min(options.limit, 100)),
    })
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('maps actual artist, file paths and milliseconds while omitting incomplete tracks', async () => {
    mockGet.mockResolvedValueOnce(sections).mockResolvedValueOnce({
      MediaContainer: {
        librarySectionID: 3,
        Metadata: [
          track,
          { ...track, grandparentTitle: 'Another credit', duration: Number.NaN },
          { ...track, duration: -1, Media: [{ Part: [{}, { file: '/music/alternate.flac' }] }] },
          { ...track, title: ' ' },
          { ...track, grandparentTitle: undefined },
          { ...track, Media: [{ Part: [{ key: '/library/parts/1/file.flac' }] }] },
          { ...track, type: 'album' },
        ],
      },
    })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    await expect(client.searchTracks('Portishead')).resolves.toEqual([
      {
        name: 'Roads',
        artist: 'Portishead',
        path: '/music/Portishead/Roads.flac',
        duration: 302.5,
      },
      { name: 'Roads', artist: 'Another credit', path: '/music/Portishead/Roads.flac' },
      { name: 'Roads', artist: 'Portishead', path: '/music/alternate.flac' },
    ])
  })

  it.each(['99', '7', 'none'])('refuses missing or non-music sections: %s', async (sectionId) => {
    mockGet.mockResolvedValueOnce(
      sectionId === 'none' ? { MediaContainer: { Directory: [] } } : sections,
    )
    const client = createPlexClient(TEST_URL, TEST_TOKEN, {
      sectionId: sectionId === 'none' ? undefined : sectionId,
    })

    await expect(client.searchTracks('Portishead')).rejects.toThrow(/music library section/i)
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it.each([
    null,
    {},
    { MediaContainer: { Metadata: {} } },
    { MediaContainer: { Metadata: null } },
    { MediaContainer: { Metadata: [null] } },
    { MediaContainer: { Metadata: [[]] } },
    { MediaContainer: { librarySectionID: 5, Metadata: [] } },
    { MediaContainer: { Metadata: [{ ...track, librarySectionID: 5 }] } },
  ])('rejects malformed or cross-section search responses: %j', async (response) => {
    mockGet.mockResolvedValueOnce(sections).mockResolvedValueOnce(response)
    const client = createPlexClient(TEST_URL, TEST_TOKEN)

    await expect(client.searchTracks('Portishead')).rejects.toThrow(/Plex/)
  })

  it('accepts empty results and avoids unbounded searches for empty or invalid input', async () => {
    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    await expect(client.searchTracks(' ')).resolves.toEqual([])
    await expect(client.searchTracks('Portishead', 0)).resolves.toEqual([])
    await expect(client.searchTracks('Portishead', Number.NaN)).rejects.toThrow(/finite limit/)
    expect(mockGet).not.toHaveBeenCalled()
    mockGet.mockResolvedValueOnce(sections).mockResolvedValueOnce({ MediaContainer: {} })
    await expect(client.searchTracks('Portishead')).resolves.toEqual([])
    expect(new URL(String(mockGet.mock.calls[1]?.[0]), TEST_URL).searchParams.get('limit')).toBe(
      '25',
    )
  })
})

describe('plex edge cases (#926)', () => {
  it('getMusicSections treats a response without Directory as empty', async () => {
    mockGet.mockResolvedValueOnce({ MediaContainer: { size: 0 } })
    const client = createPlexClient(TEST_URL, TEST_TOKEN)
    await expect(client.getMusicSections()).resolves.toEqual([])
  })

  it('retries the identity check after a failed lookup', async () => {
    mockGet
      .mockRejectedValueOnce(new Error('plex down'))
      .mockResolvedValueOnce(IDENTITY_RESPONSE)
      .mockResolvedValueOnce({ MediaContainer: { totalSize: 0, Metadata: [] } })
    const client = createPlexClient(TEST_URL, TEST_TOKEN, LISTENING_OPTIONS)
    await expect(client.getRecentlyPlayed()).rejects.toThrow('plex down')
    await expect(client.getRecentlyPlayed()).resolves.toEqual([])
  })
})
