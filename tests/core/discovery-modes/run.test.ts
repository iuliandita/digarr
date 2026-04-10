import { describe, expect, it, vi } from 'vitest'
import { runDiscoveryMode } from '@/core/discovery-modes/run'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

describe('runDiscoveryMode', () => {
  it('creates a batch from a discovery mode run and records quick-discover-style provenance', async () => {
    const request: DiscoveryModeRequest = {
      modeId: 'labels',
      triggerType: 'manual',
      settingsMode: 'easy',
      userId: 7,
      rawUserSettings: { seedArtists: ['Broadcast'] },
      normalizedSettings: { seedArtists: ['Broadcast'] },
      providerContext: { providerPath: ['discogs', 'labels'] },
      fallbackPolicy: 'allow-fallback',
    }

    const jobRecorder = {
      start: vi.fn(async () => 11),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      markStuck: vi.fn(async () => 0),
    }

    const orchestrator = {
      run: vi.fn(async () => ({ batchId: 42 })),
    }

    const registry = {
      get: vi.fn().mockReturnValue({
        id: 'labels',
        executor: vi.fn().mockResolvedValue({
          candidates: [
            {
              candidateType: 'artist',
              name: 'Stereolab',
              mbid: '11111111-1111-4111-8111-111111111111',
              provenanceProvider: 'discogs',
              fallbackUsed: false,
              confidenceHint: 0.91,
            },
          ],
        }),
      }),
    }

    const run = await runDiscoveryMode({
      request,
      orchestrator: orchestrator as never,
      registry: registry as never,
      jobRecorder: jobRecorder as never,
    })

    expect(run.batchId).toBe(42)
    expect(jobRecorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'quick_discover' }),
    )
    expect(orchestrator.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        trigger: 'manual',
        explicitDiscoveryMode: {
          modeId: 'labels',
          settingsMode: 'easy',
          providerPath: ['discogs', 'labels'],
        },
        explicitCandidates: [
          expect.objectContaining({
            name: 'Stereolab',
            mbid: '11111111-1111-4111-8111-111111111111',
            source: 'labels',
          }),
        ],
      }),
    )
  })
})
