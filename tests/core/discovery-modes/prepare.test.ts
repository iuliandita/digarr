import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(),
}))

vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(),
}))

vi.mock('@/core/discovery-modes/modes/runtime', () => ({
  getDiscoveryModeConnections: vi.fn(),
  getNormalizedLimit: vi.fn(() => 25),
  normalizeDiscoveryName: vi.fn((name: string) => name.trim().toLowerCase()),
}))

import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { prepareDiscoveryModeRequest } from '@/core/discovery-modes/prepare'
import { createDefaultDiscoveryModeRegistry } from '@/core/discovery-modes/registry'

const mockMusicBrainz = {
  searchArtist: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(
    createMusicBrainzClient as unknown as { mockReturnValue: (value: unknown) => void }
  ).mockReturnValue(mockMusicBrainz)
})

describe('prepareDiscoveryModeRequest', () => {
  it('resolves an artist-radio seed name to an MBID before execution', async () => {
    mockMusicBrainz.searchArtist.mockResolvedValueOnce({
      artists: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Travka',
          score: 100,
        },
      ],
    })

    const request = await prepareDiscoveryModeRequest(
      {
        modeId: 'lb-artist-radio',
        triggerType: 'manual',
        settingsMode: 'easy',
        userId: 7,
        rawUserSettings: { seedArtistMbid: 'Travka', adventurousness: 'easy' },
        normalizedSettings: { seedArtistMbid: 'Travka', adventurousness: 'easy' },
        providerContext: { providerPath: ['listenbrainz'] },
        fallbackPolicy: 'strict',
      },
      createDefaultDiscoveryModeRegistry(),
    )

    expect(mockMusicBrainz.searchArtist).toHaveBeenCalledWith('Travka')
    expect(request.normalizedSettings.seedArtistMbid).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('rejects artist-radio seeds that cannot be resolved to an MBID', async () => {
    mockMusicBrainz.searchArtist.mockResolvedValueOnce({ artists: [] })

    await expect(
      prepareDiscoveryModeRequest(
        {
          modeId: 'lb-artist-radio',
          triggerType: 'manual',
          settingsMode: 'easy',
          userId: 7,
          rawUserSettings: { seedArtistMbid: 'Unknown Seed', adventurousness: 'easy' },
          normalizedSettings: { seedArtistMbid: 'Unknown Seed', adventurousness: 'easy' },
          providerContext: { providerPath: ['listenbrainz'] },
          fallbackPolicy: 'strict',
        },
        createDefaultDiscoveryModeRegistry(),
      ),
    ).rejects.toThrow('Could not resolve artist seed "Unknown Seed" to a MusicBrainz artist.')
  })
})
