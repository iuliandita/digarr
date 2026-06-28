// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/subsonic', () => ({
  createSubsonicClient: vi.fn(),
}))

const { createSubsonicClient } = await import('@/core/clients/subsonic')
const { createSubsonicSource } = await import('@/core/plugins/subsonic')

describe('createSubsonicSource()', () => {
  function mockClient() {
    const client = {
      getStarredArtists: vi.fn().mockResolvedValue([
        { id: '1', name: 'Radiohead' },
        { id: '2', name: 'Bjork' },
        { id: '3', name: 'Portishead' },
      ]),
      getAllArtists: vi.fn().mockResolvedValue([]),
      getAlbumsForArtist: vi.fn().mockResolvedValue([]),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected' }),
    }
    vi.mocked(createSubsonicClient).mockReturnValue(client)
    return client
  }

  it('has id "subsonic" and name "Subsonic"', () => {
    mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    expect(source.id).toBe('subsonic')
    expect(source.name).toBe('Subsonic')
  })

  it('has correct capabilities', () => {
    mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    expect(source.capabilities).toContain('topArtists')
    expect(source.capabilities).not.toContain('similarArtists')
    expect(source.capabilities).not.toContain('recentListening')
    expect(source.capabilities).not.toContain('listeningActivity')
    expect(source.capabilities).not.toContain('genreArtists')
  })

  it('getTopArtists() maps starred artists with descending playCount', async () => {
    mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    const artists = await source.getTopArtists()

    expect(artists).toHaveLength(3)
    expect(artists[0]).toEqual({ name: 'Radiohead', playCount: 3, source: 'subsonic' })
    expect(artists[1]).toEqual({ name: 'Bjork', playCount: 2, source: 'subsonic' })
    expect(artists[2]).toEqual({ name: 'Portishead', playCount: 1, source: 'subsonic' })
  })

  it('getTopArtists() honors a numeric limit (slice)', async () => {
    mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    const artists = await source.getTopArtists(2)

    expect(artists).toHaveLength(2)
    expect(artists[0]).toEqual({ name: 'Radiohead', playCount: 2, source: 'subsonic' })
    expect(artists[1]).toEqual({ name: 'Bjork', playCount: 1, source: 'subsonic' })
  })

  it('getSimilarArtists() returns empty array', async () => {
    mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    const similar = await source.getSimilarArtists('Radiohead', 'mbid-rh')

    expect(similar).toEqual([])
  })

  it('testConnection() delegates to client', async () => {
    const client = mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    const result = await source.testConnection()

    expect(result).toEqual({ success: true, message: 'Connected' })
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('does not have getListeningActivity', () => {
    mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    expect(source.getListeningActivity).toBeUndefined()
  })

  it('does not have getGenreArtists', () => {
    mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    expect(source.getGenreArtists).toBeUndefined()
  })
})
