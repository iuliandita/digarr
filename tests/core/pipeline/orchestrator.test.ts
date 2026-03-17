// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock all pipeline stages
// ---------------------------------------------------------------------------

vi.mock('@/core/pipeline/collect', () => ({
  collect: vi.fn(),
}))

vi.mock('@/core/pipeline/analyze', () => ({
  analyze: vi.fn(),
}))

vi.mock('@/core/pipeline/discover', () => ({
  discover: vi.fn(),
}))

vi.mock('@/core/pipeline/resolve', () => ({
  resolve: vi.fn(),
}))

vi.mock('@/core/pipeline/score', () => ({
  score: vi.fn(),
}))

vi.mock('@/core/pipeline/filter', () => ({
  filter: vi.fn(),
}))

vi.mock('@/core/pipeline/store', () => ({
  store: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock client factories
// ---------------------------------------------------------------------------

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(() => ({ getArtists: vi.fn() })),
}))

vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(() => ({
    getTopArtists: vi.fn(),
    getListeningActivity: vi.fn(),
    getSimilarArtists: vi.fn(),
  })),
}))

vi.mock('@/core/clients/lastfm', () => ({
  createLastFmClient: vi.fn(() => ({
    getTopArtists: vi.fn(),
    getSimilarArtists: vi.fn(),
  })),
}))

vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(() => ({
    lookupArtist: vi.fn(),
    searchArtist: vi.fn(),
    extractStreamingUrls: vi.fn(),
  })),
}))

