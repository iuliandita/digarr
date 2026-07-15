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
