// @vitest-environment node

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '@/core/sessions'

const mocks = vi.hoisted(() => ({
  audiodbClient: { getArtistImages: vi.fn(), searchArtistByName: vi.fn() },
  fanartClient: { getArtistImages: vi.fn() },
  lidarrClient: { lookupArtist: vi.fn() },
  musicBrainzClient: { lookupArtist: vi.fn(), searchArtist: vi.fn() },
  musicinfoClient: { lookupArtistImages: vi.fn() },
  fetchArtistImage: vi.fn(),
  upsertArtist: vi.fn(),
}))

vi.mock('@/core/clients/audiodb', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/clients/audiodb')>()
  return { ...original, createAudiodbClient: vi.fn(() => mocks.audiodbClient) }
})

vi.mock('@/core/clients/fanart', () => ({
  createFanartClient: vi.fn(() => mocks.fanartClient),
}))

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(() => mocks.lidarrClient),
}))

vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(() => mocks.musicBrainzClient),
}))

vi.mock('@/core/clients/musicinfo', () => ({
  createMusicinfoClient: vi.fn(() => mocks.musicinfoClient),
}))

vi.mock('@/core/pipeline/resolve', () => ({
  resolve: vi.fn(async () => []),
  fetchArtistImage: mocks.fetchArtistImage,
}))

vi.mock('@/core/pipeline/store', () => ({
  store: vi.fn(async () => {}),
}))

vi.mock('@/db/queries/users', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/queries/users')>()
  return {
    ...original,
    getUserConnections: vi.fn(async () => null),
  }
})

vi.mock('@/db/queries/artists', () => ({
  upsertArtist: mocks.upsertArtist,
}))

import type { SettingsRow } from '@/db/queries/settings'
import { DEFAULT_PREFERENCES } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

beforeEach(async () => {
  vi.clearAllMocks()
  const { clearAllSessions } = await import('@/core/sessions')
  await clearAllSessions()
})

afterEach(async () => {
  const { clearAllSessions } = await import('@/core/sessions')
  await clearAllSessions()
})

