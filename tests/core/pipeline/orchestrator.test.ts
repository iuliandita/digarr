// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock all pipeline stages
// ---------------------------------------------------------------------------

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
// Mock client/plugin factories
// ---------------------------------------------------------------------------

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(() => ({ getArtists: vi.fn() })),
}))

vi.mock('@/core/plugins/listenbrainz', () => ({
  createListenBrainzSource: vi.fn(() => ({
    id: 'listenbrainz',
    name: 'ListenBrainz',
    getTopArtists: vi.fn(),
    getSimilarArtists: vi.fn(),
    testConnection: vi.fn(),
    getListeningActivity: vi.fn(),
  })),
}))

vi.mock('@/core/plugins/lastfm', () => ({
  createLastFmSource: vi.fn(() => ({
    id: 'lastfm',
    name: 'Last.fm',
    getTopArtists: vi.fn(),
    getSimilarArtists: vi.fn(),
    testConnection: vi.fn(),
  })),
}))

vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(() => ({
    lookupArtist: vi.fn(),
    searchArtist: vi.fn(),
    extractStreamingUrls: vi.fn(),
  })),
}))

vi.mock('@/core/providers/registry', () => ({
  AiProviderRegistry: vi.fn(),
  createDefaultRegistry: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

const { PipelineOrchestrator } = await import('@/core/pipeline/orchestrator')
type SyncForUser = NonNullable<
  import('@/core/pipeline/orchestrator').PipelineDeps['librarySync']
>['syncForUser']
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
      popularity: 0.0,
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

function makeProviderRegistry() {
  const mock = {
    create: vi.fn().mockResolvedValue({
      getRecommendations: vi.fn(),
      testConnection: vi.fn(),
    }),
    register: vi.fn(),
    has: vi.fn().mockReturnValue(true),
    availableIds: vi.fn().mockReturnValue(['anthropic', 'openai', 'ollama']),
  }
  return mock as unknown as import('@/core/providers/registry').AiProviderRegistry
}

function makeDb() {
  return {
    getExistingRecommendationMbids: vi.fn().mockResolvedValue(new Set()),
    insertBatch: vi.fn().mockResolvedValue({ id: 42 }),
    completeBatch: vi.fn().mockResolvedValue(undefined),
    failBatch: vi.fn().mockResolvedValue(undefined),
    upsertArtist: vi.fn().mockResolvedValue({ id: 1 }),
    insertRecommendation: vi.fn().mockResolvedValue(undefined),
    getRejectedMbids: vi.fn().mockResolvedValue(new Set()),
    getBlockedMbids: vi.fn().mockResolvedValue(new Set()),
    getFeedbackHistory: vi.fn().mockResolvedValue(new Map()),
    getLibraryArtistsForUser: vi.fn().mockResolvedValue([
      {
        mbid: 'mbid-1',
        name: 'Artist 1',
        source: 'lidarr',
        sourceArtistId: '1',
        genres: ['rock', 'electronic'],
        matchMethod: 'mbid',
        matchConfidence: 1.0,
      },
    ]),
    userHasOwnSyncState: vi.fn().mockResolvedValue(true),
    // Extra methods the orchestrator needs for stale batch cleanup
    updateBatch: vi.fn().mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineOrchestrator', () => {
  let orchestrator: InstanceType<typeof PipelineOrchestrator>
  let mockAnalyze: ReturnType<typeof vi.fn>
  let mockDiscover: ReturnType<typeof vi.fn>
  let mockResolve: ReturnType<typeof vi.fn>
  let mockScore: ReturnType<typeof vi.fn>
  let mockFilter: ReturnType<typeof vi.fn>
  let mockStore: ReturnType<typeof vi.fn>
  let providerRegistry: ReturnType<typeof makeProviderRegistry>
  let syncForUser: SyncForUser

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

  function setupPipelineMocks() {
    mockAnalyze = vi.mocked(analyze)
    mockDiscover = vi.mocked(discover)
    mockResolve = vi.mocked(resolve)
    mockScore = vi.mocked(score)
    mockFilter = vi.mocked(filter)
    mockStore = vi.mocked(store)

    mockAnalyze.mockResolvedValue(tasteProfile)
    mockDiscover.mockResolvedValue(discovered)
    mockResolve.mockResolvedValue(resolved)
    mockScore.mockReturnValue(scored)
    mockFilter.mockReturnValue(filtered)
    mockStore.mockResolvedValue(42)
  }

  async function setupClientMocks() {
    const { createListenBrainzSource } = await import('@/core/plugins/listenbrainz')
    const { createLastFmSource } = await import('@/core/plugins/lastfm')
    const { createLidarrClient } = await import('@/core/clients/lidarr')
    const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')

    vi.mocked(createLidarrClient).mockReturnValue({ getArtists: vi.fn() } as unknown as ReturnType<
      typeof createLidarrClient
    >)
    vi.mocked(createListenBrainzSource).mockReturnValue({
      id: 'listenbrainz',
      name: 'ListenBrainz',
      capabilities: ['topArtists', 'similarArtists', 'listeningActivity'],
      getTopArtists: vi.fn(),
      getSimilarArtists: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
      getListeningActivity: vi.fn(),
    })
    vi.mocked(createLastFmSource).mockReturnValue({
      id: 'lastfm',
      name: 'Last.fm',
      capabilities: ['topArtists', 'similarArtists', 'genreArtists'],
      getTopArtists: vi.fn(),
      getSimilarArtists: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    })
    vi.mocked(createMusicBrainzClient).mockReturnValue({
      lookupArtist: vi.fn(),
      searchArtist: vi.fn(),
      extractStreamingUrls: vi.fn(),
    } as unknown as ReturnType<typeof createMusicBrainzClient>)
  }

  beforeEach(async () => {
    orchestrator = new PipelineOrchestrator()
    providerRegistry = makeProviderRegistry()
    syncForUser = vi.fn(async () => ({ userId: 1, results: [] })) as SyncForUser
    vi.clearAllMocks()
    setupPipelineMocks()
    await setupClientMocks()
  })

  it('runs all pipeline stages in order', async () => {
    const db = makeDb()
    const order: string[] = []

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

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    expect(order).toEqual(['analyze', 'discover', 'resolve', 'score', 'filter', 'store'])
  })

  it('passes response and prompt locales from pipeline deps into AI discovery', async () => {
    const db = makeDb()

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
      responseLocale: 'fr',
      promptLocale: 'es',
    })

    expect(mockDiscover).toHaveBeenCalledWith(
      expect.objectContaining({
        ...tasteProfile,
        responseLocale: 'fr',
        promptLocale: 'es',
      }),
      expect.anything(),
      expect.any(Number),
      expect.anything(),
      expect.any(Number),
      expect.anything(),
    )
  })

  it('emits progress events for each stage', async () => {
    const db = makeDb()
    const stages: string[] = []

    orchestrator.on('progress', (event: { stage: string }) => {
      stages.push(event.stage)
    })

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    expect(stages).toContain('collect')
    expect(stages).toContain('analyze')
    expect(stages).toContain('discover')
    expect(stages).toContain('resolve')
    expect(stages).toContain('score')
    expect(stages).toContain('filter')
    expect(stages).toContain('store')
    expect(stages).toContain('complete')
  })

  it('surfaces AI source failure in job sourceResults and progress', async () => {
    const db = makeDb()
    const aiError = 'client error 404: models/gemini-x is not found for API version v1beta'
    mockDiscover.mockImplementation(
      async (
        _profile: unknown,
        _sources: unknown,
        _limit: unknown,
        _seeds: unknown,
        _ratio: unknown,
        options?: { onSourceFailure?: (sourceId: string, error: string) => void },
      ) => {
        options?.onSourceFailure?.('ai', aiError)
        return discovered
      },
    )
    const jobRecorder = {
      start: vi.fn().mockResolvedValue(7),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      markStuck: vi.fn().mockResolvedValue(0),
    }
    const messages: string[] = []
    orchestrator.on('progress', (event: { message?: string }) => {
      if (event.message) messages.push(event.message)
    })

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
      jobRecorder,
    })

    expect(jobRecorder.complete).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        sourceResults: expect.objectContaining({
          ai: { status: 'error', error: aiError },
        }),
      }),
    )
    expect(messages.some((m) => m.includes(aiError))).toBe(true)
  })

  it('returns batchId on success', async () => {
    const db = makeDb()
    const result = await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })
    expect(result).toEqual({ batchId: 42 })
  })

  it('passes subscriptionId to store for discovery-mode subscription runs', async () => {
    const db = makeDb()

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
      subscriptionId: 77,
      explicitDiscoveryMode: {
        modeId: 'labels',
        settingsMode: 'advanced',
        providerPath: ['discogs', 'labels'],
      },
      explicitCandidates: discovered,
    })

    expect(mockStore).toHaveBeenCalledWith(
      expect.anything(),
      db,
      expect.objectContaining({ userId: 1, subscriptionId: 77 }),
    )
  })

  it('emits error event and rethrows on stage failure', async () => {
    const db = makeDb()
    const boom = new Error('analyze exploded')
    mockAnalyze.mockRejectedValue(boom)

    const errors: unknown[] = []
    orchestrator.on('error', (err: unknown) => errors.push(err))

    await expect(
      orchestrator.run({
        db,
        settings: defaultSettings,
        providerRegistry,
        librarySync: { syncForUser },
        userId: 1,
      }),
    ).rejects.toThrow('analyze exploded')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(boom)
  })

  it('resets isRunning to false after error', async () => {
    const db = makeDb()
    mockAnalyze.mockRejectedValue(new Error('oops'))
    orchestrator.on('error', () => {}) // prevent unhandled

    await orchestrator
      .run({
        db,
        settings: defaultSettings,
        providerRegistry,
        librarySync: { syncForUser },
        userId: 1,
      })
      .catch(() => {})
    expect(orchestrator.isRunning).toBe(false)
  })

  it('rejects concurrent runs while pipeline is running', async () => {
    const db = makeDb()

    // Make analyze hang so the first run stays in-flight
    let resolveAnalyze!: () => void
    mockAnalyze.mockReturnValue(
      new Promise<typeof tasteProfile>((res) => {
        resolveAnalyze = () => res(tasteProfile)
      }),
    )

    const firstRun = orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    await expect(
      orchestrator.run({
        db,
        settings: defaultSettings,
        providerRegistry,
        librarySync: { syncForUser },
        userId: 1,
      }),
    ).rejects.toThrow('Pipeline already running')

    // Clean up the dangling promise
    resolveAnalyze()
    await firstRun.catch(() => {})
  })

  it('isRunning is false before any run', () => {
    expect(orchestrator.isRunning).toBe(false)
  })

  it('isRunning is false after successful run', async () => {
    const db = makeDb()
    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })
    expect(orchestrator.isRunning).toBe(false)
  })

  it('enqueue starts immediately when idle', async () => {
    const db = makeDb()
    const result = orchestrator.enqueue({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })
    expect(result).toEqual({ status: 'started', position: 0 })
    await vi.waitFor(() => expect(orchestrator.isRunning).toBe(false))
  })

  it('queues a second run behind an in-flight one and drains on completion', async () => {
    const db = makeDb()

    // Hang the first run so it stays in flight while we enqueue more.
    let resolveAnalyze!: () => void
    mockAnalyze.mockReturnValue(
      new Promise<typeof tasteProfile>((res) => {
        resolveAnalyze = () => res(tasteProfile)
      }),
    )

    const first = orchestrator.enqueue({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })
    expect(first.status).toBe('started')
    expect(orchestrator.isRunning).toBe(true)

    const second = orchestrator.enqueue({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 2,
    })
    expect(second).toEqual({ status: 'queued', position: 1 })
    expect(orchestrator.queueLength).toBe(1)
    expect(orchestrator.queuePositionFor(2)).toBe(1)

    // Same user again while busy is deduped, not stacked.
    const dupe = orchestrator.enqueue({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 2,
    })
    expect(dupe.status).toBe('duplicate')
    expect(orchestrator.queueLength).toBe(1)

    // Finishing the first run drains the queue and starts the second.
    resolveAnalyze()
    await vi.waitFor(() => expect(orchestrator.queueLength).toBe(0))
    await vi.waitFor(() => expect(orchestrator.isRunning).toBe(false))
  })

  it('drains the queue and starts the next run even when the in-flight run FAILS', async () => {
    // Regression guard: drainQueue() must stay in the `finally` block. If it ever
    // moves into the success branch, a failed run would never release the queue
    // and the orchestrator would wedge -- every queued run stuck forever.
    const db = makeDb()
    orchestrator.on('error', () => {}) // swallow A's failure

    let rejectFirst!: () => void
    const firstAnalyze = new Promise<typeof tasteProfile>((_res, rej) => {
      rejectFirst = () => rej(new Error('run A exploded'))
    })
    // Run A's analyze hangs then rejects; run B's analyze (every later call) succeeds.
    mockAnalyze.mockReturnValueOnce(firstAnalyze).mockReturnValue(Promise.resolve(tasteProfile))

    const first = orchestrator.enqueue({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })
    expect(first.status).toBe('started')

    const second = orchestrator.enqueue({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 2,
    })
    expect(second).toEqual({ status: 'queued', position: 1 })
    expect(orchestrator.queueLength).toBe(1)

    // Fail the in-flight run A. The queue must still drain and run B.
    rejectFirst()

    await vi.waitFor(() => expect(orchestrator.queueLength).toBe(0))
    await vi.waitFor(() => expect(orchestrator.isRunning).toBe(false))
    // B actually started (analyze called for A then B) and completed (store ran once).
    expect(mockAnalyze).toHaveBeenCalledTimes(2)
    expect(mockStore).toHaveBeenCalledTimes(1)
  })

  it('skips LB source when listenbrainzUsername is null', async () => {
    const { createListenBrainzSource } = await import('@/core/plugins/listenbrainz')
    const db = makeDb()
    const settings = { ...defaultSettings, listenbrainzUsername: null, listenbrainzToken: null }

    await orchestrator.run({
      db,
      settings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    expect(vi.mocked(createListenBrainzSource)).not.toHaveBeenCalled()
  })

  it('passes deduplicated library genres to score()', async () => {
    const db = {
      ...makeDb(),
      getLibraryArtistsForUser: vi.fn().mockResolvedValue([
        {
          mbid: 'mbid-1',
          name: 'Artist 1',
          source: 'lidarr',
          sourceArtistId: '1',
          genres: ['rock', 'electronic'],
          matchMethod: 'mbid',
          matchConfidence: 1.0,
        },
        {
          mbid: 'mbid-2',
          name: 'Artist 2',
          source: 'plex',
          sourceArtistId: '2',
          genres: ['electronic', 'jazz'],
          matchMethod: 'name_exact',
          matchConfidence: 0.7,
        },
      ]),
    }

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    // score() is the 5th stage - check its second argument (libraryGenres)
    const scoreCall = mockScore.mock.calls[0]
    const passedGenres = scoreCall?.[1] as string[]
    expect(passedGenres).toBeDefined()
    expect(passedGenres.sort()).toEqual(['electronic', 'jazz', 'rock'])
  })

  it('skips LFM source when lastfmUsername is null', async () => {
    const { createLastFmSource } = await import('@/core/plugins/lastfm')
    const db = makeDb()
    const settings = { ...defaultSettings, lastfmUsername: null, lastfmApiKey: null }

    await orchestrator.run({
      db,
      settings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    expect(vi.mocked(createLastFmSource)).not.toHaveBeenCalled()
  })

  it('succeeds without Lidarr when a listening source is configured', async () => {
    const db = makeDb()
    const settings = {
      ...defaultSettings,
      lidarrUrl: null,
      lidarrApiKey: null,
    }

    const result = await orchestrator.run({
      db,
      settings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    expect(result).toEqual({ batchId: 42 })
    const { createLidarrClient } = await import('@/core/clients/lidarr')
    expect(vi.mocked(createLidarrClient)).not.toHaveBeenCalled()
    expect(syncForUser).toHaveBeenCalledWith(1, expect.anything())
  })

  it('throws when neither Lidarr nor listening sources nor AI are configured', async () => {
    const db = makeDb()
    const settings = {
      ...defaultSettings,
      lidarrUrl: null,
      lidarrApiKey: null,
      listenbrainzUsername: null,
      listenbrainzToken: null,
      lastfmUsername: null,
      lastfmApiKey: null,
      aiProvider: null,
      aiApiKey: null,
      aiModel: null,
    }

    await expect(
      orchestrator.run({
        db,
        settings,
        providerRegistry,
        librarySync: { syncForUser },
        userId: 1,
      }),
    ).rejects.toThrow('At least one listening source or AI provider must be configured')
  })

  it('requires librarySync, userId, and library StoreDb methods', async () => {
    const db = makeDb()

    await expect(
      orchestrator.run({
        db,
        settings: defaultSettings,
        providerRegistry,
      } as unknown as import('@/core/pipeline/orchestrator').PipelineDeps),
    ).rejects.toThrow(
      'Pipeline orchestrator requires librarySync, userId, and library StoreDb methods',
    )
  })

  it('uses sync orchestrator when librarySync dep is provided', async () => {
    const db = makeDb()
    const dbWithLibrary: import('@/core/pipeline/store').StoreDb = {
      ...db,
      getLibraryArtistsForUser: vi.fn(async () => [
        {
          mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
          name: 'Radiohead',
          source: 'lidarr',
          sourceArtistId: '1',
          genres: ['rock'],
          matchMethod: 'mbid',
          matchConfidence: 1.0,
        },
      ]),
      userHasOwnSyncState: vi.fn(async () => true),
    }
    const syncForUser = vi.fn(async () => ({ userId: 1, results: [] })) as SyncForUser

    await orchestrator.run({
      db: dbWithLibrary,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    expect(syncForUser).toHaveBeenCalledWith(1, expect.anything())
    expect(dbWithLibrary.getLibraryArtistsForUser).toHaveBeenCalledWith(1, { onlyReconciled: true })
  })

  // A release-radar album for an artist already in the library must survive the
  // artist-existence filter (which would otherwise drop every tracked-artist
  // album) and reach store(); the same album is dropped once its release group
  // is already recommended. Both partitions run for real inside orchestrator.run
  // -- only filter() and store() are mocked, and album-kind candidates bypass
  // filter() entirely, so the assertion point is what store() receives.
  const trackedArtistLibrary = [
    {
      mbid: 'tracked-artist',
      name: 'Radiohead',
      source: 'lidarr',
      sourceArtistId: '1',
      genres: ['rock'],
      matchMethod: 'mbid',
      matchConfidence: 1.0,
    },
  ]

  const albumScored = [
    {
      mbid: 'tracked-artist',
      name: 'Radiohead',
      tags: [],
      genres: [],
      streamingUrls: {},
      discoveries: [{ name: 'Radiohead', similarityScore: 0.8, source: 'release-radar' }],
      score: 0.9,
      sourceScores: { recency: 0.95 },
      kind: 'album' as const,
      releaseGroupMbid: 'rg-new',
      releaseDate: '2026-06-01',
      suggestedAlbum: { releaseGroupId: 'rg-new', title: 'New One' },
    },
  ]

  it('stores a release-radar album for an artist already in the library', async () => {
    const db = {
      ...makeDb(),
      getLibraryArtistsForUser: vi.fn().mockResolvedValue(trackedArtistLibrary),
      getExistingRecommendationMbids: vi.fn().mockResolvedValue(new Set<string>()),
      getExistingAlbumReleaseGroupMbids: vi.fn().mockResolvedValue(new Set<string>()),
      getBlockedAlbumKeys: vi.fn().mockResolvedValue(new Set<string>()),
    }
    mockScore.mockReturnValue(albumScored as never)
    // Pass-through the (mocked) artist filter so what reaches store() reflects
    // the orchestrator's real album partition, not the default fixture.
    mockFilter.mockImplementation((artists) => artists as never)

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    expect(mockStore).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'album',
          releaseGroupMbid: 'rg-new',
          suggestedAlbum: expect.objectContaining({ releaseGroupId: 'rg-new' }),
        }),
      ]),
      db,
      expect.anything(),
    )

    // Load-bearing: prove the orchestrator routed the album down the bypass
    // branch instead of through filter(). The artist-existence filter is called
    // unconditionally (with an empty array here), so it must never see the
    // album candidate. If Task 6's partition were reverted, the album would
    // flow into filter() and this assertion would fail.
    expect(mockFilter).toHaveBeenCalled()
    const artistKindArg = mockFilter.mock.calls[0]?.[0] ?? []
    expect(artistKindArg).not.toContainEqual(
      expect.objectContaining({ releaseGroupMbid: 'rg-new' }),
    )
  })

  it('drops a release-radar album whose release group is already recommended', async () => {
    const db = {
      ...makeDb(),
      getLibraryArtistsForUser: vi.fn().mockResolvedValue(trackedArtistLibrary),
      getExistingRecommendationMbids: vi.fn().mockResolvedValue(new Set<string>()),
      getExistingAlbumReleaseGroupMbids: vi.fn().mockResolvedValue(new Set(['rg-new'])),
      getBlockedAlbumKeys: vi.fn().mockResolvedValue(new Set<string>()),
    }
    mockScore.mockReturnValue(albumScored as never)
    mockFilter.mockImplementation((artists) => artists as never)

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    // Album dropped by dedup, no artist-kind candidates survive -> store gets [].
    expect(mockStore).toHaveBeenCalledWith([], db, expect.anything())
  })

  it('fire-and-forgets first library sync when user has no prior sync state', async () => {
    const db = makeDb()
    const dbWithLibrary: import('@/core/pipeline/store').StoreDb = {
      ...db,
      getLibraryArtistsForUser: vi.fn(async () => []),
      userHasOwnSyncState: vi.fn(async () => false), // first sync ever
    }
    // Never resolves - simulates a slow first sync without leaking a timer
    // past the end of the test.
    const syncForUser = vi.fn(() => new Promise(() => {})) as SyncForUser

    const result = await orchestrator.run({
      db: dbWithLibrary,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    // Pipeline must complete WITHOUT waiting for the slow first sync
    expect(result).toEqual({ batchId: 42 })
    expect(syncForUser).toHaveBeenCalled()
    // It should still read from the (empty) cache
    expect(dbWithLibrary.getLibraryArtistsForUser).toHaveBeenCalled()
  })

  it('passes netNewAlbumDiscovery into resolve()', async () => {
    const db = makeDb()
    const settings = {
      ...defaultSettings,
      preferences: {
        ...defaultSettings.preferences,
        netNewAlbumDiscovery: true,
      },
    }

    await orchestrator.run({
      db,
      settings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    const call = mockResolve.mock.calls.at(-1)
    expect(call?.[8]).toBe(true)
  })

  it('uses libraryGenres as the reference set when library artists are present (library-install parity)', async () => {
    const db = {
      ...makeDb(),
      getLibraryArtistsForUser: vi.fn().mockResolvedValue([
        {
          mbid: 'mbid-1',
          name: 'Library Artist',
          source: 'lidarr',
          sourceArtistId: '1',
          genres: ['rock', 'metal'],
          matchMethod: 'mbid',
          matchConfidence: 1.0,
        },
      ]),
    }
    // Taste profile with genres from listening sources
    mockAnalyze.mockResolvedValue({
      ...tasteProfile,
      topGenres: [
        { name: 'electronic', weight: 1.0 },
        { name: 'ambient', weight: 0.5 },
      ],
    })

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    const scoreCall = mockScore.mock.calls[0]
    const referenceGenres = scoreCall?.[1] as string[]
    // Library present: must use libraryGenres, NOT listening-derived genres
    expect(referenceGenres.sort()).toEqual(['metal', 'rock'])
    expect(referenceGenres).not.toContain('electronic')
  })

  it('uses listening-derived topGenres as the reference set when library is empty (discovery-only mode)', async () => {
    const db = {
      ...makeDb(),
      getLibraryArtistsForUser: vi.fn().mockResolvedValue([]),
    }
    // Taste profile carries genres from Spotify
    mockAnalyze.mockResolvedValue({
      ...tasteProfile,
      topGenres: [
        { name: 'electronic', weight: 1.0 },
        { name: 'ambient', weight: 0.5 },
      ],
    })

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    const scoreCall = mockScore.mock.calls[0]
    const referenceGenres = scoreCall?.[1] as string[]
    // No library: must fall back to listening-derived genre names
    expect(referenceGenres.sort()).toEqual(['ambient', 'electronic'])
  })

  it('passes empty reference genres when both library and listening genres are absent', async () => {
    const db = {
      ...makeDb(),
      getLibraryArtistsForUser: vi.fn().mockResolvedValue([]),
    }
    // Taste profile with no genres (no Spotify or sources without genre data)
    mockAnalyze.mockResolvedValue({
      ...tasteProfile,
      topGenres: [],
    })

    await orchestrator.run({
      db,
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
    })

    const scoreCall = mockScore.mock.calls[0]
    const referenceGenres = scoreCall?.[1] as string[]
    expect(referenceGenres).toEqual([])
  })
})
