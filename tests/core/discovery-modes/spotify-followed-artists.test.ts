// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetFollowedArtists, mockGetSpotifyToken } = vi.hoisted(() => ({
  mockGetFollowedArtists: vi.fn(),
  mockGetSpotifyToken: vi.fn(),
}))

vi.mock('@/core/clients/spotify', () => ({
  createSpotifyClient: vi.fn(() => ({ getFollowedArtists: mockGetFollowedArtists })),
}))

vi.mock('@/core/discovery-modes/modes/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/discovery-modes/modes/runtime')>()
  return { ...actual, getDiscoveryModeSpotifyToken: mockGetSpotifyToken }
})

import { createSpotifyFollowedArtistsMode } from '@/core/discovery-modes/modes/spotify-followed-artists'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

function makeRequest(settings: Record<string, unknown> = {}): DiscoveryModeRequest {
  return {
    modeId: 'spotify-followed-artists',
    triggerType: 'manual',
    settingsMode: 'advanced',
    userId: 1,
    rawUserSettings: settings,
    normalizedSettings: settings,
    providerContext: { providerPath: ['spotify'] },
    fallbackPolicy: 'allow-fallback',
  }
}

describe('spotify-followed-artists mode – shape', () => {
  it('has id, fallback availability, and a limit field', () => {
    const mode = createSpotifyFollowedArtistsMode()
    expect(mode.id).toBe('spotify-followed-artists')
    expect(mode.availability).toBe('fallback')
    expect(mode.easyFields.some((f) => f.key === 'limit')).toBe(true)
    expect(mode.label).toBeTruthy()
    expect(mode.description).toBeTruthy()
  })
})

describe('spotify-followed-artists mode – executor', () => {
  beforeEach(() => {
    mockGetFollowedArtists.mockReset()
    mockGetSpotifyToken.mockReset()
    mockGetSpotifyToken.mockResolvedValue('valid-token')
    mockGetFollowedArtists.mockResolvedValue([
      { name: 'Artist A', id: 'a', genres: [], popularity: 1 },
      { name: 'Artist B', id: 'b', genres: [], popularity: 1 },
    ])
  })

  it('returns artist candidates with provenanceProvider spotify, fallbackUsed true, no mbid', async () => {
    const mode = createSpotifyFollowedArtistsMode()
    const result = await mode.executor(makeRequest({ limit: 10 }))
    expect(result.candidates).toHaveLength(2)
    for (const c of result.candidates) {
      expect(c.candidateType).toBe('artist')
      expect(c.provenanceProvider).toBe('spotify')
      expect(c.fallbackUsed).toBe(true)
      expect(c.mbid).toBeUndefined()
    }
    expect(result.candidates.map((c) => c.name)).toEqual(['Artist A', 'Artist B'])
  })

  it('clamps limit to 100 max and 1 min, defaults to 50', async () => {
    const mode = createSpotifyFollowedArtistsMode()
    await mode.executor(makeRequest({ limit: 999 }))
    expect(mockGetFollowedArtists).toHaveBeenCalledWith(100)
    await mode.executor(makeRequest({ limit: 0 }))
    expect(mockGetFollowedArtists).toHaveBeenCalledWith(1)
    await mode.executor(makeRequest({}))
    expect(mockGetFollowedArtists).toHaveBeenCalledWith(50)
  })

  it('throws "Connect Spotify to use this mode." when token resolver returns null', async () => {
    mockGetSpotifyToken.mockResolvedValue(null)
    const mode = createSpotifyFollowedArtistsMode()
    await expect(mode.executor(makeRequest({}))).rejects.toThrow('Connect Spotify to use this mode.')
  })
})