function makeMockOrchestrator(isRunning = false) {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning,
    run: vi.fn(async () => ({ batchId: 1 })),
    enqueue: vi.fn(() =>
      isRunning ? { status: 'queued', position: 1 } : { status: 'started', position: 0 },
    ),
    queueLength: isRunning ? 1 : 0,
    queuePositionFor: vi.fn(() => 0),
  })
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    db: { execute: vi.fn(async () => []) } as unknown as AppDependencies['db'],
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: makeMockOrchestrator() as unknown as AppDependencies['orchestrator'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {
      create: vi.fn().mockResolvedValue({ getRecommendations: vi.fn(), testConnection: vi.fn() }),
      register: vi.fn(),
      has: vi.fn().mockReturnValue(true),
      availableIds: vi.fn().mockReturnValue(['anthropic', 'openai', 'ollama']),
    } as unknown as AppDependencies['providerRegistry'],
    isSetupComplete: async () => true,
    getSettings: vi.fn(
      async () =>
        ({
          id: 1,
          lidarrUrl: 'http://lidarr:8686',
          lidarrApiKey: 'key',
          preferences: null,
        }) as SettingsRow,
    ),
    updateSettings: vi.fn(async () => {}),
    completeSetup: vi.fn(async () => ({ id: 1, setupComplete: true })),
    getLastBatch: vi.fn(async () => null),
    listRecommendations: vi.fn(async () => ({ items: [], total: 0 })),
    getRecommendation: vi.fn(async () => null),
    updateRecommendationStatus: vi.fn(async () => {}),
    rejectRecommendation: vi.fn(async () => 1),
    listArtistBlocks: vi.fn(async () => ({ items: [], nextCursor: null })),
    removeArtistBlock: vi.fn(async () => true),
    addArtistBlock: vi.fn(async () => {}),
    listAlbumBlocks: vi.fn(async () => []),
    removeAlbumBlock: vi.fn(async () => {}),
    bulkUpdateStatus: vi.fn(async () => {}),
    filterOwnedIds: vi.fn(async (ids: number[]) => ids),
    listBatches: vi.fn(async () => []),
    getBatch: vi.fn(async () => null),
    getArtistById: vi.fn(async () => null),
    restartScheduler: vi.fn(),
    restartPlaylistScheduler: vi.fn(),
    createUser: vi.fn(async () => ({
      id: 1,
      username: 'test',
      isAdmin: false,
      preferences: null,
      email: null,
      oidcSubject: null,
      authProvider: 'local',
      listenbrainzUsername: null,
      listenbrainzToken: null,
      lastfmUsername: null,
      lastfmApiKey: null,
      plexUrl: null,
      plexToken: null,
      plexSectionId: null,
      jellyfinUrl: null,
      jellyfinApiKey: null,
      jellyfinUserId: null,
      jellyfinLibraryId: null,
      embyUrl: null,
      embyApiKey: null,
      embyUserId: null,
      embyLibraryId: null,
      discogsToken: null,
      discogsUsername: null,
      subsonicUrl: null,
      subsonicUsername: null,
      subsonicPassword: null,
      createdAt: new Date(),
    })),
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 0),
    updateUserPreferredLocale: vi.fn(async () => {}),
    genreService: {} as unknown as AppDependencies['genreService'],
    libraryHealth: {} as unknown as AppDependencies['libraryHealth'],
    librarySync: {} as unknown as AppDependencies['librarySync'],
    librarySyncStore: {} as unknown as AppDependencies['librarySyncStore'],
    targetQueries: {
      createTarget: vi.fn().mockResolvedValue({ id: 1 }),
      getTargetsByUser: vi.fn().mockResolvedValue([]),
      getAllTargets: vi.fn().mockResolvedValue([]),
      getTarget: vi.fn().mockResolvedValue(null),
      updateTarget: vi.fn().mockResolvedValue(undefined),
      deleteTarget: vi.fn().mockResolvedValue(undefined),
    },
    testTargetConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    getEnabledTargetsForUser: vi.fn().mockResolvedValue([]),
    subscriptionQueries: {
      createSubscription: vi.fn(async () => ({}) as never),
      getSubscription: vi.fn(async () => null),
      getSubscriptionsByUser: vi.fn(async () => []),
      getEnabledSubscriptions: vi.fn(async () => []),
      updateSubscription: vi.fn(async () => {}),
      deleteSubscription: vi.fn(async () => {}),
    },
    runSubscription: vi.fn(async () => {}),
    getOidcService: vi.fn(async () => null),
    getUserByOidcSubject: vi.fn(async () => null),
    getUserByEmail: vi.fn(async () => null),
    updateUser: vi.fn(async () => {}),
    listUsers: vi.fn(async () => []),
    deleteUser: vi.fn(async () => {}),
    getFeedbackHistory: vi.fn(async () => new Map()),
    dashboardQueries: {
      getTopGenresForUser: vi.fn(async () => []),
      getLatestGenreCoverage: vi.fn(async () => null),
      getRecentActivity: vi.fn(async () => []),
    },
    jobRecorder: {
      start: vi.fn().mockResolvedValue(1),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      markStuck: vi.fn().mockResolvedValue(0),
    },
    jobQueries: {
      listJobs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getJobById: vi.fn().mockResolvedValue(null),
      getJobHealth: vi.fn().mockResolvedValue({
        pipeline: { status: 'ok', lastRun: null, nextRun: null },
        subscriptions: { status: 'ok', healthy: 0, total: 0 },
        playlists: { status: 'ok', lastRun: null },
        sources: {},
      }),
      getJobsForSubscription: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  }
}

const SESSION_TOKEN = 'pipeline-session-token'

