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
        provenanceProvider: 'discogs',
        fallbackUsed: false,
      } as DiscoveryCandidate,
    ])

    expect(results).toEqual([])
  })
})