vi.mock('@/core/providers/factory', () => ({
  createProvider: vi.fn(async () => ({
    getRecommendations: vi.fn(),
  })),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

const { PipelineOrchestrator } = await import('@/core/pipeline/orchestrator')
const { collect } = await import('@/core/pipeline/collect')
const { analyze } = await import('@/core/pipeline/analyze')
const { discover } = await import('@/core/pipeline/discover')
const { resolve } = await import('@/core/pipeline/resolve')
const { score } = await import('@/core/pipeline/score')
const { filter } = await import('@/core/pipeline/filter')
const { store } = await import('@/core/pipeline/store')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultSettings = {
  lidarrUrl: 'http://lidarr:8686',
  lidarrApiKey: 'lidarr-key',
  listenbrainzUsername: 'lbuser',
  listenbrainzToken: 'lb-token',
  lastfmUsername: 'lfmuser',
  lastfmApiKey: 'lfm-key',
  aiProvider: 'anthropic',
  aiApiKey: 'ai-key',
  aiModel: 'claude-3-5-sonnet-20241022',
  aiBaseUrl: null,
  preferences: {
    qualityProfileId: 1,
    metadataProfileId: 1,
    rootFolderId: 1,
    scheduleCron: '0 0 * * 0',
    scoreThreshold: 0.5,
    scoringWeights: {
      consensus: 0.3,
      similarity: 0.25,
      genreOverlap: 0.2,
      aiConfidence: 0.15,
      feedbackBoost: 0.1,
    },
    rejectionCooldownDays: 90,
    topArtistsLimit: 30,
    librarySeedRatio: 0.3,
  },
  setupComplete: true,
  id: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function makeDb() {
  return {
    getExistingRecommendationMbids: vi.fn().mockResolvedValue(new Set()),
    insertBatch: vi.fn().mockResolvedValue({ id: 42 }),
    completeBatch: vi.fn().mockResolvedValue(undefined),
    upsertArtist: vi.fn().mockResolvedValue({ id: 1 }),
    insertRecommendation: vi.fn().mockResolvedValue(undefined),
    getRejectedMbids: vi.fn().mockResolvedValue(new Set()),
    getFeedbackHistory: vi.fn().mockResolvedValue(new Map()),
    // Extra methods the orchestrator needs for stale batch cleanup
    updateBatch: vi.fn().mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineOrchestrator', () => {
  let orchestrator: InstanceType<typeof PipelineOrchestrator>
  let mockCollect: ReturnType<typeof vi.fn>
  let mockAnalyze: ReturnType<typeof vi.fn>
  let mockDiscover: ReturnType<typeof vi.fn>
  let mockResolve: ReturnType<typeof vi.fn>
  let mockScore: ReturnType<typeof vi.fn>
  let mockFilter: ReturnType<typeof vi.fn>
  let mockStore: ReturnType<typeof vi.fn>

  const libraryArtists = [{ mbid: 'mbid-1', name: 'Artist 1' }]
  const tasteProfile = {
    topArtists: [
      { name: 'Artist 1', mbid: 'mbid-1', playCount: 100, source: 'listenbrainz' as const },
    ],
    topGenres: [],
    listeningPatterns: { totalListens: 100, recentTrend: 'stable' as const },
  }
  const discovered = [{ name: 'New Artist', similarityScore: 0.8, source: 'listenbrainz' as const }]
  const resolved = [
    {
      mbid: 'mbid-new',
      name: 'New Artist',
      tags: ['rock'],
      genres: ['rock'],
      streamingUrls: {},
      discoveries: discovered,
    },
  ]
  // biome-ignore lint/style/noNonNullAssertion: test fixture is always defined
  const scored = [{ ...resolved[0]!, score: 0.7, sourceScores: { consensus: 0.25 } }]
  const filtered = scored

  beforeEach(async () => {
    orchestrator = new PipelineOrchestrator()

    mockCollect = vi.mocked(collect)
    mockAnalyze = vi.mocked(analyze)
    mockDiscover = vi.mocked(discover)
    mockResolve = vi.mocked(resolve)
    mockScore = vi.mocked(score)
    mockFilter = vi.mocked(filter)
    mockStore = vi.mocked(store)

    // Clear all mocks so call counts don't accumulate across tests
    vi.clearAllMocks()

    // Re-apply default mock implementations after clearing
    const { createListenBrainzClient } = await import('@/core/clients/listenbrainz')
    const { createLastFmClient } = await import('@/core/clients/lastfm')
    const { createLidarrClient } = await import('@/core/clients/lidarr')
    const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')
    const { createProvider } = await import('@/core/providers/factory')

    vi.mocked(createLidarrClient).mockReturnValue({ getArtists: vi.fn() } as unknown as ReturnType<
      typeof createLidarrClient
    >)
    vi.mocked(createListenBrainzClient).mockReturnValue({
      getTopArtists: vi.fn(),
      getListeningActivity: vi.fn(),
      getSimilarArtists: vi.fn(),
    } as unknown as ReturnType<typeof createListenBrainzClient>)
    vi.mocked(createLastFmClient).mockReturnValue({
      getTopArtists: vi.fn(),
      getSimilarArtists: vi.fn(),
    } as unknown as ReturnType<typeof createLastFmClient>)
    vi.mocked(createMusicBrainzClient).mockReturnValue({
      lookupArtist: vi.fn(),
      searchArtist: vi.fn(),
      extractStreamingUrls: vi.fn(),
    } as unknown as ReturnType<typeof createMusicBrainzClient>)
    vi.mocked(createProvider).mockResolvedValue({
      getRecommendations: vi.fn(),
      testConnection: vi.fn(),
    })

    mockCollect.mockResolvedValue(libraryArtists)
    mockAnalyze.mockResolvedValue(tasteProfile)
    mockDiscover.mockResolvedValue(discovered)
    mockResolve.mockResolvedValue(resolved)
    mockScore.mockReturnValue(scored)
    mockFilter.mockReturnValue(filtered)
    mockStore.mockResolvedValue(42)
  })

  it('runs all pipeline stages in order', async () => {
    const db = makeDb()
    const order: string[] = []

    mockCollect.mockImplementation(async () => {
      order.push('collect')
      return libraryArtists
    })
    mockAnalyze.mockImplementation(async () => {
      order.push('analyze')
      return tasteProfile
    })
    mockDiscover.mockImplementation(async () => {
      order.push('discover')
      return discovered
    })
    mockResolve.mockImplementation(async () => {
      order.push('resolve')
      return resolved
    })
    mockScore.mockImplementation(() => {
      order.push('score')
      return scored
    })
    mockFilter.mockImplementation(() => {
      order.push('filter')
      return filtered
    })
    mockStore.mockImplementation(async () => {
      order.push('store')
      return 42
    })

    await orchestrator.run({ db, settings: defaultSettings })

    expect(order).toEqual(['collect', 'analyze', 'discover', 'resolve', 'score', 'filter', 'store'])
  })

  it('emits progress events for each stage', async () => {
    const db = makeDb()
    const stages: string[] = []

    orchestrator.on('progress', (event: { stage: string }) => {
      stages.push(event.stage)
    })

    await orchestrator.run({ db, settings: defaultSettings })

    expect(stages).toContain('collect')
    expect(stages).toContain('analyze')
    expect(stages).toContain('discover')
    expect(stages).toContain('resolve')
    expect(stages).toContain('score')
    expect(stages).toContain('filter')
    expect(stages).toContain('store')
    expect(stages).toContain('complete')
  })

  it('returns batchId on success', async () => {
    const db = makeDb()
    const result = await orchestrator.run({ db, settings: defaultSettings })
    expect(result).toEqual({ batchId: 42 })
  })

  it('emits error event and rethrows on stage failure', async () => {
    const db = makeDb()
    const boom = new Error('collect exploded')
    mockCollect.mockRejectedValue(boom)

    const errors: unknown[] = []
    orchestrator.on('error', (err: unknown) => errors.push(err))

    await expect(orchestrator.run({ db, settings: defaultSettings })).rejects.toThrow(
      'collect exploded',
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(boom)
  })

  it('resets isRunning to false after error', async () => {
    const db = makeDb()
    mockCollect.mockRejectedValue(new Error('oops'))
    orchestrator.on('error', () => {}) // prevent unhandled

    await orchestrator.run({ db, settings: defaultSettings }).catch(() => {})
    expect(orchestrator.isRunning).toBe(false)
  })

  it('rejects concurrent runs while pipeline is running', async () => {
    const db = makeDb()

    // Make collect hang so the first run stays in-flight
    let resolveCollect!: () => void
    mockCollect.mockReturnValue(
      new Promise<typeof libraryArtists>((res) => {
        resolveCollect = () => res(libraryArtists)
      }),
    )

    const firstRun = orchestrator.run({ db, settings: defaultSettings })

    await expect(orchestrator.run({ db, settings: defaultSettings })).rejects.toThrow(
      'Pipeline already running',
    )

    // Clean up the dangling promise
    resolveCollect()
    // Analyze etc. still need to resolve for the first run to finish
    await firstRun.catch(() => {})
  })

  it('isRunning is false before any run', () => {
    expect(orchestrator.isRunning).toBe(false)
  })

  it('isRunning is false after successful run', async () => {
    const db = makeDb()
    await orchestrator.run({ db, settings: defaultSettings })
    expect(orchestrator.isRunning).toBe(false)
  })

  it('skips LB client when listenbrainzUsername is null', async () => {
    const { createListenBrainzClient } = await import('@/core/clients/listenbrainz')
    const db = makeDb()
    const settings = { ...defaultSettings, listenbrainzUsername: null, listenbrainzToken: null }

    await orchestrator.run({ db, settings })

    expect(vi.mocked(createListenBrainzClient)).not.toHaveBeenCalled()
  })

  it('skips LFM client when lastfmUsername is null', async () => {
    const { createLastFmClient } = await import('@/core/clients/lastfm')
    const db = makeDb()
    const settings = { ...defaultSettings, lastfmUsername: null, lastfmApiKey: null }

    await orchestrator.run({ db, settings })

    expect(vi.mocked(createLastFmClient)).not.toHaveBeenCalled()
  })
})
