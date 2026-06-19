// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runSubscription } from '@/core/subscriptions/runner'
import type {
  SubscriptionAdapter,
  SubscriptionConfig,
  SubscriptionRunDeps,
} from '@/core/subscriptions/types'

vi.mock('@/core/pipeline/resolve', () => ({ resolve: vi.fn() }))
vi.mock('@/core/pipeline/score', () => ({ score: vi.fn() }))
vi.mock('@/core/pipeline/filter', () => ({ filter: vi.fn() }))
vi.mock('@/core/pipeline/store', () => ({ store: vi.fn() }))

import { filter } from '@/core/pipeline/filter'
import { resolve } from '@/core/pipeline/resolve'
import { score } from '@/core/pipeline/score'
import { store } from '@/core/pipeline/store'

const resolveMock = vi.mocked(resolve)
const scoreMock = vi.mocked(score)
const filterMock = vi.mocked(filter)
const storeMock = vi.mocked(store)

function makeSubscription(overrides: Partial<SubscriptionConfig> = {}): SubscriptionConfig {
  return {
    id: 1,
    userId: null,
    sourceType: 'test',
    sourceConfig: {},
    maxArtistsPerRun: 20,
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
    ...overrides,
  }
}

function makeAdapter(overrides: Partial<SubscriptionAdapter> = {}): SubscriptionAdapter {
  return {
    type: 'test',
    label: 'Test',
    configFields: [],
    fetch: vi.fn().mockResolvedValue({ artists: [] }),
    ...overrides,
  }
}

describe('runSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls adapter.fetch with sourceConfig and maxArtistsPerRun', async () => {
    const subscription = makeSubscription({ sourceConfig: { foo: 'bar' }, maxArtistsPerRun: 15 })
    const deps = makeDeps()
    const fetchFn = vi.fn().mockResolvedValue({ artists: [] })
    const adapter = makeAdapter({ fetch: fetchFn })

    await runSubscription(subscription, adapter, deps)

    expect(fetchFn).toHaveBeenCalledWith({ foo: 'bar' }, { limit: 15 })
  })

  it('starts a job record before fetching', async () => {
    const subscription = makeSubscription()
    const deps = makeDeps()
    const adapter = makeAdapter()

    await runSubscription(subscription, adapter, deps)

    expect(deps.jobRecorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'subscription', subscriptionId: 1 }),
    )
  })

  it('completes empty when adapter returns no artists', async () => {
    const subscription = makeSubscription()
    const deps = makeDeps()
    const adapter = makeAdapter({ fetch: vi.fn().mockResolvedValue({ artists: [] }) })

    const result = await runSubscription(subscription, adapter, deps)

    expect(resolveMock).not.toHaveBeenCalled()
    expect(deps.jobRecorder.complete).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        metadata: expect.objectContaining({ artistsFound: 0, artistsNew: 0 }),
      }),
    )
    expect(result.artistsFound).toBe(0)
    expect(result.artistsNew).toBe(0)
  })

  it('runs pipeline stages when adapter returns artists', async () => {
    const artists = [{ name: 'Artist A', mbid: 'mbid-a', similarityScore: 0.8, source: 'test' }]
    const resolved = [
      {
        mbid: 'mbid-a',
        name: 'Artist A',
        tags: [],
        genres: [],
        discoveries: [{ source: 'test', similarityScore: 0.8 }],
        streamingUrls: {},
        imageUrl: undefined,
        disambiguation: undefined,
      },
    ]
    const scored = [{ ...resolved[0], score: 0.75 }]
    const filtered = [{ ...scored[0] }]

    resolveMock.mockResolvedValue(resolved as never)
    scoreMock.mockReturnValue(scored as never)
    filterMock.mockReturnValue(filtered as never)
    storeMock.mockResolvedValue(5)

    const subscription = makeSubscription()
    const deps = makeDeps()
    const adapter = makeAdapter({
      fetch: vi.fn().mockResolvedValue({ artists }),
    })

    const result = await runSubscription(subscription, adapter, deps)

    expect(resolveMock).toHaveBeenCalled()
    expect(scoreMock).toHaveBeenCalled()
    expect(filterMock).toHaveBeenCalled()
    expect(storeMock).toHaveBeenCalled()
    expect(result.artistsFound).toBe(1)
    expect(result.artistsNew).toBe(1)
  })

  it('passes subscriptionId to store options', async () => {
    const artists = [{ name: 'Artist B', mbid: 'mbid-b', similarityScore: 0.7, source: 'test' }]
    const resolved = [
      {
        mbid: 'mbid-b',
        name: 'Artist B',
        tags: [],
        genres: [],
        discoveries: [{ source: 'test', similarityScore: 0.7 }],
        streamingUrls: {},
        imageUrl: undefined,
        disambiguation: undefined,
      },
    ]
    const scored = [{ ...resolved[0], score: 0.8 }]
    const filtered = [{ ...scored[0] }]

    resolveMock.mockResolvedValue(resolved as never)
    scoreMock.mockReturnValue(scored as never)
    filterMock.mockReturnValue(filtered as never)
    storeMock.mockResolvedValue(7)

    const subscription = makeSubscription({ id: 42, userId: 5 })
    const deps = makeDeps()
    const adapter = makeAdapter({
      fetch: vi.fn().mockResolvedValue({ artists }),
    })

    await runSubscription(subscription, adapter, deps)

    expect(storeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ subscriptionId: 42, userId: 5 }),
    )
  })

  it('records error and re-throws on adapter failure', async () => {
    const boom = new Error('adapter exploded')
    const adapter = makeAdapter({ fetch: vi.fn().mockRejectedValue(boom) })
    const deps = makeDeps()
    const subscription = makeSubscription()

    await expect(runSubscription(subscription, adapter, deps)).rejects.toThrow('adapter exploded')

    expect(deps.jobRecorder.fail).toHaveBeenCalledWith(10, 'adapter exploded')
    expect(deps.queries.updateSubscription).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ lastError: 'adapter exploded' }),
    )
  })
})
