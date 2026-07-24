// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetChartTopArtists, mockGetConnections } = vi.hoisted(() => ({
  mockGetChartTopArtists: vi.fn(),
  mockGetConnections: vi.fn(),
}))

vi.mock('@/core/clients/lastfm', () => ({
  createLastFmClient: vi.fn(() => ({
    getChartTopArtists: mockGetChartTopArtists,
  })),
}))

vi.mock('@/core/discovery-modes/modes/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/discovery-modes/modes/runtime')>()
  return { ...actual, getDiscoveryModeConnections: mockGetConnections }
})

import { evaluateDiscoveryModeAvailability } from '@/core/discovery-modes/availability'
import { createChartsMode } from '@/core/discovery-modes/modes/charts'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

function makeRequest(settings: Record<string, unknown> = {}): DiscoveryModeRequest {
  return {
    modeId: 'charts',
    triggerType: 'manual',
    settingsMode: 'advanced',
    userId: 1,
    rawUserSettings: settings,
    normalizedSettings: settings,
    providerContext: { providerPath: ['lastfm'] },
    fallbackPolicy: 'allow-fallback',
  }
}

describe('charts mode – shape', () => {
  it('has id "charts", fallback availability, and the declared fields', () => {
    const mode = createChartsMode()
    expect(mode.id).toBe('charts')
    expect(mode.availability).toBe('fallback')
    expect(mode.easyFields.some((f) => f.key === 'region')).toBe(true)
    expect(mode.easyFields.some((f) => f.key === 'limit')).toBe(true)
    expect(mode.label).toBeTruthy()
    expect(mode.description).toBeTruthy()
  })

  it('region field has select type with a global option', () => {
    const mode = createChartsMode()
    const regionField = mode.easyFields.find((f) => f.key === 'region')
    expect(regionField?.type).toBe('select')
    expect(regionField?.options?.some((o) => o.value === 'global')).toBe(true)
  })
})

describe('charts mode – availability', () => {
  it('is enabled with providerPath lastfm when hasLastfm is true', () => {
    const result = evaluateDiscoveryModeAvailability('charts', {
      hasListenBrainz: false,
      hasSpotify: false,
      spotifyScopes: [],
      hasLastfm: true,
      hasDiscogs: false,
      hasDeezer: false,
      hasLibrarySync: false,
      hasSubsonic: false,
    })
    expect(result).toMatchObject({
      enabled: true,
      fallbackUsed: true,
      providerPath: ['lastfm'],
    })
  })

  it('is disabled with a reason when hasLastfm is false', () => {
    const result = evaluateDiscoveryModeAvailability('charts', {
      hasListenBrainz: false,
      hasSpotify: false,
      spotifyScopes: [],
      hasLastfm: false,
      hasDiscogs: false,
      hasDeezer: false,
      hasLibrarySync: false,
      hasSubsonic: false,
    })
    expect(result.enabled).toBe(false)
    expect(result.reason).toMatch(/last\.fm/i)
  })
})

describe('charts mode – executor', () => {
  beforeEach(() => {
    mockGetChartTopArtists.mockReset()
    mockGetConnections.mockReset()
    mockGetConnections.mockResolvedValue({
      lastfmUsername: 'testuser',
      lastfmApiKey: 'apikey123',
    })
    mockGetChartTopArtists.mockResolvedValue([
      { name: 'Artist A', mbid: 'mbid-a' },
      { name: 'Artist B', mbid: '' },
      { name: 'Artist C', mbid: 'mbid-c' },
    ])
  })

  it('returns artist candidates with provenanceProvider lastfm and fallbackUsed true', async () => {
    const mode = createChartsMode()
    const result = await mode.executor(makeRequest({ region: 'global', limit: 10 }))

    expect(result.candidates).toHaveLength(3)
    for (const c of result.candidates) {
      expect(c.candidateType).toBe('artist')
      expect(c.provenanceProvider).toBe('lastfm')
      expect(c.fallbackUsed).toBe(true)
    }
  })

  it('maps empty-string mbids to undefined', async () => {
    const mode = createChartsMode()
    const result = await mode.executor(makeRequest({ region: 'global', limit: 10 }))

    const artistB = result.candidates.find((c) => c.name === 'Artist B')
    expect(artistB?.mbid).toBeUndefined()
  })

  it('preserves non-empty mbids', async () => {
    const mode = createChartsMode()
    const result = await mode.executor(makeRequest({ region: 'global', limit: 10 }))

    const artistA = result.candidates.find((c) => c.name === 'Artist A')
    expect(artistA?.mbid).toBe('mbid-a')
  })

  it('passes country to client when region is not global', async () => {
    const { createLastFmClient } = await import('@/core/clients/lastfm')
    const mode = createChartsMode()
    await mode.executor(makeRequest({ region: 'United Kingdom', limit: 20 }))

    expect(mockGetChartTopArtists).toHaveBeenCalledWith(20, 'United Kingdom')
    expect(vi.mocked(createLastFmClient)).toHaveBeenCalled()
  })

  it('passes undefined country to client when region is global', async () => {
    const mode = createChartsMode()
    await mode.executor(makeRequest({ region: 'global', limit: 50 }))

    expect(mockGetChartTopArtists).toHaveBeenCalledWith(50, undefined)
  })

  it('clamps limit to 100 max', async () => {
    const mode = createChartsMode()
    await mode.executor(makeRequest({ region: 'global', limit: 9999 }))

    expect(mockGetChartTopArtists).toHaveBeenCalledWith(100, undefined)
  })

  it('clamps limit to 1 min', async () => {
    const mode = createChartsMode()
    await mode.executor(makeRequest({ region: 'global', limit: 0 }))

    expect(mockGetChartTopArtists).toHaveBeenCalledWith(1, undefined)
  })

  it('defaults limit to 50 when not provided', async () => {
    const mode = createChartsMode()
    await mode.executor(makeRequest({ region: 'global' }))

    expect(mockGetChartTopArtists).toHaveBeenCalledWith(50, undefined)
  })

  it('defaults region to global when not provided', async () => {
    const mode = createChartsMode()
    await mode.executor(makeRequest({}))

    expect(mockGetChartTopArtists).toHaveBeenCalledWith(50, undefined)
  })

  it('throws when Last.fm API key is not connected', async () => {
    mockGetConnections.mockResolvedValue({ lastfmUsername: null, lastfmApiKey: null })
    const mode = createChartsMode()
    await expect(mode.executor(makeRequest({}))).rejects.toThrow(/last\.fm/i)
  })
})
