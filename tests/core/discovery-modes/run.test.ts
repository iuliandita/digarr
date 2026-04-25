import { describe, expect, it, vi } from 'vitest'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import { runDiscoveryMode } from '@/core/discovery-modes/run'
import type { PipelineDeps } from '@/core/pipeline/orchestrator'

function makeRequest(): DiscoveryModeRequest {
  return {
    modeId: 'labels',
    triggerType: 'manual',
    settingsMode: 'easy',
    userId: 7,
    rawUserSettings: { seedArtists: ['Broadcast'] },
    normalizedSettings: { seedArtists: ['Broadcast'] },
    providerContext: { providerPath: ['discogs', 'labels'] },
    fallbackPolicy: 'allow-fallback',
  }
}

function makePipelineDeps(): Omit<
  PipelineDeps,
  'explicitCandidates' | 'explicitDiscoveryMode' | 'jobRecorder' | 'trigger' | 'userId'
> {
  return {
    db: {
      getExistingRecommendationMbids: vi.fn(async () => new Set<string>()),
      insertBatch: vi.fn(async () => ({ id: 1 })),
      completeBatch: vi.fn(async () => undefined),
      upsertArtist: vi.fn(async () => ({ id: 1 })),
      insertRecommendation: vi.fn(async () => undefined),
      getRejectedMbids: vi.fn(async () => new Set<string>()),
      getBlockedMbids: vi.fn(async () => new Set<string>()),
      getFeedbackHistory: vi.fn(async () => new Map()),
      getLibraryArtistsForUser: vi.fn(async () => []),
      userHasAnySyncState: vi.fn(async () => false),
    },
    settings: {
      lidarrUrl: null,
      lidarrApiKey: null,
      listenbrainzUsername: null,
      listenbrainzToken: null,
      lastfmUsername: null,
      lastfmApiKey: null,
      aiProvider: null,
      aiApiKey: null,
      aiModel: null,
      aiBaseUrl: null,
      preferences: null,
      skipTlsVerify: false,
      spotifyAccessToken: null,
    },
    librarySync: {
      syncForUser: vi.fn(async () => undefined),
    },
  }
}

describe('runDiscoveryMode', () => {
  it('creates a batch from a discovery mode run and records quick-discover-style provenance', async () => {
    const request = makeRequest()
    const pipelineDeps = makePipelineDeps()

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
      pipelineDeps,
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
        db: pipelineDeps.db,
        settings: pipelineDeps.settings,
        librarySync: pipelineDeps.librarySync,
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

  it('continues the run when job start recording fails', async () => {
    const request = makeRequest()
    const pipelineDeps = makePipelineDeps()
    const jobRecorder = {
      start: vi.fn(async () => {
        throw new Error('job start failed')
      }),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      markStuck: vi.fn(async () => 0),
    }
    const orchestrator = {
      run: vi.fn(async () => ({ batchId: 99 })),
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

    const run = await runDiscoveryMode({
      request,
      pipelineDeps,
      orchestrator: orchestrator as never,
      registry: registry as never,
      jobRecorder: jobRecorder as never,
    })

    expect(run).toEqual({ batchId: 99, artistsFound: 1 })
    expect(orchestrator.run).toHaveBeenCalledOnce()
    expect(jobRecorder.complete).not.toHaveBeenCalled()
    expect(jobRecorder.fail).not.toHaveBeenCalled()
  })

  it('records a failed quick-discover job when mode execution throws', async () => {
    const request = makeRequest()
    const pipelineDeps = makePipelineDeps()
    const jobRecorder = {
      start: vi.fn(async () => 22),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      markStuck: vi.fn(async () => 0),
    }
    const orchestrator = {
      run: vi.fn(async () => ({ batchId: 1 })),
    }
    const registry = {
      get: vi.fn().mockReturnValue({
        id: 'labels',
        executor: vi.fn(async () => {
          throw new Error('executor blew up')
        }),
      }),
    }

    await expect(
      runDiscoveryMode({
        request,
        pipelineDeps,
        orchestrator: orchestrator as never,
        registry: registry as never,
        jobRecorder: jobRecorder as never,
      }),
    ).rejects.toThrow('executor blew up')

    expect(jobRecorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'quick_discover' }),
    )
    expect(jobRecorder.fail).toHaveBeenCalledWith(22, 'executor blew up')
    expect(orchestrator.run).not.toHaveBeenCalled()
    expect(jobRecorder.complete).not.toHaveBeenCalled()
  })
})
