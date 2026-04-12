import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(),
}))

vi.mock('@/core/discovery-modes/modes/runtime', () => ({
  getDiscoveryModeConnections: vi.fn(),
  getNormalizedLimit: vi.fn(),
  normalizeDiscoveryName: vi.fn((name: string) => name.toLowerCase()),
}))

import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { createListenBrainzRadioModes } from '@/core/discovery-modes/modes/listenbrainz'
import {
  getDiscoveryModeConnections,
  getNormalizedLimit,
} from '@/core/discovery-modes/modes/runtime'

const mockClient = {
  getArtistRadio: vi.fn(),
  getTagRadio: vi.fn(),
  getUserRadio: vi.fn(),
  getSimilarUsers: vi.fn(),
  getTopArtistsForUser: vi.fn(),
  getTopArtists: vi.fn(),
  getSimilarArtists: vi.fn(),
  getListenCount: vi.fn(),
  getListeningActivity: vi.fn(),
  testConnection: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createListenBrainzClient).mockReturnValue(mockClient)
  vi.mocked(getDiscoveryModeConnections).mockResolvedValue({
    listenbrainzUsername: 'testuser',
    listenbrainzToken: 'testtoken',
  })
  vi.mocked(getNormalizedLimit).mockReturnValue(25)
})

describe('lb-artist-radio mode', () => {
  it('calls getArtistRadio and maps candidates', async () => {
    mockClient.getArtistRadio.mockResolvedValueOnce([
      { name: 'Found Artist', mbid: 'mbid-1', score: 0.9 },
      { name: 'Another Artist', mbid: 'mbid-2', score: 0.7 },
    ])

    const modes = createListenBrainzRadioModes()
    const artistRadio = modes.find((m) => m.id === 'lb-artist-radio')!

    const result = await artistRadio.executor({
      userId: 1,
      normalizedSettings: {
        seedArtistMbid: 'seed-mbid',
        adventurousness: 'medium',
      },
      settingsMode: 'easy',
    } as any)

    expect(mockClient.getArtistRadio).toHaveBeenCalledWith('seed-mbid', 'medium')
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]).toMatchObject({
      candidateType: 'artist',
      name: 'Found Artist',
      mbid: 'mbid-1',
      provenanceProvider: 'listenbrainz:artist-radio',
    })
  })

  it('throws when LB not connected', async () => {
    vi.mocked(getDiscoveryModeConnections).mockResolvedValue({})

    const modes = createListenBrainzRadioModes()
    const artistRadio = modes.find((m) => m.id === 'lb-artist-radio')!

    await expect(
      artistRadio.executor({
        userId: 1,
        normalizedSettings: { seedArtistMbid: 'x', adventurousness: 'easy' },
        settingsMode: 'easy',
      } as any),
    ).rejects.toThrow('Connect ListenBrainz')
  })
})

describe('lb-tag-radio mode', () => {
  it('calls getTagRadio with tag and popularity', async () => {
    mockClient.getTagRadio.mockResolvedValueOnce([
      { name: 'Jazz Artist', mbid: 'mbid-j', score: 0.8 },
    ])

    const modes = createListenBrainzRadioModes()
    const tagRadio = modes.find((m) => m.id === 'lb-tag-radio')!

    const result = await tagRadio.executor({
      userId: 1,
      normalizedSettings: { tag: 'jazz', popularity: 'low', adventurousness: 'hard' },
      settingsMode: 'advanced',
    } as any)

    expect(mockClient.getTagRadio).toHaveBeenCalledWith('jazz', 'low', 'hard')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].provenanceProvider).toBe('listenbrainz:tag-radio')
  })
})

describe('lb-user-radio mode', () => {
  it('uses connected username when no target specified', async () => {
    mockClient.getUserRadio.mockResolvedValueOnce([])

    const modes = createListenBrainzRadioModes()
    const userRadio = modes.find((m) => m.id === 'lb-user-radio')!

    await userRadio.executor({
      userId: 1,
      normalizedSettings: { targetUsername: '', adventurousness: 'medium' },
      settingsMode: 'advanced',
    } as any)

    expect(mockClient.getUserRadio).toHaveBeenCalledWith('testuser', 'medium')
  })

  it('uses explicit target username when provided', async () => {
    mockClient.getUserRadio.mockResolvedValueOnce([])

    const modes = createListenBrainzRadioModes()
    const userRadio = modes.find((m) => m.id === 'lb-user-radio')!

    await userRadio.executor({
      userId: 1,
      normalizedSettings: { targetUsername: 'friend', adventurousness: 'easy' },
      settingsMode: 'advanced',
    } as any)

    expect(mockClient.getUserRadio).toHaveBeenCalledWith('friend', 'easy')
  })
})
