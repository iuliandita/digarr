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
      searchTracks: vi.fn().mockResolvedValue([]),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected' }),
    }
    vi.mocked(createSubsonicClient).mockReturnValue(client)
    return client
  }

  it('getTopArtists() maps starred artists with descending playCount', async () => {
    mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    const artists = await source.getTopArtists()

    expect(artists).toHaveLength(3)
    expect(artists[0]).toEqual({
      name: 'Radiohead',
      playCount: 3,
      source: 'subsonic',
      preferenceScore: 1,
      preferenceBasis: 'membership',
    })
    expect(artists[1]).toEqual({
      name: 'Bjork',
      playCount: 2,
      source: 'subsonic',
      preferenceScore: 1,
      preferenceBasis: 'membership',
    })
    expect(artists[2]).toEqual({
      name: 'Portishead',
      playCount: 1,
      source: 'subsonic',
      preferenceScore: 1,
      preferenceBasis: 'membership',
    })
  })

  it('getTopArtists() honors a numeric limit (slice)', async () => {
    mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    const artists = await source.getTopArtists(2)

    expect(artists).toHaveLength(2)
    expect(artists[0]).toEqual({
      name: 'Radiohead',
      playCount: 2,
      source: 'subsonic',
      preferenceScore: 1,
      preferenceBasis: 'membership',
    })
    expect(artists[1]).toEqual({
      name: 'Bjork',
      playCount: 1,
      source: 'subsonic',
      preferenceScore: 1,
      preferenceBasis: 'membership',
    })
  })

  it('getTopArtists() keeps membership scores equal across order and result length', async () => {
    const client = mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    const original = await source.getTopArtists()
    client.getStarredArtists.mockResolvedValue([
      { id: '3', name: 'Portishead' },
      { id: '2', name: 'Bjork' },
      { id: '1', name: 'Radiohead' },
    ])
    const reordered = await source.getTopArtists()
    const limited = await source.getTopArtists(2)

    expect(original.find((a) => a.name === 'Portishead')?.playCount).toBe(1)
    expect(reordered.find((a) => a.name === 'Portishead')?.playCount).toBe(3)
    expect(limited.find((a) => a.name === 'Portishead')?.playCount).toBe(2)
    for (const artist of [...original, ...reordered, ...limited]) {
      expect(artist).toMatchObject({ preferenceScore: 1, preferenceBasis: 'membership' })
    }
  })

  it('getSimilarArtists() returns empty array', async () => {
    mockClient()
    const source = createSubsonicSource('http://nav:4533', 'user', 'pass')
    const similar = await source.getSimilarArtists('Radiohead', 'mbid-rh')

    expect(similar).toEqual([])
  })
})
