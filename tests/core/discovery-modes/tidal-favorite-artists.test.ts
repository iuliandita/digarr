// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetFavoriteArtists, mockGetTidalToken } = vi.hoisted(() => ({
  mockGetFavoriteArtists: vi.fn(),
  mockGetTidalToken: vi.fn(),
}))

vi.mock('@/core/clients/tidal-user', () => ({
  createTidalUserClient: vi.fn(() => ({ getFavoriteArtists: mockGetFavoriteArtists })),
}))

vi.mock('@/core/discovery-modes/modes/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/discovery-modes/modes/runtime')>()
  return { ...actual, requireDiscoveryModeProviderToken: mockGetTidalToken }
})

import { createTidalFavoriteArtistsMode } from '@/core/discovery-modes/modes/tidal-favorite-artists'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

function makeRequest(settings: Record<string, unknown> = {}): DiscoveryModeRequest {
  return {
    modeId: 'tidal-favorite-artists',
    triggerType: 'manual',
    settingsMode: 'advanced',
    userId: 1,
    rawUserSettings: settings,
    normalizedSettings: settings,
    providerContext: { providerPath: ['tidal'] },
    fallbackPolicy: 'allow-fallback',
  }
}

describe('tidal-favorite-artists mode – shape', () => {
  it('has id, fallback availability, and a limit field', () => {
    const mode = createTidalFavoriteArtistsMode()
    expect(mode.id).toBe('tidal-favorite-artists')
    expect(mode.availability).toBe('fallback')
    expect(mode.easyFields.some((f) => f.key === 'limit')).toBe(true)
  })
})

describe('tidal-favorite-artists mode – executor', () => {
  beforeEach(() => {
    mockGetFavoriteArtists.mockReset()
    mockGetTidalToken.mockReset()
    mockGetTidalToken.mockResolvedValue('valid-token')
    mockGetFavoriteArtists.mockResolvedValue([
      { id: '1', name: 'Artist A' },
      { id: '2', name: 'Artist B' },
    ])
  })

  it('returns artist candidates with provenanceProvider tidal, fallbackUsed true, no mbid', async () => {
    const mode = createTidalFavoriteArtistsMode()
    const result = await mode.executor(makeRequest({ limit: 10 }))
    expect(result.candidates).toHaveLength(2)
    for (const c of result.candidates) {
      expect(c.candidateType).toBe('artist')
      expect(c.provenanceProvider).toBe('tidal')
      expect(c.fallbackUsed).toBe(true)
      expect(c.mbid).toBeUndefined()
    }
    expect(result.candidates.map((c) => c.name)).toEqual(['Artist A', 'Artist B'])
  })

  it('clamps limit to 100 max and 1 min, defaults to 50', async () => {
    const mode = createTidalFavoriteArtistsMode()
    await mode.executor(makeRequest({ limit: 999 }))
    expect(mockGetFavoriteArtists).toHaveBeenCalledWith(100)
    await mode.executor(makeRequest({ limit: 0 }))
    expect(mockGetFavoriteArtists).toHaveBeenCalledWith(1)
    await mode.executor(makeRequest({}))
    expect(mockGetFavoriteArtists).toHaveBeenCalledWith(50)
  })

  it('throws "Connect TIDAL to use this mode." when token resolver returns null', async () => {
    mockGetTidalToken.mockRejectedValue(new Error('Connect TIDAL to use this mode.'))
    const mode = createTidalFavoriteArtistsMode()
    await expect(mode.executor(makeRequest({}))).rejects.toThrow('Connect TIDAL to use this mode.')
  })
})
