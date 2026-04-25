// @vitest-environment node

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '@/core/sessions'

vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(() => ({})),
}))

vi.mock('@/core/pipeline/resolve', () => ({
  resolve: vi.fn(async () => []),
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

import type { SettingsRow } from '@/db/queries/settings'
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
      jellyfinUrl: null,
      jellyfinApiKey: null,
      jellyfinUserId: null,
      embyUrl: null,
      embyApiKey: null,
      embyUserId: null,
      discogsToken: null,
      discogsUsername: null,
      createdAt: new Date(),
    })),
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 0),
    updatePassword: vi.fn(async () => {}),
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

  it('returns 409 when pipeline is already running', async () => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.title).toMatch(/already/i)
    expect(body.code).toBe('errors.pipeline.alreadyRunning')
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
          jellyfinUrl: null,
          jellyfinApiKey: null,
          jellyfinUserId: null,
          embyUrl: null,
          embyApiKey: null,
          embyUserId: null,
          discogsToken: null,
          discogsUsername: null,
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
    expect(orchestrator.run).toHaveBeenCalledWith(
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
    expect(orchestrator.run).toHaveBeenCalledWith(expect.objectContaining({ librarySync }))
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
          jellyfinUrl: null,
          jellyfinApiKey: null,
          jellyfinUserId: null,
          embyUrl: null,
          embyApiKey: null,
          embyUserId: null,
          discogsToken: null,
          discogsUsername: null,
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
          jellyfinUrl: null,
          jellyfinApiKey: null,
          jellyfinUserId: null,
          embyUrl: null,
          embyApiKey: null,
          embyUserId: null,
          discogsToken: null,
          discogsUsername: null,
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
          jellyfinUrl: null,
          jellyfinApiKey: null,
          jellyfinUserId: null,
          embyUrl: null,
          embyApiKey: null,
          embyUserId: null,
          discogsToken: null,
          discogsUsername: null,
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
