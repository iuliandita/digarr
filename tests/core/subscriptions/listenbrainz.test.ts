import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(),
}))

import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { createListenBrainzAdapter } from '@/core/subscriptions/adapters/listenbrainz'

const mockClient = {
  getArtistRadio: vi.fn(),
  getSimilarUsers: vi.fn(),
  getTopArtistsForUser: vi.fn(),
  getTopArtists: vi.fn(),
  getTopArtistsPaged: vi.fn(),
  getListens: vi.fn(),
  getSimilarArtists: vi.fn(),
  getUserRadio: vi.fn(),
  getListenCount: vi.fn(),
  getListeningActivity: vi.fn(),
  getTagRadio: vi.fn(),
  testConnection: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createListenBrainzClient).mockReturnValue(mockClient)
})

describe('artist-radio feed type', () => {
  it('calls getArtistRadio and maps to DiscoveredArtist', async () => {
    mockClient.getArtistRadio.mockResolvedValueOnce([
      { name: 'Radio Artist', mbid: 'mbid-1', score: 0.8 },
    ])

    const adapter = createListenBrainzAdapter({ username: 'user', token: 'tok' })
    const result = await adapter.fetch({
      feedType: 'artist-radio',
      seedArtistMbid: 'seed-mbid',
      adventurousness: 'hard',
    })

    expect(result.artists).toHaveLength(1)
    expect(result.artists[0]).toMatchObject({
      name: 'Radio Artist',
      similarityScore: 0.8,
      source: 'listenbrainz:artist-radio',
    })
  })
})

describe('similar-users feed type', () => {
  it('fetches similar users top artists', async () => {
    mockClient.getSimilarUsers.mockResolvedValueOnce([{ username: 'peer1', similarity: 0.9 }])
    mockClient.getTopArtistsForUser.mockResolvedValueOnce([
      { name: 'Peer Pick', mbid: 'mbid-p', playCount: 50, source: 'listenbrainz' },
    ])

    const adapter = createListenBrainzAdapter({ username: 'user', token: 'tok' })
    const result = await adapter.fetch({
      feedType: 'similar-users',
      maxUsers: 1,
    })

    expect(result.artists).toHaveLength(1)
    expect(result.artists[0]).toMatchObject({
      name: 'Peer Pick',
      source: 'listenbrainz:similar-users',
    })
  })

  it('deduplicates across users', async () => {
    mockClient.getSimilarUsers.mockResolvedValueOnce([
      { username: 'peer1', similarity: 0.9 },
      { username: 'peer2', similarity: 0.8 },
    ])
    mockClient.getTopArtistsForUser
      .mockResolvedValueOnce([{ name: 'Shared', mbid: 's', playCount: 50, source: 'listenbrainz' }])
      .mockResolvedValueOnce([{ name: 'Shared', mbid: 's', playCount: 40, source: 'listenbrainz' }])

    const adapter = createListenBrainzAdapter({ username: 'user', token: 'tok' })
    const result = await adapter.fetch({ feedType: 'similar-users', maxUsers: 2 })

    expect(result.artists).toHaveLength(1)
  })
})
