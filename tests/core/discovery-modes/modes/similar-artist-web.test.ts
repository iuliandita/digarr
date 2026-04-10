import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

const getUserConnections = vi.fn()
const similarFetch = vi.fn()

vi.mock('@/db', () => ({
  db: {},
}))

vi.mock('@/db/queries/users', () => ({
  getUserConnections,
}))

vi.mock('@/core/subscriptions/adapters/similar', () => ({
  createSimilarAdapter: vi.fn(() => ({
    fetch: similarFetch,
  })),
}))

vi.mock('@/core/plugins/listenbrainz', () => ({
  createListenBrainzSource: vi.fn(() => ({
    id: 'listenbrainz',
    capabilities: ['similarArtists'],
    getSimilarArtists: vi.fn(),
  })),
}))

vi.mock('@/core/plugins/lastfm', () => ({
  createLastFmSource: vi.fn(() => ({
    id: 'lastfm',
    capabilities: ['similarArtists'],
    getSimilarArtists: vi.fn(),
  })),
}))

describe('createSimilarArtistWebMode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('maps similar-artist provider results into discovery candidates', async () => {
    getUserConnections.mockResolvedValue({
      listenbrainzUsername: null,
      listenbrainzToken: null,
      lastfmUsername: 'lfm-user',
      lastfmApiKey: 'lfm-key',
    })
    similarFetch.mockResolvedValue({
      artists: [
        {
          name: 'Silver Apples',
          mbid: 'artist-1',
          similarityScore: 0.83,
          source: 'similar-subscription:lastfm',
        },
        {
          name: 'United States of America',
          mbid: 'artist-2',
          similarityScore: 0.77,
          source: 'similar-subscription:lastfm',
        },
      ],
    })

    const { createSimilarArtistWebMode } = await import(
      '@/core/discovery-modes/modes/similar-artist-web'
    )
    const mode = createSimilarArtistWebMode()
    const request: DiscoveryModeRequest = {
      modeId: 'similar-artist-web',
      triggerType: 'manual',
      settingsMode: 'advanced',
      userId: 7,
      rawUserSettings: { seedArtists: ['Stereolab'], limit: 2 },
      normalizedSettings: { seedArtists: ['Stereolab'], limit: 2 },
      providerContext: { providerPath: ['lastfm'] },
      fallbackPolicy: 'strict',
    }

    const result = await mode.executor(request)

    expect(similarFetch).toHaveBeenCalledWith(
      { seedArtists: ['Stereolab'], providers: ['lastfm'] },
      { limit: 2 },
    )
    expect(result.candidates).toEqual([
      expect.objectContaining({
        candidateType: 'artist',
        name: 'Silver Apples',
        mbid: 'artist-1',
        provenanceProvider: 'lastfm',
        confidenceHint: 0.83,
        fallbackUsed: false,
      }),
      expect.objectContaining({
        candidateType: 'artist',
        name: 'United States of America',
        mbid: 'artist-2',
        provenanceProvider: 'lastfm',
        confidenceHint: 0.77,
        fallbackUsed: false,
      }),
    ])
  })
})
