import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

const getUserConnections = vi.fn()
const adapterFetch = vi.fn()
const getTopArtists = vi.fn()
const getSimilarArtists = vi.fn()

vi.mock('@/db', () => ({
  db: {},
}))

vi.mock('@/db/queries/users', () => ({
  getUserConnections,
}))

vi.mock('@/core/subscriptions/adapters/listenbrainz', () => ({
  createListenBrainzAdapter: vi.fn(() => ({
    fetch: adapterFetch,
  })),
}))

vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(() => ({
    getTopArtists,
    getSimilarArtists,
  })),
}))

describe('createListenBrainzMode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('turns weekly-jams feed results into discovery candidates', async () => {
    getUserConnections.mockResolvedValue({
      listenbrainzUsername: 'lb-user',
      listenbrainzToken: 'lb-token',
    })
    adapterFetch.mockResolvedValue({
      artists: [
        { name: 'Stereolab', similarityScore: 0.61, source: 'listenbrainz:weekly-jams' },
        { name: 'Broadcast', similarityScore: 0.57, source: 'listenbrainz:weekly-jams' },
      ],
    })

    const { createListenBrainzMode } = await import('@/core/discovery-modes/modes/listenbrainz')
    const mode = createListenBrainzMode()
    const request: DiscoveryModeRequest = {
      modeId: 'listenbrainz',
      triggerType: 'manual',
      settingsMode: 'easy',
      userId: 7,
      rawUserSettings: { feedType: 'weekly-jams' },
      normalizedSettings: { feedType: 'weekly-jams' },
      providerContext: { providerPath: ['listenbrainz'] },
      fallbackPolicy: 'strict',
    }

    const result = await mode.executor(request)

    expect(adapterFetch).toHaveBeenCalledWith({ feedType: 'weekly-jams' }, { limit: undefined })
    expect(result.candidates).toEqual([
      expect.objectContaining({
        candidateType: 'artist',
        name: 'Stereolab',
        provenanceProvider: 'listenbrainz:weekly-jams',
        confidenceHint: 0.61,
        fallbackUsed: false,
      }),
      expect.objectContaining({
        candidateType: 'artist',
        name: 'Broadcast',
        provenanceProvider: 'listenbrainz:weekly-jams',
        confidenceHint: 0.57,
        fallbackUsed: false,
      }),
    ])
  })

  it('approximates similar-users from top artists plus ListenBrainz similar artists', async () => {
    getUserConnections.mockResolvedValue({
      listenbrainzUsername: 'lb-user',
      listenbrainzToken: 'lb-token',
    })
    getTopArtists.mockResolvedValue([
      { name: 'Boards of Canada', mbid: 'seed-1', playCount: 120, source: 'listenbrainz' },
      { name: 'Autechre', mbid: 'seed-2', playCount: 90, source: 'listenbrainz' },
    ])
    getSimilarArtists.mockImplementation(async (mbid: string) => {
      if (mbid === 'seed-1') {
        return [
          { name: 'Casino Versus Japan', score: 0.72 },
          { name: 'Autechre', score: 0.7 },
        ]
      }

      return [{ name: 'Plaid', score: 0.68 }]
    })

    const { createListenBrainzMode } = await import('@/core/discovery-modes/modes/listenbrainz')
    const mode = createListenBrainzMode()
    const request: DiscoveryModeRequest = {
      modeId: 'listenbrainz',
      triggerType: 'manual',
      settingsMode: 'advanced',
      userId: 7,
      rawUserSettings: { feedType: 'similar-users', limit: 2 },
      normalizedSettings: { feedType: 'similar-users', limit: 2 },
      providerContext: { providerPath: ['listenbrainz'] },
      fallbackPolicy: 'strict',
    }

    const result = await mode.executor(request)

    expect(getTopArtists).toHaveBeenCalledWith('month')
    expect(result.candidates).toEqual([
      expect.objectContaining({
        candidateType: 'artist',
        name: 'Casino Versus Japan',
        provenanceProvider: 'listenbrainz:similar-users',
        fallbackUsed: false,
      }),
      expect.objectContaining({
        candidateType: 'artist',
        name: 'Plaid',
        provenanceProvider: 'listenbrainz:similar-users',
        fallbackUsed: false,
      }),
    ])
  })
})
