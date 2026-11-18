// @vitest-environment node
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSubsonicClient } from '@/core/clients/subsonic'

const mockGet = vi.fn()
const queueMocks = vi.hoisted(() => {
  const add = vi.fn((task: () => unknown) => task())
  return { add, create: vi.fn(() => ({ add })) }
})

vi.mock('@/core/clients/http', () => ({
  createHttpClient: vi.fn(() => ({
    get: mockGet,
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}))

vi.mock('@/core/clients/media-server-queue', () => ({
  createMediaServerQueue: queueMocks.create,
}))

beforeEach(() => {
  mockGet.mockReset()
  queueMocks.add.mockClear()
  queueMocks.create.mockClear()
})

describe('subsonic media-server queue', () => {
  it('creates one queue per client instance', () => {
    createSubsonicClient('http://nav:4533', 'admin', 'secret')
    createSubsonicClient('http://nav:4533', 'listener', 'secret')

    expect(queueMocks.create).toHaveBeenCalledTimes(2)
  })
})

describe('subsonic client.getStarredArtists()', () => {
  it('maps starred2.artist[]', async () => {
    const client = createSubsonicClient('http://nav:4533', 'admin', 'secret')

    mockGet.mockResolvedValueOnce({
      'subsonic-response': {
        status: 'ok',
        starred2: {
          artist: [
            { id: 1, name: 'Bush' },
            { id: 'ar-2', name: 'Radiohead' },
          ],
        },
      },
    })

    const artists = await client.getStarredArtists()
    expect(artists).toEqual([
      { id: '1', name: 'Bush' },
      { id: 'ar-2', name: 'Radiohead' },
    ])
  })

  it('returns [] when starred2 is absent', async () => {
    const client = createSubsonicClient('http://nav:4533', 'admin', 'secret')

    mockGet.mockResolvedValueOnce({ 'subsonic-response': { status: 'ok' } })

    const artists = await client.getStarredArtists()
    expect(artists).toEqual([])
  })
})

describe('subsonic client.getAllArtists()', () => {
  it('flattens artists.index[].artist[]', async () => {
    const client = createSubsonicClient('http://nav:4533', 'admin', 'secret')

    mockGet.mockResolvedValueOnce({
      'subsonic-response': {
        status: 'ok',
        artists: {
          index: [
            { name: 'B', artist: [{ id: 'b1', name: 'Bush' }] },
            {
              name: 'R',
              artist: [
                { id: 'r1', name: 'Radiohead' },
                { id: 'r2', name: 'Rush' },
              ],
            },
            { name: 'X' },
          ],
        },
      },
    })

    const artists = await client.getAllArtists()
    expect(artists).toEqual([
      { id: 'b1', name: 'Bush' },
      { id: 'r1', name: 'Radiohead' },
      { id: 'r2', name: 'Rush' },
    ])
  })

  it('drops artists without an id', async () => {
    const client = createSubsonicClient('http://nav:4533', 'admin', 'secret')

    mockGet.mockResolvedValueOnce({
      'subsonic-response': {
        status: 'ok',
        artists: {
          index: [
            {
              name: 'R',
              artist: [{ id: 'r1', name: 'Radiohead' }, { name: 'No ID' }],
            },
          ],
        },
      },
    })

    const artists = await client.getAllArtists()
    expect(artists).toEqual([{ id: 'r1', name: 'Radiohead' }])
  })

  it('rejects on a failed envelope', async () => {
    const client = createSubsonicClient('http://nav:4533', 'admin', 'secret')

    mockGet.mockResolvedValueOnce({
      'subsonic-response': {
        status: 'failed',
        error: { code: 40, message: 'Wrong username or password' },
      },
    })

    await expect(client.getAllArtists()).rejects.toThrow('Wrong username or password')
  })

  it('throws a clean error (not a TypeError) on a non-Subsonic response body', async () => {
    // A reverse proxy login page or captive portal returns HTML/JSON with no
    // `subsonic-response` envelope. The old code did `body.status` on undefined.
    const client = createSubsonicClient('http://nav:4533', 'admin', 'secret')

    mockGet.mockResolvedValueOnce({ error: 'gateway', html: '<html>...' })

    const err = await client.getAllArtists().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(TypeError)
    expect((err as Error).message).toMatch(/Malformed Subsonic response/)
  })
})

describe('subsonic client.getAlbumsForArtist()', () => {
  it('maps artist.album[] including releaseYear and artistId fallback', async () => {
    const client = createSubsonicClient('http://nav:4533', 'admin', 'secret')

    mockGet.mockResolvedValueOnce({
      'subsonic-response': {
        status: 'ok',
        artist: {
          id: 'r1',
          name: 'Radiohead',
          album: [
            { id: 'alb-1', name: 'Kid A', artistId: 'r1', year: 2000 },
            { id: 2, name: 'Amnesiac' },
          ],
        },
      },
    })

    const albums = await client.getAlbumsForArtist('r1')
    expect(albums).toEqual([
      { id: 'alb-1', artistId: 'r1', title: 'Kid A', releaseYear: 2000 },
      { id: '2', artistId: 'r1', title: 'Amnesiac', releaseYear: undefined },
    ])
  })
})

describe('subsonic client.testConnection()', () => {
  it('reports success with server type and version', async () => {
    const client = createSubsonicClient('http://nav:4533', 'admin', 'secret')

    mockGet.mockResolvedValueOnce({
      'subsonic-response': { status: 'ok', version: '1.16.1', type: 'navidrome' },
    })

    const result = await client.testConnection()
    expect(result.success).toBe(true)
    expect(result.message).toContain('navidrome')
    expect(result.details?.version).toBe('1.16.1')
  })

  it('reports failure with the error message', async () => {
    const client = createSubsonicClient('http://nav:4533', 'admin', 'wrong')

    mockGet.mockResolvedValueOnce({
      'subsonic-response': {
        status: 'failed',
        error: { code: 40, message: 'Wrong username or password' },
      },
    })

    const result = await client.testConnection()
    expect(result.success).toBe(false)
    expect(result.message).toBe('Wrong username or password')
  })
})

describe('subsonic client auth params', () => {
  it('uses token auth and never leaks the plaintext password', async () => {
    const client = createSubsonicClient('http://nav:4533', 'admin', 'secret', { salt: 'abc123' })

    mockGet.mockResolvedValueOnce({ 'subsonic-response': { status: 'ok' } })
    await client.getStarredArtists()

    const path = mockGet.mock.calls[0]?.[0] as string
    const expectedToken = createHash('md5').update('secretabc123').digest('hex')

    expect(path).toContain('u=admin')
    expect(path).toContain('s=abc123')
    expect(path).toContain('f=json')
    expect(path).toContain(`t=${expectedToken}`)
    expect(path).not.toContain('secret')
  })

  it('reuses one salt for the lifetime of a client', async () => {
    const client = createSubsonicClient('http://nav:4533', 'admin', 'secret')

    mockGet.mockResolvedValue({ 'subsonic-response': { status: 'ok' } })
    await client.getStarredArtists()
    await client.getAllArtists()

    const salts = mockGet.mock.calls.map(([path]) =>
      new URL(String(path), 'http://nav').searchParams.get('s'),
    )
    expect(salts[0]).toMatch(/^[0-9a-f]{16}$/)
    expect(salts[1]).toBe(salts[0])
  })
})

describe('subsonic client.searchTracks()', () => {
  const song = {
    title: 'Roads',
    artist: 'Portishead',
    path: 'Portishead/Roads.flac',
    duration: 302,
  }

  it.each([
    { username: 'listener one', salt: 'salt-a', limit: 2 },
    { username: 'other&listener', salt: 'salt-b', limit: 200 },
  ])('uses the client credentials and encoded bounded song-only query: %j', async (options) => {
    mockGet.mockResolvedValueOnce({ 'subsonic-response': { status: 'ok', searchResult3: {} } })
    const client = createSubsonicClient('http://nav:4533', options.username, 'secret', {
      salt: options.salt,
    })

    await client.searchTracks(' AC/DC & Friends? ', options.limit)

    const request = new URL(String(mockGet.mock.calls[0]?.[0]), 'http://nav:4533')
    expect(request.pathname).toBe('/rest/search3')
    expect(Object.fromEntries(request.searchParams)).toEqual({
      u: options.username,
      t: createHash('md5').update(`secret${options.salt}`).digest('hex'),
      s: options.salt,
      v: '1.16.1',
      c: 'digarr',
      f: 'json',
      query: 'AC/DC & Friends?',
      artistCount: '0',
      albumCount: '0',
      songCount: String(Math.min(options.limit, 100)),
      songOffset: '0',
    })
    expect(queueMocks.add).toHaveBeenCalledTimes(1)
    expect(request.searchParams.has('p')).toBe(false)
  })

  it('maps real artist credits and paths with seconds while omitting incomplete tracks', async () => {
    mockGet.mockResolvedValueOnce({
      'subsonic-response': {
        status: 'ok',
        searchResult3: {
          song: [
            song,
            { ...song, artist: 'Another credit', duration: Number.POSITIVE_INFINITY },
            { ...song, duration: -1 },
            { ...song, title: ' ' },
            { ...song, artist: undefined },
            { ...song, path: undefined, id: 'song-1' },
            { ...song, path: ' ' },
          ],
        },
      },
    })
    const client = createSubsonicClient('http://nav:4533', 'listener', 'secret')

    await expect(client.searchTracks('Portishead')).resolves.toEqual([
      { name: 'Roads', artist: 'Portishead', path: 'Portishead/Roads.flac', duration: 302 },
      { name: 'Roads', artist: 'Another credit', path: 'Portishead/Roads.flac' },
      { name: 'Roads', artist: 'Portishead', path: 'Portishead/Roads.flac' },
    ])
  })

  it.each([
    null,
    {},
    { 'subsonic-response': { status: 'ok' } },
    { 'subsonic-response': { status: 'ok', searchResult3: null } },
    { 'subsonic-response': { status: 'ok', searchResult3: { song: {} } } },
    { 'subsonic-response': { status: 'ok', searchResult3: { song: null } } },
    { 'subsonic-response': { status: 'ok', searchResult3: { song: [null] } } },
    { 'subsonic-response': { status: 'ok', searchResult3: { song: [[]] } } },
  ])('rejects malformed successful responses: %j', async (response) => {
    mockGet.mockResolvedValueOnce(response)
    const client = createSubsonicClient('http://nav:4533', 'listener', 'secret')

    await expect(client.searchTracks('Portishead')).rejects.toThrow(/Malformed Subsonic/)
  })

  it.each(['envelope', 'network'])('surfaces %s failures', async (failure) => {
    if (failure === 'envelope') {
      mockGet.mockResolvedValueOnce({
        'subsonic-response': { status: 'failed', error: { code: 40, message: 'Access denied' } },
      })
    } else mockGet.mockRejectedValueOnce(new Error('Network unavailable'))
    const client = createSubsonicClient('http://nav:4533', 'listener', 'secret')

    await expect(client.searchTracks('Portishead')).rejects.toThrow(
      failure === 'envelope' ? 'Access denied' : 'Network unavailable',
    )
  })

  it('accepts empty results and avoids broad searches for empty or invalid input', async () => {
    const client = createSubsonicClient('http://nav:4533', 'listener', 'secret')
    await expect(client.searchTracks(' ')).resolves.toEqual([])
    await expect(client.searchTracks('Portishead', 0)).resolves.toEqual([])
    await expect(client.searchTracks('Portishead', Number.NaN)).rejects.toThrow(/finite limit/)
    expect(mockGet).not.toHaveBeenCalled()
    mockGet.mockResolvedValueOnce({ 'subsonic-response': { status: 'ok', searchResult3: {} } })
    await expect(client.searchTracks('Portishead')).resolves.toEqual([])
    expect(
      new URL(String(mockGet.mock.calls[0]?.[0]), 'http://nav').searchParams.get('songCount'),
    ).toBe('25')
  })
})

describe('Subsonic album hints and artist MBIDs', () => {
  it.each([0, 500, 501, 1000])('pages the full album listing for %i albums', async (count) => {
    const albums = Array.from({ length: count }, (_, i) => ({
      id: i,
      artistId: i % 2,
      name: `Album ${i}`,
      year: 2000,
    }))
    mockGet.mockImplementation(async (path: string) => {
      const params = new URL(path, 'http://nav').searchParams
      expect(params.get('type')).toBe('alphabeticalByArtist')
      expect(params.get('size')).toBe('500')
      const offset = Number(params.get('offset'))
      return {
        'subsonic-response': {
          status: 'ok',
          albumList2: { album: albums.slice(offset, offset + 500) },
        },
      }
    })
    const result = await createSubsonicClient('http://nav:4533', 'u', 'p').getAllAlbums()
    expect(result).toEqual(
      albums.map((a) => ({
        id: String(a.id),
        artistId: String(a.artistId),
        title: a.name,
        releaseYear: 2000,
      })),
    )
    expect(
      mockGet.mock.calls.map(([path]) =>
        new URL(String(path), 'http://nav').searchParams.get('offset'),
      ),
    ).toEqual(Array.from({ length: Math.floor(count / 500) + 1 }, (_, i) => String(i * 500)))
  })

  it.each([
    { count: 200, offsets: ['0', '100', '200'] },
    { count: 201, offsets: ['0', '100', '200'] },
    { count: 50, offsets: ['0', '50'] },
  ])(
    'uses actual offsets and the first-page size for $count server-capped albums',
    async ({ count, offsets }) => {
      const albums = Array.from({ length: count }, (_, id) => ({
        id,
        artistId: '1',
        name: `Album ${id}`,
      }))
      mockGet.mockImplementation(async (path: string) => {
        const offset = Number(new URL(path, 'http://nav').searchParams.get('offset'))
        return {
          'subsonic-response': {
            status: 'ok',
            albumList2: { album: albums.slice(offset, offset + 100) },
          },
        }
      })
      const result = await createSubsonicClient('http://nav:4533', 'u', 'p').getAllAlbums()
      expect(result.map((album) => album.id)).toEqual(albums.map((album) => String(album.id)))
      expect(
        mockGet.mock.calls.map(([path]) =>
          new URL(String(path), 'http://nav').searchParams.get('offset'),
        ),
      ).toEqual(offsets)
    },
  )

  it('skips malformed hint rows and accepts null years without losing valid albums', async () => {
    mockGet
      .mockResolvedValueOnce({
        'subsonic-response': {
          status: 'ok',
          albumList2: {
            album: [
              { id: '1', artistId: 'a', name: 'First', year: null },
              { id: '2', artistId: 'a', name: 123 },
              { id: '3', artistId: 'a', name: 'Third', year: 1990 },
              { id: '4', artistId: 'a', name: 'Bad year', year: 'unknown' },
              null,
            ],
          },
        },
      })
      .mockResolvedValueOnce({ 'subsonic-response': { status: 'ok', albumList2: {} } })
    expect(await createSubsonicClient('http://nav:4533', 'u', 'p').getAllAlbums()).toEqual([
      { id: '1', artistId: 'a', title: 'First', releaseYear: undefined },
      { id: '3', artistId: 'a', title: 'Third', releaseYear: 1990 },
    ])
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('does not treat an all-malformed page as a stalled offset', async () => {
    mockGet
      .mockResolvedValueOnce({
        'subsonic-response': { status: 'ok', albumList2: { album: [{ name: 123 }] } },
      })
      .mockResolvedValueOnce({
        'subsonic-response': {
          status: 'ok',
          albumList2: { album: [{ id: '2', artistId: 'a', name: 'Valid' }] },
        },
      })
      .mockResolvedValueOnce({ 'subsonic-response': { status: 'ok', albumList2: {} } })
    expect(await createSubsonicClient('http://nav:4533', 'u', 'p').getAllAlbums()).toEqual([
      { id: '2', artistId: 'a', title: 'Valid', releaseYear: undefined },
    ])
  })

  it('rejects a hint listing that reaches the page cap', async () => {
    mockGet.mockImplementation(async (path: string) => {
      const id = new URL(path, 'http://nav').searchParams.get('offset')
      return {
        'subsonic-response': {
          status: 'ok',
          albumList2: { album: [{ id, artistId: '1', name: `Album ${id}` }] },
        },
      }
    })
    await expect(createSubsonicClient('http://nav:4533', 'u', 'p').getAllAlbums()).rejects.toThrow(
      'Subsonic album pagination exceeded 200000 albums',
    )
    expect(mockGet).toHaveBeenCalledTimes(400)
  })

  it.each(['failed page', 'stalled page', 'malformed page'])(
    'rejects an incomplete listing: %s',
    async (failure) => {
      const page = {
        'subsonic-response': {
          status: 'ok',
          albumList2: {
            album: Array.from({ length: 500 }, (_, id) => ({
              id,
              artistId: '1',
              name: `Album ${id}`,
            })),
          },
        },
      }
      mockGet.mockResolvedValueOnce(page)
      if (failure === 'failed page') mockGet.mockRejectedValueOnce(new Error('page failed'))
      else
        mockGet.mockResolvedValueOnce(
          failure === 'stalled page' ? page : { 'subsonic-response': { status: 'ok' } },
        )
      await expect(
        createSubsonicClient('http://nav:4533', 'u', 'p').getAllAlbums(),
      ).rejects.toThrow()
    },
  )

  it.each([
    ['a74b1b7f-71a5-4011-9441-d0b5e4122711', true],
    ['A74B1B7F-71A5-4011-9441-D0B5E4122711', true],
    ['invalid', false],
    ['', false],
    [null, false],
    [123, false],
  ])('passes only valid artist MBIDs: %j', async (musicBrainzId, valid) => {
    mockGet.mockResolvedValueOnce({
      'subsonic-response': {
        status: 'ok',
        artists: { index: [{ artist: [{ id: '1', name: 'Bush', musicBrainzId }] }] },
      },
    })
    expect(await createSubsonicClient('http://nav:4533', 'u', 'p').getAllArtists()).toEqual([
      { id: '1', name: 'Bush', ...(valid ? { mbid: String(musicBrainzId).toLowerCase() } : {}) },
    ])
  })
})
