import { describe, expect, it, vi } from 'vitest'
import { discoveryCandidatesToDiscoveredArtists } from '@/core/discovery-modes/candidates'
import { executeDiscoveryMode } from '@/core/discovery-modes/executor'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import type { DiscoveryCandidate } from '@/core/discovery-modes/types'

describe('executeDiscoveryMode', () => {
  it('defaults omitted provenanceMode from the request mode id', async () => {
    const request: DiscoveryModeRequest = {
      modeId: 'labels',
      triggerType: 'manual',
      settingsMode: 'easy',
      userId: 7,
      rawUserSettings: { seedArtists: ['Broadcast'] },
      normalizedSettings: { seedArtists: ['Broadcast'] },
      providerContext: {},
      fallbackPolicy: 'allow-fallback',
    }

    const registry = {
      get: vi.fn().mockReturnValue({
        id: 'labels',
        executor: vi.fn().mockResolvedValue({
          candidates: [
            {
              candidateType: 'artist',
              name: 'Stereolab',
              provenanceProvider: 'discogs',
              fallbackUsed: false,
            },
          ],
        }),
      }),
    }

    const result = await executeDiscoveryMode(request, registry as never)

    expect(result.candidates[0]).toMatchObject({
      name: 'Stereolab',
      provenanceMode: 'labels',
      provenanceProvider: 'discogs',
    })
  })

  it('normalizes executor output into candidate envelopes with provenance', async () => {
    const request: DiscoveryModeRequest = {
      modeId: 'labels',
      triggerType: 'manual',
      settingsMode: 'easy',
      userId: 7,
      rawUserSettings: { seedArtists: ['Broadcast'] },
      normalizedSettings: { seedArtists: ['Broadcast'] },
      providerContext: {},
      fallbackPolicy: 'allow-fallback',
    }

    const registry = {
      get: vi.fn().mockReturnValue({
        id: 'labels',
        executor: vi.fn().mockResolvedValue({
          candidates: [
            {
              candidateType: 'artist',
              name: 'Stereolab',
              provenanceMode: 'labels',
              provenanceProvider: 'discogs',
              fallbackUsed: false,
            },
          ],
        }),
      }),
    }

    const result = await executeDiscoveryMode(request, registry as never)
    expect(result.candidates[0]).toMatchObject({
      provenanceMode: 'labels',
      provenanceProvider: 'discogs',
    })
  })

  it('throws when the requested mode id is not registered', async () => {
    const request: DiscoveryModeRequest = {
      modeId: 'missing-mode',
      triggerType: 'manual',
      settingsMode: 'easy',
      userId: 7,
      rawUserSettings: {},
      normalizedSettings: {},
      providerContext: {},
      fallbackPolicy: 'allow-fallback',
    }

    const registry = {
      get: vi.fn().mockReturnValue(undefined),
    }

    await expect(executeDiscoveryMode(request, registry as never)).rejects.toThrow(
      "Unknown discovery mode 'missing-mode'",
    )
  })

  it('skips malformed release candidates without an artistName', () => {
    const results = discoveryCandidatesToDiscoveredArtists([
      {
        candidateType: 'release',
        name: 'Loveless',
        artistMbid: 'artist-mbid-1',
        provenanceProvider: 'discogs',
        fallbackUsed: false,
      } as DiscoveryCandidate,
    ])

    expect(results).toEqual([])
  })

  it('maps release candidates using the artist MBID and preserves the release title', () => {
    const results = discoveryCandidatesToDiscoveredArtists([
      {
        candidateType: 'release',
        name: 'Dummy Release Title',
        artistName: 'Slowdive',
        artistMbid: 'artist-mbid-2',
        releaseMbid: 'release-mbid-2',
        releaseGroupMbid: 'release-group-mbid-2',
        provenanceMode: 'labels',
        provenanceProvider: 'discogs',
        confidenceHint: 0.93,
        fallbackUsed: false,
      } as DiscoveryCandidate,
    ])

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      name: 'Slowdive',
      mbid: 'artist-mbid-2',
      similarityScore: 0.93,
      suggestedAlbum: 'Dummy Release Title',
      source: 'labels',
    })
    expect(results[0]).not.toHaveProperty('releaseMbid')
  })
})
