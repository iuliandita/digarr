// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runSubscription } from '@/core/subscriptions/runner'
import type {
  DiscoveryModeSubscriptionConfig,
  SubscriptionConfig,
  SubscriptionRunDeps,
} from '@/core/subscriptions/types'

function makeSubscription(
  sourceConfig: DiscoveryModeSubscriptionConfig,
  overrides: Partial<SubscriptionConfig> = {},
): SubscriptionConfig {
  return {
    id: 1,
    userId: 7,
    sourceType: 'discovery-mode',
    sourceConfig,
    maxArtistsPerRun: null,
    scoreThreshold: null,
    scoringWeightPreset: null,
    scoringWeightOverrides: null,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<SubscriptionRunDeps> = {}): SubscriptionRunDeps {
  return {
    db: {
      getExistingRecommendationMbids: vi.fn().mockResolvedValue(new Set()),
      insertBatch: vi.fn().mockResolvedValue({ id: 99 }),
      completeBatch: vi.fn().mockResolvedValue(undefined),
      failBatch: vi.fn().mockResolvedValue(undefined),
      upsertArtist: vi.fn().mockResolvedValue({ id: 1 }),
      insertRecommendation: vi.fn().mockResolvedValue(undefined),
      getRejectedMbids: vi.fn().mockResolvedValue(new Set()),
      getBlockedMbids: vi.fn().mockResolvedValue(new Set()),
      getFeedbackHistory: vi.fn().mockResolvedValue(new Map()),
    },
    queries: {
      updateSubscription: vi.fn().mockResolvedValue(undefined),
      getBatchStats: vi.fn().mockResolvedValue({ added: 3 }),
    },
    jobRecorder: {
      start: vi.fn().mockResolvedValue(10),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      markStuck: vi.fn().mockResolvedValue(0),
    },
    mbClient: {
      lookupArtist: vi.fn().mockResolvedValue({}),
      searchArtist: vi.fn().mockResolvedValue({ artists: [] }),
      extractStreamingUrls: vi.fn().mockReturnValue({}),
    },
    libraryMbids: new Set<string>(),
    libraryGenres: [],
    rejectedMbids: new Set<string>(),
    blockedMbids: new Set<string>(),
    feedbackHistory: new Map(),
    cooldownDays: 30,
    defaultScoreThreshold: 0.5,
    discoveryModeRunner: vi.fn().mockResolvedValue({ batchId: 123, artistsFound: 5 }),
    discoveryModeRegistry: {} as never,
    pipelineOrchestrator: {} as never,
    discoveryModePipelineDeps: {
      settings: {
        preferences: {
          scoreThreshold: 0.5,
          scoringWeights: {
            consensus: 0.3,
            similarity: 0.25,
            genreOverlap: 0.2,
            aiConfidence: 0.15,
            feedbackBoost: 0.1,
            popularity: 0,
          },
        },
      },
    } as never,
    ...overrides,
  }
}

describe('runSubscription discovery-mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records discovery-mode runs as subscription jobs and updates lastResultCount from the resulting batch', async () => {
    const deps = makeDeps()
    const adapter = {
      type: 'discovery-mode',
      label: 'Discovery Mode',
      configFields: [],
      fetch: vi.fn().mockResolvedValue({ artists: [] }),
    }

    const result = await runSubscription(
      makeSubscription({
        modeId: 'release-radar',
        settingsMode: 'advanced',
        settings: { seedArtists: ['Broadcast'], depth: 2 },
        providerContext: { providerPath: ['lastfm'] },
        fallbackPolicy: 'allow-fallback',
      }),
      adapter,
      deps,
    )

    expect(deps.jobRecorder.start).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subscription',
        subscriptionId: 1,
      }),
    )
    expect(deps.discoveryModeRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          modeId: 'release-radar',
          triggerType: 'subscription',
          settingsMode: 'advanced',
          userId: 7,
          rawUserSettings: { seedArtists: ['Broadcast'], depth: 2 },
          normalizedSettings: { seedArtists: ['Broadcast'], depth: 2 },
          providerContext: { providerPath: ['lastfm'] },
          fallbackPolicy: 'allow-fallback',
        },
        registry: deps.discoveryModeRegistry,
        orchestrator: deps.pipelineOrchestrator,
      }),
    )
    expect(adapter.fetch).not.toHaveBeenCalled()
    expect(deps.jobRecorder.complete).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        batchId: 123,
        metadata: expect.objectContaining({
          adapterType: 'discovery-mode',
          artistsFound: 5,
          artistsNew: 3,
        }),
      }),
    )
    expect(deps.queries.updateSubscription).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        lastResultCount: 3,
        lastError: null,
      }),
    )
    expect(result).toEqual({ runId: 10, batchId: 123, artistsFound: 5, artistsNew: 3 })
  })

  it('applies subscription scoring controls and maxArtistsPerRun to discovery-mode runs', async () => {
    const deps = makeDeps({
      discoveryModePipelineDeps: {
        settings: {
          preferences: {
            scoreThreshold: 0.5,
            scoringWeights: {
              consensus: 0.3,
              similarity: 0.25,
              genreOverlap: 0.2,
              aiConfidence: 0.15,
              feedbackBoost: 0.1,
              popularity: 0,
            },
          },
        },
      } as never,
    })
    const adapter = {
      type: 'discovery-mode',
      label: 'Discovery Mode',
      configFields: [],
      fetch: vi.fn().mockResolvedValue({ artists: [] }),
    }

    await runSubscription(
      makeSubscription(
        {
          modeId: 'release-radar',
          settingsMode: 'advanced',
          settings: { seedArtists: ['Broadcast'], depth: 2 },
          providerContext: { providerPath: ['lastfm'] },
          fallbackPolicy: 'allow-fallback',
        },
        {
          maxArtistsPerRun: 12,
          scoreThreshold: 0.82,
          scoringWeightPreset: 'balanced',
          scoringWeightOverrides: { popularity: 0.4 },
        },
      ),
      adapter,
      deps,
    )

    expect(deps.discoveryModeRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        maxArtistsPerRun: 12,
        pipelineDeps: expect.objectContaining({
          settings: expect.objectContaining({
            preferences: expect.objectContaining({
              scoreThreshold: 0.82,
              scoringWeights: expect.objectContaining({
                popularity: 0.4,
              }),
            }),
          }),
        }),
      }),
    )
  })

  it('canonicalizes modeId during runtime normalization before executing discovery-mode runs', async () => {
    const deps = makeDeps()
    const adapter = {
      type: 'discovery-mode',
      label: 'Discovery Mode',
      configFields: [],
      fetch: vi.fn().mockResolvedValue({ artists: [] }),
    }

    await runSubscription(
      makeSubscription({
        modeId: ' release-radar ',
        settingsMode: 'advanced',
        settings: { seedArtists: ['Broadcast'] },
        providerContext: { providerPath: ['lastfm'] },
        fallbackPolicy: 'allow-fallback',
      }),
      adapter,
      deps,
    )

    expect(deps.discoveryModeRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          modeId: 'release-radar',
          providerContext: { providerPath: ['lastfm'] },
          fallbackPolicy: 'allow-fallback',
        }),
      }),
    )
  })
})