async function authedRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  await createSession(1, SESSION_TOKEN)
  return app.request(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${SESSION_TOKEN}`,
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  })
}

describe('POST /api/v1/pipeline/run', () => {
  it('returns 202 when pipeline is not running', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.message).toBe('Pipeline started')
  })

  it('queues the run (202) when a pipeline is already running', async () => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.queued).toBe(true)
    expect(body.position).toBe(1)
  })

  it('reports duplicate (not queued) when the same user re-submits during their in-flight run', async () => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    // Same-user re-submit: enqueue returns a no-op duplicate at position 0.
    orchestrator.enqueue = vi.fn(() => ({ status: 'duplicate', position: 0 })) as never
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    // Must NOT be reported as a fresh queue at position 0 (silent no-op as success).
    expect(body.status).toBe('duplicate')
    expect(body.queued).toBe(false)
  })

  it('returns 400 when settings are missing', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const app = createApp(
      makeDeps({
        orchestrator,
        getSettings: vi.fn(async () => null),
      }),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('passes the resolved response locale into manual pipeline runs', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const app = createApp(
      makeDeps({
        orchestrator,
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 1,
          username: 'test',
          isAdmin: false,
          preferredLocale: 'de',
          preferences: null,
          email: null,
          oidcSubject: null,
          authProvider: 'local',
          listenbrainzUsername: null,
          listenbrainzToken: null,
          lastfmUsername: null,
          lastfmApiKey: null,
          plexUrl: null,
          plexToken: null,
          plexSectionId: null,
          jellyfinUrl: null,
          jellyfinApiKey: null,
          jellyfinUserId: null,
          jellyfinLibraryId: null,
          embyUrl: null,
          embyApiKey: null,
          embyUserId: null,
          embyLibraryId: null,
          discogsToken: null,
          discogsUsername: null,
          subsonicUrl: null,
          subsonicUsername: null,
          subsonicPassword: null,
          createdAt: new Date(),
        })),
      }),
    )

    const { createSession } = await import('@/core/sessions')
    await createSession(1, 'session-token')

    const res = await authedRequest(app, '/api/v1/pipeline/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
        'X-Digarr-Locale': 'fr',
      },
    })

    expect(res.status).toBe(202)
    expect(orchestrator.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        responseLocale: 'fr',
        promptLocale: null,
      }),
    )
  })

  it('passes librarySync into the orchestrator (regression: GH #105)', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const librarySync = { syncForUser: vi.fn() } as unknown as AppDependencies['librarySync']
    const app = createApp(makeDeps({ orchestrator, librarySync }))
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(202)
    expect(orchestrator.enqueue).toHaveBeenCalledWith(expect.objectContaining({ librarySync }))
  })
})

describe('GET /api/v1/pipeline/status', () => {
  it('returns running: false when not running', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/pipeline/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.running).toBe(false)
    expect(body.lastRun).toBeUndefined()
  })

  it('returns running: true when orchestrator is running', async () => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.running).toBe(true)
  })

  it('includes lastRun when a batch exists', async () => {
    const lastBatch = { id: 42, createdAt: new Date('2024-06-01'), status: 'completed' }
    const app = createApp(makeDeps({ getLastBatch: vi.fn(async () => lastBatch) }))
    const res = await authedRequest(app, '/api/v1/pipeline/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lastRun).toBeDefined()
    expect(body.lastRun.batchId).toBe(42)
    expect(body.lastRun.status).toBe('completed')
  })
})

describe('GET /api/v1/pipeline/events', () => {
  it('returns text/event-stream content type', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/pipeline/events')
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })
})

describe('POST /api/v1/pipeline/quick-discover', () => {
  it('passes the resolved response locale into AI recommendations', async () => {
    const getRecommendations = vi.fn().mockResolvedValue([])
    const app = createApp(
      makeDeps({
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 1,
          username: 'test',
          isAdmin: false,
          preferredLocale: 'de',
          preferences: null,
          email: null,
          oidcSubject: null,
          authProvider: 'local',
          listenbrainzUsername: null,
          listenbrainzToken: null,
          lastfmUsername: null,
          lastfmApiKey: null,
          plexUrl: null,
          plexToken: null,
          plexSectionId: null,
          jellyfinUrl: null,
          jellyfinApiKey: null,
          jellyfinUserId: null,
          jellyfinLibraryId: null,
          embyUrl: null,
          embyApiKey: null,
          embyUserId: null,
          embyLibraryId: null,
          discogsToken: null,
          discogsUsername: null,
          subsonicUrl: null,
          subsonicUsername: null,
          subsonicPassword: null,
          createdAt: new Date(),
        })),
        providerRegistry: {
          create: vi.fn().mockResolvedValue({
            getRecommendations,
            testConnection: vi.fn(),
          }),
          register: vi.fn(),
          has: vi.fn().mockReturnValue(true),
          availableIds: vi.fn().mockReturnValue(['anthropic', 'openai', 'ollama']),
        } as unknown as AppDependencies['providerRegistry'],
        getSettings: vi.fn(
          async () =>
            ({
              id: 1,
              lidarrUrl: null,
              lidarrApiKey: null,
              aiProvider: 'openai',
              aiModel: 'gpt-4o-mini',
              aiApiKey: 'test-key',
              aiBaseUrl: null,
              preferences: null,
            }) as SettingsRow,
        ),
        storeDb: {
          getExistingRecommendationMbids: vi.fn(async () => new Set<string>()),
          getRejectedMbids: vi.fn(async () => new Set<string>()),
          getBlockedMbids: vi.fn(async () => new Set<string>()),
          getFeedbackHistory: vi.fn(async () => new Map()),
        } as unknown as AppDependencies['storeDb'],
      }),
    )

    const { createSession } = await import('@/core/sessions')
    await createSession(1, 'session-token')

    const res = await authedRequest(app, '/api/v1/pipeline/quick-discover', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
        'X-Digarr-Locale': 'fr',
      },
      body: JSON.stringify({ artistName: 'Boards of Canada' }),
    })

    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(getRecommendations).toHaveBeenCalledWith(
        expect.objectContaining({
          responseLocale: 'fr',
          promptLocale: null,
        }),
      )
    })
  })

  it('does not let an ambiguous latin-script artist name override the resolved locale', async () => {
    const getRecommendations = vi.fn().mockResolvedValue([])
    const app = createApp(
      makeDeps({
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 1,
          username: 'test',
          isAdmin: false,
          preferredLocale: 'de',
          preferences: null,
          email: null,
          oidcSubject: null,
          authProvider: 'local',
          listenbrainzUsername: null,
          listenbrainzToken: null,
          lastfmUsername: null,
          lastfmApiKey: null,
          plexUrl: null,
          plexToken: null,
          plexSectionId: null,
          jellyfinUrl: null,
          jellyfinApiKey: null,
          jellyfinUserId: null,
          jellyfinLibraryId: null,
          embyUrl: null,
          embyApiKey: null,
          embyUserId: null,
          embyLibraryId: null,
          discogsToken: null,
          discogsUsername: null,
          subsonicUrl: null,
          subsonicUsername: null,
          subsonicPassword: null,
          createdAt: new Date(),
        })),
        providerRegistry: {
          create: vi.fn().mockResolvedValue({
            getRecommendations,
            testConnection: vi.fn(),
          }),
          register: vi.fn(),
          has: vi.fn().mockReturnValue(true),
          availableIds: vi.fn().mockReturnValue(['anthropic', 'openai', 'ollama']),
        } as unknown as AppDependencies['providerRegistry'],
        getSettings: vi.fn(
          async () =>
            ({
              id: 1,
              lidarrUrl: null,
              lidarrApiKey: null,
              aiProvider: 'openai',
              aiModel: 'gpt-4o-mini',
              aiApiKey: 'test-key',
              aiBaseUrl: null,
              preferences: null,
            }) as SettingsRow,
        ),
        storeDb: {
          getExistingRecommendationMbids: vi.fn(async () => new Set<string>()),
          getRejectedMbids: vi.fn(async () => new Set<string>()),
          getBlockedMbids: vi.fn(async () => new Set<string>()),
          getFeedbackHistory: vi.fn(async () => new Map()),
        } as unknown as AppDependencies['storeDb'],
      }),
    )

    const { createSession } = await import('@/core/sessions')
    await createSession(1, 'session-token')

    const res = await authedRequest(app, '/api/v1/pipeline/quick-discover', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
        'X-Digarr-Locale': 'fr',
      },
      body: JSON.stringify({ artistName: 'Mañana' }),
    })

    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(getRecommendations).toHaveBeenCalledWith(
        expect.objectContaining({
          responseLocale: 'fr',
          promptLocale: null,
        }),
      )
    })
  })

  it('keeps responseLocale on the resolved UI locale when promptLocale differs', async () => {
    const getRecommendations = vi.fn().mockResolvedValue([])
    const app = createApp(
      makeDeps({
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 1,
          username: 'test',
          isAdmin: false,
          preferredLocale: 'de',
          preferences: null,
          email: null,
          oidcSubject: null,
          authProvider: 'local',
          listenbrainzUsername: null,
          listenbrainzToken: null,
          lastfmUsername: null,
          lastfmApiKey: null,
          plexUrl: null,
          plexToken: null,
          plexSectionId: null,
          jellyfinUrl: null,
          jellyfinApiKey: null,
          jellyfinUserId: null,
          jellyfinLibraryId: null,
          embyUrl: null,
          embyApiKey: null,
          embyUserId: null,
          embyLibraryId: null,
          discogsToken: null,
          discogsUsername: null,
          subsonicUrl: null,
          subsonicUsername: null,
          subsonicPassword: null,
          createdAt: new Date(),
        })),
        providerRegistry: {
          create: vi.fn().mockResolvedValue({
            getRecommendations,
            testConnection: vi.fn(),
          }),
          register: vi.fn(),
          has: vi.fn().mockReturnValue(true),
          availableIds: vi.fn().mockReturnValue(['anthropic', 'openai', 'ollama']),
        } as unknown as AppDependencies['providerRegistry'],
        getSettings: vi.fn(
          async () =>
            ({
              id: 1,
              lidarrUrl: null,
              lidarrApiKey: null,
              aiProvider: 'openai',
              aiModel: 'gpt-4o-mini',
              aiApiKey: 'test-key',
              aiBaseUrl: null,
              preferences: null,
            }) as SettingsRow,
        ),
        storeDb: {
          getExistingRecommendationMbids: vi.fn(async () => new Set<string>()),
          getRejectedMbids: vi.fn(async () => new Set<string>()),
          getBlockedMbids: vi.fn(async () => new Set<string>()),
          getFeedbackHistory: vi.fn(async () => new Map()),
        } as unknown as AppDependencies['storeDb'],
      }),
    )

    const { createSession } = await import('@/core/sessions')
    await createSession(1, 'session-token')

    const res = await authedRequest(app, '/api/v1/pipeline/quick-discover', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
        'X-Digarr-Locale': 'fr',
      },
      body: JSON.stringify({ artistName: 'jazz nocturno' }),
    })

    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(getRecommendations).toHaveBeenCalledWith(
        expect.objectContaining({
          responseLocale: 'fr',
          promptLocale: 'es',
        }),
      )
    })
  })
})

describe('POST /api/v1/pipeline/rescan', () => {
  const mbid = '00000000-0000-0000-0000-000000000470'

  beforeEach(() => {
    mocks.fetchArtistImage.mockReset()
    mocks.musicBrainzClient.lookupArtist.mockReset()
    mocks.upsertArtist.mockReset()
  })

  function rescanDeps(
    artist: Record<string, unknown>,
    settings: Partial<SettingsRow> = {},
  ): AppDependencies {
    return makeDeps({
      storeDb: {
        tryConsumeRateLimit: vi.fn(async () => true),
      } as unknown as AppDependencies['storeDb'],
      getSettings: vi.fn(
        async () =>
          ({
            id: 1,
            lidarrUrl: 'http://lidarr:8686',
            lidarrApiKey: 'key',
            audiodbApiKey: 'audiodb-key',
            preferences: {
              fanartApiKey: 'fanart-key',
              metadataFallbackUrl: 'https://metadata.example.test',
            },
            ...settings,
          }) as SettingsRow,
      ),
      listRecommendations: vi.fn(async () => ({
        items: [{ artist }],
        total: 1,
      })) as unknown as AppDependencies['listRecommendations'],
      getUserById: vi.fn(async () => ({ isAdmin: true, preferences: null }) as never),
    })
  }

  it('rejects non-admin users before shared artist metadata can be changed', async () => {
    const deps = rescanDeps({
      mbid,
      name: 'Shared Artist',
      imageUrl: null,
      imageFailedAt: null,
    })
    deps.getUserById = vi.fn(async () => ({ isAdmin: false }) as never)
    const app = createApp(deps)

    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(403)
    expect(mocks.fetchArtistImage).not.toHaveBeenCalled()
  })

  it('rejects a concurrent rescan while one is already running', async () => {
    let releaseLookup: (() => void) | undefined
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    mocks.fetchArtistImage.mockImplementation(async () => {
      await lookupGate
      return { failed: true }
    })
    mocks.upsertArtist.mockResolvedValue({})
    const app = createApp(
      rescanDeps({
        mbid,
        name: 'Slow Artist',
        imageUrl: null,
        imageFailedAt: null,
        disambiguation: 'already present',
      }),
    )

    const first = authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })
    await vi.waitFor(() => expect(mocks.fetchArtistImage).toHaveBeenCalledTimes(1))
    const second = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(second.status).toBe(409)
    releaseLookup?.()
    expect((await first).status).toBe(200)
  })

  it('rate-limits repeated rescans from the same admin', async () => {
    mocks.fetchArtistImage.mockResolvedValue({ failed: false })
    const app = createApp(
      rescanDeps({
        mbid,
        name: 'Repeated Rescan Artist',
        imageUrl: null,
        imageFailedAt: null,
        disambiguation: 'already present',
      }),
    )

    const first = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })
    const second = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })
    const third = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(third.status).toBe(429)
  })

  it('uses the configured image fallback chain and refreshes disambiguation', async () => {
    mocks.fetchArtistImage.mockResolvedValue({
      url: 'https://images.example.test/artist.jpg',
      logoUrl: 'https://images.example.test/logo.png',
      failed: false,
    })
    mocks.musicBrainzClient.lookupArtist.mockResolvedValue({
      id: mbid,
      name: 'Fallback Artist',
      disambiguation: 'Berlin electronic duo',
    })
    mocks.upsertArtist.mockResolvedValue({})

    const app = createApp(
      rescanDeps({
        mbid,
        name: 'Fallback Artist',
        imageUrl: null,
        imageFailedAt: null,
        disambiguation: null,
      }),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(mocks.fetchArtistImage).toHaveBeenCalledWith(
      mbid,
      'Fallback Artist',
      mocks.audiodbClient,
      mocks.lidarrClient,
      mocks.fanartClient,
      mocks.musicinfoClient,
    )
    expect(mocks.upsertArtist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mbid,
        imageUrl: 'https://images.example.test/artist.jpg',
        logoUrl: 'https://images.example.test/logo.png',
        disambiguation: 'Berlin electronic duo',
      }),
    )
    expect(await res.json()).toEqual({ attempted: 1, updated: 1, failed: 0, total: 1 })
  })

  it('negative-caches a complete image miss without blocking disambiguation', async () => {
    mocks.fetchArtistImage.mockResolvedValue({ failed: true })
    mocks.musicBrainzClient.lookupArtist.mockResolvedValue({
      id: mbid,
      name: 'Missing Image',
      disambiguation: 'Canadian post-rock band',
    })
    mocks.upsertArtist.mockResolvedValue({})

    const app = createApp(
      rescanDeps(
        {
          mbid,
          name: 'Missing Image',
          imageUrl: null,
          imageFailedAt: null,
          disambiguation: null,
        },
        { preferences: DEFAULT_PREFERENCES },
      ),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(mocks.upsertArtist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mbid,
        disambiguation: 'Canadian post-rock band',
        imageFailed: true,
      }),
    )
    expect(await res.json()).toEqual({ attempted: 1, updated: 0, failed: 1, total: 1 })
  })

  it('does not share a negative cache across user-scoped provider configurations', async () => {
    mocks.fetchArtistImage.mockResolvedValue({ failed: false })
    const recentFailure = new Date().toISOString()

    const app = createApp(
      rescanDeps({
        mbid,
        name: 'User Provider Artist',
        imageUrl: null,
        imageFailedAt: recentFailure,
        disambiguation: 'already present',
      }),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(mocks.fetchArtistImage).toHaveBeenCalledTimes(1)
    expect(mocks.upsertArtist).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ attempted: 1, updated: 0, failed: 1, total: 1 })
  })

  it('reports unexpected per-artist failures without aborting the rescan', async () => {
    mocks.fetchArtistImage.mockRejectedValue(new Error('unexpected image failure'))

    const app = createApp(
      rescanDeps({
        mbid,
        name: 'Retry Later',
        imageUrl: null,
        imageFailedAt: null,
        disambiguation: 'already present',
      }),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ attempted: 1, updated: 0, failed: 1, total: 1 })
  })

  it('attempts each artist once when multiple recommendations reference it', async () => {
    mocks.fetchArtistImage.mockResolvedValue({ failed: true })
    mocks.upsertArtist.mockResolvedValue({})
    const artist = {
      mbid,
      name: 'Repeated Artist',
      imageUrl: null,
      imageFailedAt: null,
      disambiguation: 'already present',
    }
    const deps = rescanDeps(artist)
    deps.listRecommendations = vi.fn(async () => ({
      items: [{ artist }, { artist }],
      total: 2,
    })) as unknown as AppDependencies['listRecommendations']
    const app = createApp(deps)

    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(mocks.fetchArtistImage).toHaveBeenCalledTimes(1)
    expect(await res.json()).toEqual({ attempted: 1, updated: 0, failed: 1, total: 1 })
  })
})
