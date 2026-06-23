// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetFlowRecommendations, mockGetDeezerToken } = vi.hoisted(() => ({
  mockGetFlowRecommendations: vi.fn(),
  mockGetDeezerToken: vi.fn(),
}))

vi.mock('@/core/clients/deezer-user', () => ({
  createDeezerUserClient: vi.fn(() => ({
    getFlowRecommendations: mockGetFlowRecommendations,
  })),
}))

vi.mock('@/core/discovery-modes/modes/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/discovery-modes/modes/runtime')>()
  return { ...actual, getDiscoveryModeDeezerToken: mockGetDeezerToken }
})

import {
  EMPTY_DISCOVERY_SNAPSHOT,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import { createDeezerFlowMode } from '@/core/discovery-modes/modes/deezer-flow'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

function makeRequest(settings: Record<string, unknown> = {}): DiscoveryModeRequest {
  return {
    modeId: 'deezer-flow',
    triggerType: 'manual',
    settingsMode: 'advanced',
    userId: 1,
    rawUserSettings: settings,
    normalizedSettings: settings,
    providerContext: { providerPath: ['deezer'] },
    fallbackPolicy: 'allow-fallback',
  }
}

describe('deezer-flow mode – shape', () => {
  it('has id "deezer-flow", fallback availability, and the declared limit field', () => {
    const mode = createDeezerFlowMode()
    expect(mode.id).toBe('deezer-flow')
    expect(mode.availability).toBe('fallback')
    expect(mode.easyFields.some((f) => f.key === 'limit')).toBe(true)
    expect(mode.label).toBeTruthy()
    expect(mode.description).toBeTruthy()
  })
})

describe('deezer-flow mode – availability', () => {
  it('is enabled with providerPath deezer and fallbackUsed true when hasDeezer is true', () => {
    const result = evaluateDiscoveryModeAvailability('deezer-flow', {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      hasDeezer: true,
    })
    expect(result).toMatchObject({
      enabled: true,
      fallbackUsed: true,
      providerPath: ['deezer'],
    })
  })

  it('is disabled with a Connect Deezer reason when hasDeezer is false', () => {
    const result = evaluateDiscoveryModeAvailability('deezer-flow', {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      hasDeezer: false,
    })
    expect(result.enabled).toBe(false)
    expect(result.reason).toMatch(/deezer/i)
  })
})

describe('deezer-flow mode – executor', () => {
  beforeEach(() => {
    mockGetFlowRecommendations.mockReset()
    mockGetDeezerToken.mockReset()
    mockGetDeezerToken.mockResolvedValue('valid-token')
    mockGetFlowRecommendations.mockResolvedValue([
      { id: 1, name: 'Artist A', fans: 1000 },
      { id: 2, name: 'Artist B', fans: 2000 },
      { id: 3, name: 'Artist C', fans: 3000 },
    ])
  })

  it('returns artist candidates with provenanceProvider deezer, fallbackUsed true, and no mbid', async () => {
    const mode = createDeezerFlowMode()
    const result = await mode.executor(makeRequest({ limit: 10 }))

    expect(result.candidates).toHaveLength(3)
    for (const c of result.candidates) {
      expect(c.candidateType).toBe('artist')
      expect(c.provenanceProvider).toBe('deezer')
      expect(c.fallbackUsed).toBe(true)
      expect(c.mbid).toBeUndefined()
    }
  })

  it('maps artist names correctly from the flow feed', async () => {
    const mode = createDeezerFlowMode()
    const result = await mode.executor(makeRequest({ limit: 10 }))

    const names = result.candidates.map((c) => c.name)
    expect(names).toEqual(['Artist A', 'Artist B', 'Artist C'])
  })

  it('clamps limit to 100 max', async () => {
    const mode = createDeezerFlowMode()
    await mode.executor(makeRequest({ limit: 999 }))
    expect(mockGetFlowRecommendations).toHaveBeenCalledWith(100)
  })

  it('clamps limit to 1 min', async () => {
    const mode = createDeezerFlowMode()
    await mode.executor(makeRequest({ limit: 0 }))
    expect(mockGetFlowRecommendations).toHaveBeenCalledWith(1)
  })

  it('defaults limit to 50 when not provided', async () => {
    const mode = createDeezerFlowMode()
    await mode.executor(makeRequest({}))
    expect(mockGetFlowRecommendations).toHaveBeenCalledWith(50)
  })

  it('throws "Connect Deezer to use this mode." when the token resolver returns null', async () => {
    mockGetDeezerToken.mockResolvedValue(null)
    const mode = createDeezerFlowMode()
    await expect(mode.executor(makeRequest({}))).rejects.toThrow('Connect Deezer to use this mode.')
  })
})
