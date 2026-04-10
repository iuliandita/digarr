import { describe, expect, it, vi } from 'vitest'
import { executeDiscoveryMode } from '@/core/discovery-modes/executor'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

describe('executeDiscoveryMode', () => {
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
})
