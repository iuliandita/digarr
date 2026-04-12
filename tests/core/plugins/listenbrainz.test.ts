// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(),
}))

const { createListenBrainzClient } = await import('@/core/clients/listenbrainz')
const { createListenBrainzSource } = await import('@/core/plugins/listenbrainz')

describe('createListenBrainzSource()', () => {
  function mockClient() {
    const client = {
      getTopArtists: vi.fn().mockResolvedValue([
        { name: 'Radiohead', mbid: 'mbid-rh', playCount: 500, source: 'listenbrainz' },
        { name: 'Portishead', mbid: 'mbid-ph', playCount: 300, source: 'listenbrainz' },
      ]),
      getSimilarArtists: vi.fn().mockResolvedValue([
        { name: 'Thom Yorke', score: 0.9 },
        { name: 'Massive Attack', score: 0.7 },
      ]),
      getListeningActivity: vi
        .fn()
        .mockResolvedValue([{ listen_count: 100, from_ts: 1000, to_ts: 2000 }]),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected' }),
      getListenCount: vi.fn().mockResolvedValue(5000),
      getArtistRadio: vi.fn().mockResolvedValue([]),
      getUserRadio: vi.fn().mockResolvedValue([]),
      getSimilarUsers: vi.fn().mockResolvedValue([]),
      getTopArtistsForUser: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(createListenBrainzClient).mockReturnValue(client)
    return client
  }

  it('has id "listenbrainz" and name "ListenBrainz"', () => {
    mockClient()
    const source = createListenBrainzSource('user', 'token')
    expect(source.id).toBe('listenbrainz')
    expect(source.name).toBe('ListenBrainz')
  })

  it('getTopArtists() maps client response to TopArtistEntry[]', async () => {
    mockClient()
    const source = createListenBrainzSource('user', 'token')
    const artists = await source.getTopArtists()

    expect(artists).toHaveLength(2)
    expect(artists[0]).toEqual({
      name: 'Radiohead',
      mbid: 'mbid-rh',
      playCount: 500,
      source: 'listenbrainz',
    })
  })

  it('getSimilarArtists() maps score to similarityScore', async () => {
    mockClient()
    const source = createListenBrainzSource('user', 'token')
    const similar = await source.getSimilarArtists('Radiohead', 'mbid-rh')

    expect(similar).toHaveLength(2)
    expect(similar[0]).toEqual({
      name: 'Thom Yorke',
      similarityScore: 0.9,
      source: 'listenbrainz',
    })
  })

  it('getSimilarArtists() returns empty array when no mbid provided', async () => {
    mockClient()
    const source = createListenBrainzSource('user', 'token')
    const similar = await source.getSimilarArtists('Unknown Artist')

    expect(similar).toEqual([])
  })

  it('testConnection() delegates to client', async () => {
    const client = mockClient()
    const source = createListenBrainzSource('user', 'token')
    const result = await source.testConnection()

    expect(result).toEqual({ success: true, message: 'Connected' })
    expect(client.testConnection).toHaveBeenCalled()
  })

  it('getListeningActivity() delegates to client', async () => {
    const client = mockClient()
    const source = createListenBrainzSource('user', 'token')
    const activity = await source.getListeningActivity?.()

    expect(activity).toEqual([{ listen_count: 100, from_ts: 1000, to_ts: 2000 }])
    expect(client.getListeningActivity).toHaveBeenCalled()
  })
})
