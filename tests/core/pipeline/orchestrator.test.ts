// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceResult } from '@/core/jobs/types'
import type { PipelineDeps } from '@/core/pipeline/orchestrator'
import type { DiscoverySource } from '@/core/plugins/types'
import type { UserConnections } from '@/db/queries/users'

vi.mock('@/core/notifications', () => ({ dispatch: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/core/pipeline/analyze', () => ({ analyze: vi.fn() }))
vi.mock('@/core/pipeline/discover', () => ({ discover: vi.fn() }))
vi.mock('@/core/pipeline/resolve', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/pipeline/resolve')>()),
  resolve: vi.fn(),
}))
vi.mock('@/core/pipeline/score', () => ({ score: vi.fn() }))
vi.mock('@/core/pipeline/filter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/pipeline/filter')>()),
  filter: vi.fn(),
}))
vi.mock('@/core/pipeline/store', () => ({ store: vi.fn() }))
vi.mock('@/core/pipeline/genre-backfill', () => ({
  hydrateArtistGenres: vi.fn(),
  warmArtistGenres: vi.fn(),
}))
vi.mock('@/core/clients/lidarr', () => ({ createLidarrClient: vi.fn() }))
vi.mock('@/core/clients/listenbrainz', () => ({ createListenBrainzClient: vi.fn() }))
vi.mock('@/core/plugins/listenbrainz', () => ({ createListenBrainzSource: vi.fn() }))
vi.mock('@/core/plugins/lastfm', () => ({ createLastFmSource: vi.fn() }))
vi.mock('@/core/clients/musicbrainz', () => ({ createMusicBrainzClient: vi.fn() }))
vi.mock('@/core/providers/registry', () => ({
  AiProviderRegistry: vi.fn(),
  createDefaultRegistry: vi.fn(),
}))

const { PipelineOrchestrator } = await import('@/core/pipeline/orchestrator')
const { PipelineCancelledError } = await import('@/core/pipeline/cancel')
type SyncForUser = NonNullable<PipelineDeps['librarySync']>['syncForUser']
const { dispatch } = await import('@/core/notifications')
const { analyze } = await import('@/core/pipeline/analyze')
const { discover } = await import('@/core/pipeline/discover')
const { resolve } = await import('@/core/pipeline/resolve')
const { score } = await import('@/core/pipeline/score')
const { filter } = await import('@/core/pipeline/filter')
const { store } = await import('@/core/pipeline/store')
const { hydrateArtistGenres, warmArtistGenres } = await import('@/core/pipeline/genre-backfill')
const { createListenBrainzSource } = await import('@/core/plugins/listenbrainz')
const { createLastFmSource } = await import('@/core/plugins/lastfm')
const { createLidarrClient } = await import('@/core/clients/lidarr')
const { createListenBrainzClient } = await import('@/core/clients/listenbrainz')
const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')

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
  return {
    create: vi.fn().mockResolvedValue({ getRecommendations: vi.fn(), testConnection: vi.fn() }),
    register: vi.fn(),
    has: vi.fn().mockReturnValue(true),
    availableIds: vi.fn().mockReturnValue(['anthropic', 'openai', 'ollama']),
  } as unknown as import('@/core/providers/registry').AiProviderRegistry
}

function libraryArtist(name: string, genres: string[], mbid: string | null = 'mbid-1') {
  return {
    mbid,
    name,
    source: 'lidarr',
    sourceArtistId: '1',
    genres,
    matchMethod: 'mbid',
    matchConfidence: 1.0,
  }
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
    getLibraryArtistsForUser: vi
      .fn()
      .mockResolvedValue([libraryArtist('Artist 1', ['rock', 'electronic'])]),
    userHasOwnSyncState: vi.fn().mockResolvedValue(true),
    updateBatch: vi.fn().mockResolvedValue(undefined),
  }
}

function makeJobRecorder(id = 7) {
  return {
    start: vi.fn().mockResolvedValue(id),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    markStuck: vi.fn().mockResolvedValue(0),
  }
}

function expectSourceResult(
  jobRecorder: ReturnType<typeof makeJobRecorder>,
  key: string,
  value: unknown,
) {
  expect(jobRecorder.complete).toHaveBeenCalledWith(
    expect.any(Number),
    expect.objectContaining({ sourceResults: expect.objectContaining({ [key]: value }) }),
  )
}

