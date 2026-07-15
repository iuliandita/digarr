// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateSubsonicClient,
  mockGetStarredArtists,
  mockGetDiscoveryModeConnections,
  mockGetDiscoveryModeSkipTlsVerify,
} = vi.hoisted(() => ({
  mockCreateSubsonicClient: vi.fn(() => ({
    getStarredArtists: vi.fn(),
  })),
  mockGetStarredArtists: vi.fn(),
  mockGetDiscoveryModeConnections: vi.fn(),
  mockGetDiscoveryModeSkipTlsVerify: vi.fn(),
}))

vi.mock('@/core/clients/subsonic', () => ({
  createSubsonicClient: mockCreateSubsonicClient.mockImplementation(() => ({
    getStarredArtists: mockGetStarredArtists,
  })),
}))

vi.mock('@/core/discovery-modes/modes/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/discovery-modes/modes/runtime')>()
  return {
    ...actual,
    getDiscoveryModeConnections: mockGetDiscoveryModeConnections,
    getDiscoveryModeSkipTlsVerify: mockGetDiscoveryModeSkipTlsVerify,
  }
})

import {
  EMPTY_DISCOVERY_SNAPSHOT,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import { createSubsonicStarredMode } from '@/core/discovery-modes/modes/subsonic-starred'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

function makeRequest(settings: Record<string, unknown> = {}): DiscoveryModeRequest {
  return {
    modeId: 'subsonic-starred',
    triggerType: 'manual',
    settingsMode: 'advanced',
    userId: 1,
    rawUserSettings: settings,
    normalizedSettings: settings,
    providerContext: { providerPath: ['subsonic'] },
    fallbackPolicy: 'allow-fallback',
  }
}

describe('subsonic-starred mode – shape', () => {
  it('has id "subsonic-starred", fallback availability, and the declared limit field', () => {
    const mode = createSubsonicStarredMode()
    expect(mode.id).toBe('subsonic-starred')
    expect(mode.availability).toBe('fallback')
    expect(mode.easyFields.some((f) => f.key === 'limit')).toBe(true)
    expect(mode.advancedFields.some((f) => f.key === 'limit')).toBe(true)
    expect(mode.label).toBeTruthy()
    expect(mode.description).toBeTruthy()
  })
})

describe('subsonic-starred mode – availability', () => {
  it('is enabled with providerPath subsonic and fallbackUsed true when hasSubsonic is true', () => {
    const result = evaluateDiscoveryModeAvailability('subsonic-starred', {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      hasSubsonic: true,
    })
    expect(result).toMatchObject({
      enabled: true,
      fallbackUsed: true,
      providerPath: ['subsonic'],
    })
  })

  it('is disabled with a Connect Subsonic reason when hasSubsonic is false', () => {
    const result = evaluateDiscoveryModeAvailability('subsonic-starred', {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      hasSubsonic: false,
    })
    expect(result.enabled).toBe(false)
    expect(result.reason).toMatch(/subsonic/i)
  })
})

describe('subsonic-starred mode – executor', () => {
  beforeEach(() => {
    mockCreateSubsonicClient.mockClear()
    mockGetStarredArtists.mockReset()
    mockGetDiscoveryModeConnections.mockReset()
    mockGetDiscoveryModeSkipTlsVerify.mockReset()
    mockGetDiscoveryModeConnections.mockResolvedValue({
      subsonicUrl: 'https://music.example.com',
      subsonicUsername: 'alice',
      subsonicPassword: 'secret',
    })
    mockGetDiscoveryModeSkipTlsVerify.mockResolvedValue(false)
    mockGetStarredArtists.mockResolvedValue([
      { id: '1', name: 'Artist A' },
      { id: '2', name: 'Artist B' },
      { id: '3', name: 'Artist C' },
    ])
  })

  it('returns artist candidates with provenanceProvider subsonic, fallbackUsed true, and no mbid', async () => {
    const mode = createSubsonicStarredMode()
    const result = await mode.executor(makeRequest({ limit: 10 }))

    expect(result.candidates).toHaveLength(3)
    for (const c of result.candidates) {
      expect(c.candidateType).toBe('artist')
      expect(c.provenanceProvider).toBe('subsonic')
      expect(c.fallbackUsed).toBe(true)
      expect(c.mbid).toBeUndefined()
    }
  })

  it('maps artist names correctly from the starred list', async () => {
    const mode = createSubsonicStarredMode()
    const result = await mode.executor(makeRequest({ limit: 10 }))

    const names = result.candidates.map((c) => c.name)
    expect(names).toEqual(['Artist A', 'Artist B', 'Artist C'])
  })

  it.each([true, false])('forwards skipTlsVerify=%s to the Subsonic client', async (value) => {
    mockGetDiscoveryModeSkipTlsVerify.mockResolvedValue(value)

    const mode = createSubsonicStarredMode()
    await mode.executor(makeRequest({ limit: 10 }))

    expect(mockCreateSubsonicClient).toHaveBeenCalledWith(
      'https://music.example.com',
      'alice',
      'secret',
      { skipTlsVerify: value },
    )
  })

  it('clamps to the first `limit` starred artists', async () => {
    mockGetStarredArtists.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Artist ${i}` })),
    )
    const mode = createSubsonicStarredMode()
    const result = await mode.executor(makeRequest({ limit: 10 }))
    expect(result.candidates).toHaveLength(10)
    expect(result.candidates[0]?.name).toBe('Artist 0')
    expect(result.candidates[9]?.name).toBe('Artist 9')
  })

  it('defaults limit to 50 when not provided', async () => {
    mockGetStarredArtists.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Artist ${i}` })),
    )
    const mode = createSubsonicStarredMode()
    const result = await mode.executor(makeRequest({}))
    expect(result.candidates).toHaveLength(50)
  })

  it('throws "Connect Subsonic to use this mode." when the connection is missing', async () => {
    mockGetDiscoveryModeConnections.mockResolvedValue(null)
    const mode = createSubsonicStarredMode()
    await expect(mode.executor(makeRequest({}))).rejects.toThrow(
      'Connect Subsonic to use this mode.',
    )
  })

  it('throws "Connect Subsonic to use this mode." when connection fields are incomplete', async () => {
    mockGetDiscoveryModeConnections.mockResolvedValue({
      subsonicUrl: 'https://music.example.com',
      subsonicUsername: null,
      subsonicPassword: null,
    })
    const mode = createSubsonicStarredMode()
    await expect(mode.executor(makeRequest({}))).rejects.toThrow(
      'Connect Subsonic to use this mode.',
    )
  })
})
