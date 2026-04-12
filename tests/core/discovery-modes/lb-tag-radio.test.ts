// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the LB client
const mockGetTagRadio = vi.fn()
vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(() => ({
    getTagRadio: mockGetTagRadio,
  })),
}))

// Mock the resolver
const mockResolve = vi.fn()
vi.mock('@/core/clients/tag-radio-resolver', () => ({
  resolveTagRadioRecordings: (...args: unknown[]) => mockResolve(...args),
}))

// Mock runtime helpers
vi.mock('@/core/discovery-modes/modes/runtime', () => ({
  getDiscoveryModeConnections: vi.fn().mockResolvedValue({
    listenbrainzUsername: 'testuser',
    listenbrainzToken: 'test-token',
  }),
  getNormalizedLimit: vi.fn((_req: unknown, fallback: number) => fallback),
  normalizeDiscoveryName: vi.fn((name: string) => name.toLowerCase()),
}))

// Mock db and MB client
vi.mock('@/db', () => ({ db: {} }))
vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(() => ({
    lookupRecording: vi.fn(),
  })),
}))

import { createListenBrainzTagRadioMode } from '@/core/discovery-modes/modes/listenbrainz'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

beforeEach(() => {
  vi.clearAllMocks()
})

function makeRequest(settings: Record<string, unknown>): DiscoveryModeRequest {
  return {
    modeId: 'lb-tag-radio',
    userId: 1,
    settingsMode: 'easy',
    rawUserSettings: settings,
    normalizedSettings: settings,
    providerContext: { providerPath: ['listenbrainz'] },
    fallbackPolicy: 'strict',
    sources: [],
  } as unknown as DiscoveryModeRequest
}

describe('lb-tag-radio discovery mode', () => {
  it('calls getTagRadio with parsed tags and resolves to artist candidates', async () => {
    mockGetTagRadio.mockResolvedValueOnce([
      { recordingMbid: 'rec-1', percent: 100, source: 'artist', tagCount: 5 },
    ])
    mockResolve.mockResolvedValueOnce([
      { artistMbid: 'artist-A', artistName: 'Artist A', score: 1.0 },
    ])

    const mode = createListenBrainzTagRadioMode()
    const result = await mode.executor(
      makeRequest({
        tags: [{ tag: 'jazz', weight: 1 }],
      }),
    )

    expect(mockGetTagRadio).toHaveBeenCalledWith([{ tag: 'jazz', weight: 1 }], {
      count: 25,
      popBegin: 0,
      popEnd: 100,
    })
    expect(result.candidates).toEqual([
      {
        candidateType: 'artist',
        name: 'Artist A',
        mbid: 'artist-A',
        provenanceProvider: 'listenbrainz:tag-radio',
        confidenceHint: 1.0,
        fallbackUsed: false,
      },
    ])
  })

  it('uses rawTagExpression when provided (overrides builder)', async () => {
    mockGetTagRadio.mockResolvedValueOnce([])
    mockResolve.mockResolvedValueOnce([])

    const mode = createListenBrainzTagRadioMode()
    await mode.executor(
      makeRequest({
        tags: [{ tag: 'jazz', weight: 1 }],
        rawTagExpression: '(rock):3:(blues):1',
      }),
    )

    // The raw expression should be parsed and sent
    expect(mockGetTagRadio).toHaveBeenCalledWith(
      [
        { tag: 'rock', weight: 3 },
        { tag: 'blues', weight: 1 },
      ],
      expect.any(Object),
    )
  })

  it('passes count, popBegin, popEnd from advanced settings', async () => {
    mockGetTagRadio.mockResolvedValueOnce([])
    mockResolve.mockResolvedValueOnce([])

    const mode = createListenBrainzTagRadioMode()
    await mode.executor(
      makeRequest({
        tags: [{ tag: 'jazz', weight: 1 }],
        count: 50,
        popBegin: 20,
        popEnd: 80,
      }),
    )

    expect(mockGetTagRadio).toHaveBeenCalledWith(expect.any(Array), {
      count: 50,
      popBegin: 20,
      popEnd: 80,
    })
  })

  it('returns empty candidates when resolver returns empty', async () => {
    mockGetTagRadio.mockResolvedValueOnce([])
    mockResolve.mockResolvedValueOnce([])

    const mode = createListenBrainzTagRadioMode()
    const result = await mode.executor(
      makeRequest({
        tags: [{ tag: 'obscure', weight: 1 }],
      }),
    )

    expect(result.candidates).toEqual([])
  })

  it('throws when no tags are provided', async () => {
    const mode = createListenBrainzTagRadioMode()
    await expect(mode.executor(makeRequest({ tags: [] }))).rejects.toThrow(/at least one tag/i)
  })

  it('has correct mode definition properties', () => {
    const mode = createListenBrainzTagRadioMode()
    expect(mode.id).toBe('lb-tag-radio')
    expect(mode.label).toBe('Tag Radio')
    expect(mode.availability).toBe('strict')
    expect(mode.easyFields.some((f) => f.key === 'tags')).toBe(true)
    expect(mode.advancedFields.some((f) => f.key === 'rawTagExpression')).toBe(true)
    expect(mode.advancedFields.some((f) => f.key === 'count')).toBe(true)
  })
})