describe('PipelineOrchestrator', () => {
  let orchestrator: InstanceType<typeof PipelineOrchestrator>
  const mockAnalyze = vi.mocked(analyze)
  const mockDiscover = vi.mocked(discover)
  const mockResolve = vi.mocked(resolve)
  const mockScore = vi.mocked(score)
  const mockFilter = vi.mocked(filter)
  const mockStore = vi.mocked(store)
  const mockHydrateArtistGenres = vi.mocked(hydrateArtistGenres)
  const mockWarmArtistGenres = vi.mocked(warmArtistGenres)
  let providerRegistry: ReturnType<typeof makeProviderRegistry>
  let syncForUser: SyncForUser

  const tasteProfile = {
    topArtists: [
      { name: 'Artist 1', mbid: 'mbid-1', playCount: 100, source: 'listenbrainz' as const },
    ],
    topGenres: [] as Array<{ name: string; weight: number }>,
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

  function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
    return {
      db: makeDb(),
      settings: defaultSettings,
      providerRegistry,
      librarySync: { syncForUser },
      userId: 1,
      ...overrides,
    } as PipelineDeps
  }
  const run = (overrides: Partial<PipelineDeps> = {}) => orchestrator.run(makeDeps(overrides))
  const enqueue = (overrides: Partial<PipelineDeps> = {}) =>
    orchestrator.enqueue(makeDeps(overrides))

  function holdAnalyze() {
    let release!: () => void
    let reject!: () => void
    mockAnalyze.mockReturnValueOnce(
      new Promise<typeof tasteProfile>((res, rej) => {
        release = () => res(tasteProfile)
        reject = () => rej(new Error('run A exploded'))
      }),
    )
    return { release, reject }
  }

  function discoverThroughAudiomuse(seeds: string[]) {
    mockDiscover.mockImplementation(async (_profile, sources, _limit, _seeds, _ratio, options) => {
      options?.onSeedCount?.(seeds.length)
      const source = sources.listeningSources?.find((s: DiscoverySource) => s.id === 'audiomuse')
      const artists = []
      for (const seed of seeds) {
        try {
          artists.push(...((await source?.getSimilarArtists(seed)) ?? []))
        } catch (error) {
          options?.onSourceFailure?.('audiomuse', (error as Error).message)
        }
      }
      return artists
    })
  }

  beforeEach(() => {
    orchestrator = new PipelineOrchestrator()
    providerRegistry = makeProviderRegistry()
    syncForUser = vi.fn(async () => ({ userId: 1, results: [] })) as SyncForUser
    vi.clearAllMocks()

    mockAnalyze.mockResolvedValue(tasteProfile)
    mockDiscover.mockResolvedValue(discovered)
    mockResolve.mockResolvedValue(resolved)
    mockScore.mockReturnValue(scored)
    mockFilter.mockReturnValue(scored)
    mockStore.mockResolvedValue(42)
    mockHydrateArtistGenres.mockResolvedValue({
      artists: tasteProfile.topArtists,
      coverage: { coveredArtists: 0, pendingArtists: 1, totalArtists: 1 },
    })
    mockWarmArtistGenres.mockResolvedValue({
      attempted: 1,
      updated: 1,
      failed: 0,
      skippedAmbiguous: 0,
    })
    vi.mocked(createLidarrClient).mockReturnValue({ getArtists: vi.fn() } as never)
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
    } as never)
  })

  it.each([1, 2])(
    'runs every stage in order for user %s, syncing and reading the reconciled library',
    async (userId) => {
      const db = makeDb()
      const order: string[] = []
      const stages: string[] = []
      for (const [name, mock, value] of [
        ['analyze', mockAnalyze, tasteProfile],
        ['discover', mockDiscover, discovered],
        ['resolve', mockResolve, resolved],
        ['score', mockScore, scored],
        ['filter', mockFilter, scored],
        ['store', mockStore, 42],
      ] as const) {
        ;(mock as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
          order.push(name)
          return value
        })
      }
      orchestrator.on('progress', (event: { stage: string }) => stages.push(event.stage))
      expect(orchestrator.isRunning).toBe(false)

      const result = await run({ db, userId })

      expect(result).toEqual({ batchId: 42 })
      expect(order).toEqual(['analyze', 'discover', 'resolve', 'score', 'filter', 'store'])
      expect(stages).toEqual(expect.arrayContaining([...order, 'collect', 'complete']))
      expect(db.getRejectedMbids).toHaveBeenCalledExactlyOnceWith(90, userId)
      expect(syncForUser).toHaveBeenCalledWith(userId, expect.anything())
      expect(db.getLibraryArtistsForUser).toHaveBeenCalledWith(userId, { onlyReconciled: true })
      expect(orchestrator.isRunning).toBe(false)
    },
  )

  it('excludes a recently played recording and warns instead of relaxing the filter', async () => {
    const played = {
      ...(scored[0] as (typeof scored)[number]),
      suggestedRecording: { mbid: 'rec-played', title: 'Song' },
    }
    mockFilter.mockReturnValue([played])
    const getListens = vi
      .fn()
      .mockResolvedValueOnce([
        {
          artist: 'New Artist',
          track: 'Song',
          listenedAt: Math.floor(Date.now() / 1000) - 60,
          recordingMbid: 'rec-played',
        },
      ])
      .mockResolvedValueOnce([])
    vi.mocked(createListenBrainzClient).mockReturnValue({ getListens } as never)
    const jobRecorder = makeJobRecorder()
    const messages: Array<{ stage: string; message: string }> = []
    orchestrator.on('progress', (event: { stage: string; message: string }) => messages.push(event))

    await run({
      jobRecorder,
      settings: {
        ...defaultSettings,
        preferences: {
          ...defaultSettings.preferences,
          excludeRecentlyPlayed: { enabled: true, windowDays: 30 },
        },
      } as never,
      userConnections: { listenbrainzUsername: 'lbuser', listenbrainzToken: 'lb-token' } as never,
    })

    expect(createListenBrainzClient).toHaveBeenCalledWith('lbuser', 'lb-token')
    expect(mockStore.mock.calls[0]?.[0]).toEqual([])
    expect(messages).toContainEqual(
      expect.objectContaining({
        stage: 'filter',
        message: expect.stringContaining('Skipped 1 recently played recordings'),
      }),
    )
    expect(jobRecorder.complete).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        metadata: expect.objectContaining({
          recentlyPlayed: { status: 'ok', windowDays: 30, listensRead: 1, excluded: 1 },
        }),
      }),
    )
  })

  it('passes response and prompt locales from pipeline deps into AI discovery', async () => {
    await run({ responseLocale: 'fr', promptLocale: 'es' })

    expect(mockDiscover.mock.calls[0]?.[0]).toMatchObject({
      ...tasteProfile,
      responseLocale: 'fr',
      promptLocale: 'es',
    })
  })

  it('surfaces AI source failure in job sourceResults and progress', async () => {
    const aiError = 'client error 404: models/gemini-x is not found for API version v1beta'
    mockDiscover.mockImplementation(async (_p, _s, _l, _seeds, _r, options) => {
      options?.onSourceFailure?.('ai', aiError)
      return discovered
    })
    const jobRecorder = makeJobRecorder()
    const messages: string[] = []
    orchestrator.on('progress', (event: { message?: string }) => {
      if (event.message) messages.push(event.message)
    })

    await run({ jobRecorder })

    expectSourceResult(jobRecorder, 'ai', { status: 'error', error: aiError })
    expect(messages.some((m) => m.includes(aiError))).toBe(true)
  })

  it.each<[string, boolean, number, string | undefined, typeof discovered, SourceResult, boolean?]>(
    [
      [
        'unsupported',
        false,
        1,
        undefined,
        discovered,
        { status: 'skipped', reason: 'unsupported_capability' },
      ],
      ['empty', true, 1, undefined, [], { status: 'ok', artists: 0 }],
      [
        'failed',
        true,
        1,
        'upstream unavailable',
        [],
        { status: 'error', artists: 0, error: 'upstream unavailable' },
      ],
      [
        'partially failed',
        true,
        1,
        'upstream unavailable',
        discovered,
        { status: 'error', artists: 1, error: 'upstream unavailable' },
      ],
      ['no seeds', true, 0, undefined, [], { status: 'skipped', reason: 'no_seeds' }],
      ['explicit run', true, 0, undefined, [], { status: 'skipped', reason: 'explicit_run' }, true],
    ],
  )(
    'records a %s listening source outcome',
    async (_name, supported, seedCount, error, artists, expected, explicitRun) => {
      const source = vi.mocked(createListenBrainzSource)('user', 'token')
      source.capabilities = supported ? ['topArtists', 'similarArtists'] : ['topArtists']
      vi.mocked(createListenBrainzSource).mockReturnValue(source)
      mockDiscover.mockImplementation(async (_p, _s, _l, _seeds, _r, options) => {
        options?.onSeedCount?.(seedCount)
        if (error) options?.onSourceFailure?.('listenbrainz', error)
        return artists
      })
      const jobRecorder = makeJobRecorder()

      await run({
        jobRecorder,
        userConnections: {
          listenbrainzUsername: 'user',
          listenbrainzToken: 'token',
        } as UserConnections,
        explicitDiscoveryMode: explicitRun
          ? { modeId: 'test', settingsMode: 'easy', providerPath: [] }
          : undefined,
      })

      expectSourceResult(jobRecorder, 'listenbrainz', expected)
    },
  )

  describe('AudioMuse', () => {
    const audiomuse = { url: 'https://audiomuse.example' }

    it.each([
      ['invalid URL', { url: 'invalid' }, 'invalid_url'],
      ['blocked URL', { url: 'http://169.254.169.254' }, 'invalid_url'],
      [
        'unreadable token',
        { ...audiomuse, skipReason: 'token_unreadable' as const },
        'token_unreadable',
      ],
    ])('skips with %s without failing or making requests', async (_name, config, reason) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const jobRecorder = makeJobRecorder()
      try {
        await run({ settings: { ...defaultSettings, audiomuse: config }, jobRecorder })
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(jobRecorder.fail).not.toHaveBeenCalled()
        expectSourceResult(jobRecorder, 'audiomuse', {
          status: 'skipped',
          reason: `audiomuse_${reason}`,
        })
      } finally {
        fetchSpy.mockRestore()
      }
    })

    it('omits job results when unconfigured', async () => {
      const jobRecorder = makeJobRecorder()
      await run({ settings: { ...defaultSettings, audiomuse: null }, jobRecorder })
      expect(jobRecorder.complete.mock.calls[0]?.[1].sourceResults).not.toHaveProperty('audiomuse')
    })

    it.each(['unreachable', 'not_indexed', 'artist_unknown'])(
      'records %s and its seed summary without failing the scan',
      async (reason) => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
          if (reason === 'unreachable') throw new Error('network failure')
          return new Response(
            JSON.stringify({ error_code: reason === 'not_indexed' ? 3002 : 1004 }),
            { status: 404 },
          )
        })
        discoverThroughAudiomuse(['Seed'])
        const jobRecorder = makeJobRecorder()
        try {
          await run({ settings: { ...defaultSettings, audiomuse }, jobRecorder })
          expect(jobRecorder.fail).not.toHaveBeenCalled()
          expectSourceResult(jobRecorder, 'audiomuse', {
            status: 'skipped',
            artists: 0,
            reason: `audiomuse_${reason}`,
            seedsQueried: 1,
            seedsWithResults: 0,
            skipReasons: { [reason]: 1 },
          })
        } finally {
          fetchSpy.mockRestore()
        }
      },
    )

    it.each([false, true])(
      'reports successful seed queries with aggregate skips (all owned: %s)',
      async (allOwned) => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
          const seed = new URL(String(input)).searchParams.get('artist') ?? ''
          if (Number(seed) < 5) {
            return new Response(JSON.stringify({ error_code: 1004 }), { status: 404 })
          }
          return Response.json([
            { artist: allOwned ? 'Artist 1' : `New Artist ${seed}`, divergence: 1 },
          ])
        })
        discoverThroughAudiomuse(Array.from({ length: 30 }, (_, i) => String(i)))
        const jobRecorder = makeJobRecorder()
        try {
          await run({ settings: { ...defaultSettings, audiomuse }, jobRecorder })
          expectSourceResult(jobRecorder, 'audiomuse', {
            status: 'ok',
            artists: allOwned ? 0 : 25,
            seedsQueried: 30,
            seedsWithResults: 25,
            skipReasons: { artist_unknown: 5 },
          })
          expect(jobRecorder.fail).not.toHaveBeenCalled()
        } finally {
          fetchSpy.mockRestore()
        }
      },
    )

    it('excludes reconciled and name-only library artists and blocked names before resolution', async () => {
      const db = {
        ...makeDb(),
        getBlockedArtistNames: vi.fn().mockResolvedValue(['Blocked Artist']),
      }
      const library = [libraryArtist('Artist 1', ['rock'])]
      db.getLibraryArtistsForUser.mockImplementation(async (_userId, options) =>
        options?.onlyReconciled
          ? library
          : [...library, libraryArtist('Name Only Artist', ['rock'], null)],
      )
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json([
          { artist: 'ARTIST 1', divergence: 0.1 },
          { artist: 'name only artist', divergence: 0.2 },
          { artist: 'blocked artist', divergence: 0.3 },
          { artist: 'New Artist', divergence: 0.4 },
        ]),
      )
      discoverThroughAudiomuse(['Seed'])
      try {
        await run({ db, settings: { ...defaultSettings, audiomuse } })
        expect(mockResolve.mock.calls[0]?.[0]).toEqual([
          { name: 'New Artist', similarityScore: 1, source: 'audiomuse' },
        ])
        expect(db.getLibraryArtistsForUser).toHaveBeenCalledWith(1)
        expect(db.getBlockedArtistNames).toHaveBeenCalledWith(1)
      } finally {
        fetchSpy.mockRestore()
      }
    })
  })

  it('hydrates genres, records coverage, then starts the background warmer', async () => {
    const db = {
      ...makeDb(),
      getArtistGenreCacheByMbids: vi.fn().mockResolvedValue([]),
      getArtistGenreCacheByAliases: vi.fn().mockResolvedValue([]),
      upsertArtistGenres: vi.fn().mockResolvedValue(undefined),
      upsertArtistGenreAlias: vi.fn().mockResolvedValue(undefined),
    }
    const coverage = { coveredArtists: 1, pendingArtists: 1, totalArtists: 2 }
    mockHydrateArtistGenres.mockResolvedValue({
      artists: [
        { ...tasteProfile.topArtists[0], genres: ['post-rock'], genreSource: 'artist-cache' },
      ],
      coverage,
    } as never)
    mockAnalyze.mockImplementation(async (_sources, options) => {
      const hydrated = await options?.genreHydrator?.(tasteProfile.topArtists)
      return {
        ...tasteProfile,
        topArtists: hydrated?.artists ?? tasteProfile.topArtists,
        genreCoverage: hydrated?.coverage,
      }
    })
    const jobRecorder = makeJobRecorder(9)

    await run({ db, jobRecorder })

    expect(mockHydrateArtistGenres).toHaveBeenCalledWith(
      tasteProfile.topArtists,
      expect.objectContaining({
        getArtistGenreCacheByMbids: db.getArtistGenreCacheByMbids,
        getArtistGenreCacheByAliases: db.getArtistGenreCacheByAliases,
      }),
      expect.any(Array),
    )
    expect(jobRecorder.complete).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ metadata: expect.objectContaining({ genreCoverage: coverage }) }),
    )
    await vi.waitFor(() => expect(mockWarmArtistGenres).toHaveBeenCalledOnce())
    expect(jobRecorder.complete.mock.invocationCallOrder[0]).toBeLessThan(
      mockWarmArtistGenres.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it('passes subscriptionId to store for discovery-mode subscription runs', async () => {
    const db = makeDb()

    await run({
      db,
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

  it('passes netNewAlbumDiscovery into resolve()', async () => {
    await run({
      settings: {
        ...defaultSettings,
        preferences: { ...defaultSettings.preferences, netNewAlbumDiscovery: true },
      },
    })
    expect(mockResolve.mock.calls.at(-1)?.[8]).toBe(true)
  })

  it('emits the error event, rethrows, and releases the running flag on stage failure', async () => {
    const boom = new Error('analyze exploded')
    mockAnalyze.mockRejectedValue(boom)
    const errors: unknown[] = []
    orchestrator.on('error', (err: unknown) => errors.push(err))

    await expect(run()).rejects.toThrow('analyze exploded')
    expect(errors).toEqual([boom])
    expect(orchestrator.isRunning).toBe(false)
  })

  it('rejects concurrent runs while pipeline is running', async () => {
    const held = holdAnalyze()
    const firstRun = run()

    await expect(run()).rejects.toThrow('Pipeline already running')

    held.release()
    await firstRun.catch(() => {})
  })

  // drainQueue() must stay in `finally`: a failed run that never releases the
  // queue wedges every queued run.
  it.each([
    ['succeeds', 2],
    ['fails', 1],
  ])(
    'queues and dedupes runs behind an in-flight one and drains when it %s',
    async (outcome, stores) => {
      orchestrator.on('error', () => {})
      const held = holdAnalyze()

      expect(enqueue()).toEqual({ status: 'started', position: 0 })
      expect(orchestrator.isRunning).toBe(true)
      expect(enqueue({ userId: 2 })).toEqual({ status: 'queued', position: 1 })
      expect(orchestrator.queuePositionFor(2)).toBe(1)
      expect(enqueue({ userId: 2 }).status).toBe('duplicate')
      expect(orchestrator.queueLength).toBe(1)

      if (outcome === 'fails') held.reject()
      else held.release()

      await vi.waitFor(() => expect(orchestrator.queueLength).toBe(0))
      await vi.waitFor(() => expect(orchestrator.isRunning).toBe(false))
      expect(mockAnalyze).toHaveBeenCalledTimes(2)
      expect(mockStore).toHaveBeenCalledTimes(stores)
    },
  )

  it.each([
    [
      'ListenBrainz',
      { listenbrainzUsername: null, listenbrainzToken: null },
      createListenBrainzSource,
    ],
    ['Last.fm', { lastfmUsername: null, lastfmApiKey: null }, createLastFmSource],
  ])('skips %s when its username is unset', async (_name, settings, factory) => {
    await run({ settings: { ...defaultSettings, ...settings } })
    expect(vi.mocked(factory)).not.toHaveBeenCalled()
  })

  it.each<[string, ReturnType<typeof libraryArtist>[], string[], string[]]>([
    [
      'deduplicated library genres',
      [
        libraryArtist('Artist 1', ['rock', 'electronic']),
        libraryArtist('Artist 2', ['electronic', 'jazz'], 'mbid-2'),
      ],
      [],
      ['electronic', 'jazz', 'rock'],
    ],
    [
      'library genres over listening genres',
      [libraryArtist('Library Artist', ['rock', 'metal'])],
      ['electronic', 'ambient'],
      ['metal', 'rock'],
    ],
    [
      'listening genres with an empty library',
      [],
      ['electronic', 'ambient'],
      ['ambient', 'electronic'],
    ],
    ['nothing when both are empty', [], [], []],
  ])('scores against %s', async (_name, library, topGenres, expected) => {
    const db = { ...makeDb(), getLibraryArtistsForUser: vi.fn().mockResolvedValue(library) }
    mockAnalyze.mockResolvedValue({
      ...tasteProfile,
      topGenres: topGenres.map((name) => ({ name, weight: 1 })),
    })

    await run({ db })

    expect([...(mockScore.mock.calls[0]?.[1] ?? [])].sort()).toEqual(expected)
  })

  it('succeeds without Lidarr when a listening source is configured', async () => {
    const result = await run({
      settings: { ...defaultSettings, lidarrUrl: null, lidarrApiKey: null },
    })

    expect(result).toEqual({ batchId: 42 })
    expect(vi.mocked(createLidarrClient)).not.toHaveBeenCalled()
    expect(syncForUser).toHaveBeenCalledWith(1, expect.anything())
  })

  it('completes from listening sources and records AI as skipped when no provider is set (#887)', async () => {
    const jobRecorder = makeJobRecorder()

    const result = await run({
      settings: { ...defaultSettings, aiProvider: null, aiApiKey: null, aiModel: null },
      jobRecorder,
    })

    expect(result).toEqual({ batchId: 42 })
    expect(mockDiscover.mock.calls[0]?.[1]).toMatchObject({ ai: null })
    expect(jobRecorder.fail).not.toHaveBeenCalled()
    expectSourceResult(jobRecorder, 'ai', { status: 'skipped', reason: 'not_configured' })
  })

  it('throws when neither Lidarr nor listening sources nor AI are configured', async () => {
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

    await expect(run({ settings })).rejects.toThrow(
      'At least one listening source or AI provider must be configured',
    )
  })

  it('requires librarySync, userId, and library StoreDb methods', async () => {
    await expect(
      orchestrator.run({
        db: makeDb(),
        settings: defaultSettings,
        providerRegistry,
      } as unknown as PipelineDeps),
    ).rejects.toThrow(
      'Pipeline orchestrator requires librarySync, userId, and library StoreDb methods',
    )
  })

  it('fire-and-forgets first library sync when user has no prior sync state', async () => {
    const db = {
      ...makeDb(),
      getLibraryArtistsForUser: vi.fn(async () => []),
      userHasOwnSyncState: vi.fn(async () => false),
    }
    const pendingSync = vi.fn(() => new Promise(() => {})) as SyncForUser

    const result = await run({ db, librarySync: { syncForUser: pendingSync } })

    expect(result).toEqual({ batchId: 42 })
    expect(pendingSync).toHaveBeenCalled()
    expect(db.getLibraryArtistsForUser).toHaveBeenCalled()
  })

  // Album-kind candidates bypass filter(), so what store() receives reflects the
  // orchestrator's real album partition and dedupe.
  describe('release-radar albums for a tracked artist', () => {
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

    function albumDb(overrides: Record<string, unknown> = {}) {
      return {
        ...makeDb(),
        getLibraryArtistsForUser: vi
          .fn()
          .mockResolvedValue([libraryArtist('Radiohead', ['rock'], 'tracked-artist')]),
        getExistingRecommendationMbids: vi.fn().mockResolvedValue(new Set<string>()),
        getExistingAlbumReleaseGroupMbids: vi.fn().mockResolvedValue(new Set<string>()),
        getBlockedAlbumKeys: vi.fn().mockResolvedValue(new Set<string>()),
        ...overrides,
      }
    }

    beforeEach(() => {
      mockScore.mockReturnValue(albumScored as never)
      mockFilter.mockImplementation((artists) => artists as never)
    })

    it('stores the album without routing it through the artist filter', async () => {
      const db = albumDb()

      await run({ db })

      expect(mockStore).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            kind: 'album',
            releaseGroupMbid: 'rg-new',
            suggestedAlbum: expect.objectContaining({ releaseGroupId: 'rg-new' }),
          }),
        ],
        db,
        expect.anything(),
      )
      expect(mockFilter).toHaveBeenCalled()
      expect(mockFilter.mock.calls[0]?.[0] ?? []).not.toContainEqual(
        expect.objectContaining({ releaseGroupMbid: 'rg-new' }),
      )
    })

    it.each([
      [
        'its release group is already recommended',
        () => ({
          getExistingAlbumReleaseGroupMbids: vi.fn().mockResolvedValue(new Set(['rg-new'])),
        }),
      ],
      [
        'it is already owned in the synced library',
        () => ({
          getOwnedAlbumKeys: vi.fn().mockResolvedValue({
            releaseGroupMbids: new Set(['rg-new']),
            artistTitleKeys: new Set<string>(),
          }),
        }),
      ],
    ])('drops the album when %s', async (_name, overrides) => {
      const extra = overrides()
      const db = albumDb(extra)

      await run({ db })

      expect(mockStore).toHaveBeenCalledWith([], db, expect.anything())
      if ('getOwnedAlbumKeys' in extra) expect(extra.getOwnedAlbumKeys).toHaveBeenCalledWith(1)
    })
  })

  describe('cancel', () => {
    function held() {
      let release!: () => void
      let enter!: () => void
      const entered = new Promise<void>((r) => {
        enter = r
      })
      const gate = new Promise<void>((r) => {
        release = r
      })
      return {
        entered,
        release,
        wait: async () => {
          enter()
          await gate
        },
      }
    }

    it('stops the in-flight run at the next checkpoint and records cancellation', async () => {
      const jobRecorder = makeJobRecorder(11)
      const stages: string[] = []
      orchestrator.on('progress', (e: { stage?: string }) => {
        if (e.stage) stages.push(e.stage)
      })
      mockDiscover.mockImplementation(async () => {
        orchestrator.cancel(1)
        return discovered
      })

      await expect(run({ jobRecorder })).rejects.toBeInstanceOf(PipelineCancelledError)

      expect(mockResolve).not.toHaveBeenCalled()
      expect(mockStore).not.toHaveBeenCalled()
      expect(jobRecorder.cancel).toHaveBeenCalledWith(11)
      expect(jobRecorder.complete).not.toHaveBeenCalled()
      expect(stages).toContain('cancelled')
      expect(orchestrator.isRunning).toBe(false)
    })

    it('drops only the caller queued runs and refuses to stop another user run', async () => {
      const discoverGate = held()
      mockDiscover.mockImplementation(async () => {
        await discoverGate.wait()
        return discovered
      })

      enqueue()
      expect(enqueue({ userId: 2 }).status).toBe('queued')
      expect(orchestrator.queueLength).toBe(1)

      expect(orchestrator.cancel(3)).toEqual({ cancelled: false, dequeued: 0, forbidden: true })
      expect(orchestrator.cancel(2)).toEqual({ cancelled: false, dequeued: 1, forbidden: false })
      expect(orchestrator.queueLength).toBe(0)
      expect(orchestrator.isRunning).toBe(true)

      enqueue({ userId: 2 })
      expect(orchestrator.cancel(3, { canStopOthers: true })).toEqual({
        cancelled: true,
        dequeued: 0,
        forbidden: false,
      })
      expect(orchestrator.queueLength).toBe(1)

      const owners: unknown[] = []
      orchestrator.on('progress', (e: { userId?: number }) => owners.push(e.userId))
      discoverGate.release()
      await vi.waitFor(() => expect(owners).toContain(2))
      expect(orchestrator.queueLength).toBe(0)
    })

    it('keeps ownership beyond the old grace period until store and cancel bookkeeping settle', async () => {
      vi.useFakeTimers()
      try {
        const storeGate = held()
        const cancelGate = held()
        mockStore.mockImplementationOnce(async () => {
          await storeGate.wait()
          return 42
        })
        const jobRecorder = { ...makeJobRecorder(11), cancel: vi.fn(cancelGate.wait) }
        const terminal = vi.fn()
        orchestrator.on('progress', (e) => {
          if (e.stage === 'complete' || e.stage === 'cancelled') terminal(e, orchestrator.isRunning)
        })
        const pending = run({ jobRecorder })
        const rejection = expect(pending).rejects.toBeInstanceOf(PipelineCancelledError)
        await storeGate.entered
        expect(orchestrator.cancel(1)).toMatchObject({ cancelled: true })
        await vi.advanceTimersByTimeAsync(16_000)
        expect(orchestrator.isRunning).toBe(true)
        expect(terminal).not.toHaveBeenCalled()
        await expect(run({ jobRecorder, userId: 2 })).rejects.toThrow('already running')
        storeGate.release()
        await cancelGate.entered
        expect(orchestrator.isRunning).toBe(true)
        expect(terminal).not.toHaveBeenCalled()
        cancelGate.release()
        await rejection
        expect(jobRecorder.complete).not.toHaveBeenCalled()
        expect(dispatch).not.toHaveBeenCalled()
        expect(terminal).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ stage: 'cancelled', userId: 1 }),
          false,
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('declines cancellation after committing completion and waits for job bookkeeping', async () => {
      const completeGate = held()
      const jobRecorder = { ...makeJobRecorder(11), complete: vi.fn(completeGate.wait) }
      const terminal = vi.fn()
      orchestrator.on('progress', (e) => {
        if (e.stage === 'complete') terminal(e, orchestrator.isRunning)
      })
      const pending = run({ jobRecorder })
      await completeGate.entered
      expect(orchestrator.cancel(1)).toMatchObject({ cancelled: false })
      expect(orchestrator.isRunning).toBe(true)
      expect(terminal).not.toHaveBeenCalled()
      completeGate.release()
      await pending
      expect(jobRecorder.cancel).not.toHaveBeenCalled()
      expect(terminal).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ userId: 1 }),
        false,
      )
    })

    it('reports failed cancellation bookkeeping as an error without a cancelled terminal', async () => {
      const cleanupError = new Error('cancel database failed')
      const jobRecorder = {
        ...makeJobRecorder(11),
        cancel: vi.fn().mockRejectedValue(cleanupError),
      }
      mockDiscover.mockImplementationOnce(async () => {
        orchestrator.cancel(1)
        return discovered
      })
      const errors = vi.fn()
      const terminal = vi.fn()
      orchestrator.on('error', errors)
      orchestrator.on('progress', (e) => {
        if (e.stage === 'cancelled') terminal(e)
      })
      await expect(run({ jobRecorder })).rejects.toBeInstanceOf(AggregateError)
      expect(errors).toHaveBeenCalledWith(
        expect.objectContaining({ errors: expect.arrayContaining([cleanupError]) }),
      )
      expect(terminal).not.toHaveBeenCalled()
      expect(orchestrator.isRunning).toBe(false)
    })

    it('preserves a synchronously started run when a terminal listener starts new work', async () => {
      let nextRun: Promise<{ batchId: number }> | undefined
      const storeGate = held()
      mockStore.mockResolvedValueOnce(42).mockImplementationOnce(async () => {
        await storeGate.wait()
        return 43
      })
      orchestrator.once('progress', () => {})
      const listener = (e: { stage: string; userId: number }) => {
        if (e.stage !== 'complete') return
        orchestrator.off('progress', listener)
        expect(e.userId).toBe(1)
        expect(orchestrator.isRunning).toBe(false)
        nextRun = run({ userId: 2 })
      }
      orchestrator.on('progress', listener)
      await run()
      await storeGate.entered
      expect(orchestrator.currentUserId).toBe(2)
      expect(orchestrator.isRunning).toBe(true)
      storeGate.release()
      await nextRun
    })

    it('reports nothing to cancel when idle', () => {
      expect(orchestrator.isRunning).toBe(false)
      expect(orchestrator.cancel(1)).toMatchObject({ cancelled: false })
    })
  })
})
