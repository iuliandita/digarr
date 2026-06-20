// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetLabelsForArtist, mockGetArtistsForLabel, mockGetConnections } = vi.hoisted(() => ({
  mockGetLabelsForArtist: vi.fn(),
  mockGetArtistsForLabel: vi.fn(),
  mockGetConnections: vi.fn(),
}))

vi.mock('@/core/clients/discogs', () => ({
  createDiscogsClient: vi.fn(() => ({
    getLabelsForArtist: mockGetLabelsForArtist,
    getArtistsForLabel: mockGetArtistsForLabel,
  })),
}))

vi.mock('@/core/discovery-modes/modes/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/discovery-modes/modes/runtime')>()
  return { ...actual, getDiscoveryModeConnections: mockGetConnections }
})

import { createLabelsMode } from '@/core/discovery-modes/modes/labels'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

function makeRequest(settings: Record<string, unknown>): DiscoveryModeRequest {
  return {
    modeId: 'labels',
    triggerType: 'manual',
    settingsMode: 'advanced',
    userId: 1,
    rawUserSettings: settings,
    normalizedSettings: settings,
    providerContext: { providerPath: ['discogs'] },
    fallbackPolicy: 'allow-fallback',
  }
}

describe('labels mode', () => {
  beforeEach(() => {
    mockGetLabelsForArtist.mockReset()
    mockGetArtistsForLabel.mockReset()
    mockGetConnections.mockReset()
    mockGetConnections.mockResolvedValue({ discogsToken: 'tok', discogsUsername: 'user' })
  })

  it('returns co-label artists, excluding seeds and duplicates', async () => {
    mockGetLabelsForArtist.mockResolvedValue(['Warp Records'])
    mockGetArtistsForLabel.mockResolvedValue(['Aphex Twin', 'Boards of Canada', 'Seed Artist'])

    const mode = createLabelsMode()
    const result = await mode.executor(makeRequest({ seedArtists: ['Seed Artist'] }))

    expect(result.candidates.map((c) => c.name)).toEqual(['Aphex Twin', 'Boards of Canada'])
    expect(result.candidates[0]).toMatchObject({
      candidateType: 'artist',
      provenanceProvider: 'discogs',
      explanationHint: 'Warp Records',
      fallbackUsed: true,
    })
  })

  it('throws when Discogs is not connected', async () => {
    mockGetConnections.mockResolvedValue({ discogsToken: null, discogsUsername: null })
    const mode = createLabelsMode()
    await expect(mode.executor(makeRequest({ seedArtists: ['Seed'] }))).rejects.toThrow(/discogs/i)
  })

  it('caps the traversal to at most 3 seeds', async () => {
    mockGetLabelsForArtist.mockResolvedValue(['Label'])
    mockGetArtistsForLabel.mockResolvedValue([])
    const mode = createLabelsMode()
    await mode.executor(makeRequest({ seedArtists: ['s1', 's2', 's3', 's4', 's5'] }))
    expect(mockGetLabelsForArtist).toHaveBeenCalledTimes(3)
  })

  it('throws when no seed artists are provided', async () => {
    const mode = createLabelsMode()
    await expect(mode.executor(makeRequest({ seedArtists: [] }))).rejects.toThrow(/seed artist/i)
  })
})
