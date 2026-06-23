// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSavedAlbums, mockGetSpotifyToken } = vi.hoisted(() => ({
  mockGetSavedAlbums: vi.fn(),
  mockGetSpotifyToken: vi.fn(),
}))

vi.mock('@/core/clients/spotify', () => ({
  createSpotifyClient: vi.fn(() => ({
    getSavedAlbums: mockGetSavedAlbums,
  })),
}))

vi.mock('@/core/discovery-modes/modes/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/discovery-modes/modes/runtime')>()
  return { ...actual, getDiscoveryModeSpotifyToken: mockGetSpotifyToken }
})

import {
  EMPTY_DISCOVERY_SNAPSHOT,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import { createSpotifySavedAlbumsMode } from '@/core/discovery-modes/modes/spotify-saved-albums'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

function makeRequest(settings: Record<string, unknown> = {}): DiscoveryModeRequest {
  return {
    modeId: 'spotify-saved-albums',
    triggerType: 'manual',
    settingsMode: 'advanced',
    userId: 1,
    rawUserSettings: settings,
    normalizedSettings: settings,
    providerContext: { providerPath: ['spotify'] },
    fallbackPolicy: 'allow-fallback',
  }
}

describe('spotify-saved-albums mode – shape', () => {
  it('has id "spotify-saved-albums", fallback availability, and the declared limit field', () => {
    const mode = createSpotifySavedAlbumsMode()
    expect(mode.id).toBe('spotify-saved-albums')
    expect(mode.availability).toBe('fallback')
    expect(mode.easyFields.some((f) => f.key === 'limit')).toBe(true)
    expect(mode.label).toBeTruthy()
    expect(mode.description).toBeTruthy()
  })
})

describe('spotify-saved-albums mode – availability', () => {
  it('is enabled with providerPath spotify and fallbackUsed true when hasSpotify is true', () => {
    const result = evaluateDiscoveryModeAvailability('spotify-saved-albums', {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      hasSpotify: true,
    })
    expect(result).toMatchObject({
      enabled: true,
      fallbackUsed: true,
      providerPath: ['spotify'],
    })
  })

  it('is disabled with a Connect Spotify reason when hasSpotify is false', () => {
    const result = evaluateDiscoveryModeAvailability('spotify-saved-albums', {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      hasSpotify: false,
    })
    expect(result.enabled).toBe(false)
    expect(result.reason).toMatch(/spotify/i)
  })
})

describe('spotify-saved-albums mode – executor', () => {
  beforeEach(() => {
    mockGetSavedAlbums.mockReset()
    mockGetSpotifyToken.mockReset()
    mockGetSpotifyToken.mockResolvedValue('valid-token')
    mockGetSavedAlbums.mockResolvedValue([
      { name: 'Artist A' },
      { name: 'Artist B' },
      { name: 'Artist C' },
    ])
  })

  it('returns artist candidates with provenanceProvider spotify, fallbackUsed true, and no mbid', async () => {
    const mode = createSpotifySavedAlbumsMode()
    const result = await mode.executor(makeRequest({ limit: 10 }))

    expect(result.candidates).toHaveLength(3)
    for (const c of result.candidates) {
      expect(c.candidateType).toBe('artist')
      expect(c.provenanceProvider).toBe('spotify')
      expect(c.fallbackUsed).toBe(true)
      expect(c.mbid).toBeUndefined()
    }
  })

  it('maps artist names correctly from the saved albums', async () => {
    const mode = createSpotifySavedAlbumsMode()
    const result = await mode.executor(makeRequest({ limit: 10 }))

    const names = result.candidates.map((c) => c.name)
    expect(names).toEqual(['Artist A', 'Artist B', 'Artist C'])
  })

  it('clamps limit to 100 max', async () => {
    const mode = createSpotifySavedAlbumsMode()
    await mode.executor(makeRequest({ limit: 999 }))
    expect(mockGetSavedAlbums).toHaveBeenCalledWith(100)
  })

  it('clamps limit to 1 min', async () => {
    const mode = createSpotifySavedAlbumsMode()
    await mode.executor(makeRequest({ limit: 0 }))
    expect(mockGetSavedAlbums).toHaveBeenCalledWith(1)
  })

  it('defaults limit to 50 when not provided', async () => {
    const mode = createSpotifySavedAlbumsMode()
    await mode.executor(makeRequest({}))
    expect(mockGetSavedAlbums).toHaveBeenCalledWith(50)
  })

  it('throws "Connect Spotify to use this mode." when the token resolver returns null', async () => {
    mockGetSpotifyToken.mockResolvedValue(null)
    const mode = createSpotifySavedAlbumsMode()
    await expect(mode.executor(makeRequest({}))).rejects.toThrow(
      'Connect Spotify to use this mode.',
    )
  })
})
