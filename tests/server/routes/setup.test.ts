// @vitest-environment node

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '93.184.216.34', family: 4 })),
}))

vi.mock('@/core/sessions', async () => {
  const actual = await vi.importActual<typeof import('@/core/sessions')>('@/core/sessions')
  return {
    ...actual,
    getSession: vi.fn(async (token: string) =>
      token === 'test-session-token' ? { userId: 42, token } : null,
    ),
  }
})

const { updateUserConnectionsMock } = vi.hoisted(() => ({
  updateUserConnectionsMock: vi.fn(async () => {}),
}))
vi.mock('@/db/queries/users', async () => {
  const actual = await vi.importActual<typeof import('@/db/queries/users')>('@/db/queries/users')
  return {
    ...actual,
    updateUserConnections: updateUserConnectionsMock,
  }
})

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning: false,
    run: vi.fn(async () => ({ batchId: 1 })),
  })
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    db: { execute: vi.fn(async () => []) } as unknown as AppDependencies['db'],
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: makeMockOrchestrator() as unknown as AppDependencies['orchestrator'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    isSetupComplete: vi.fn(async () => false),
    getSettings: vi.fn(async () => null),
    updateSettings: vi.fn(async () => {}),
    completeSetup: vi.fn(async () => ({ id: 1, setupComplete: true })),
    getLastBatch: vi.fn(async () => null),
    listRecommendations: vi.fn(async () => ({ items: [], total: 0 })),
    getRecommendation: vi.fn(async () => null),
    updateRecommendationStatus: vi.fn(async () => {}),
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

describe('GET /api/setup/status', () => {
  it('returns setupComplete: false when setup is not done', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/setup/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.setupComplete).toBe(false)
  })

  it('returns setupComplete: true after setup is complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => true }))
    const res = await app.request('/api/setup/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.setupComplete).toBe(true)
  })
})

describe('POST /api/setup/complete', () => {
  const validBody = {
    lidarrUrl: 'http://lidarr:8686',
    lidarrApiKey: 'abc123',
    aiProvider: 'ollama',
    aiModel: 'llama3',
  }

  it('accepts valid config and returns 200', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(200)
  })

  it('calls completeSetup with the config', async () => {
    const completeSetup = vi.fn(async () => ({ id: 1, setupComplete: true }))
    const app = createApp(makeDeps({ completeSetup }))
    await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(completeSetup).toHaveBeenCalledTimes(1)
  })

  it('rejects missing lidarrUrl with 400', async () => {
    const app = createApp(makeDeps())
    const { lidarrUrl: _, ...body } = validBody
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing lidarrApiKey with 400', async () => {
    const app = createApp(makeDeps())
    const { lidarrApiKey: _, ...body } = validBody
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing aiProvider with 400', async () => {
    const app = createApp(makeDeps())
    const { aiProvider: _, ...body } = validBody
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing aiModel with 400', async () => {
    const app = createApp(makeDeps())
    const { aiModel: _, ...body } = validBody
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
  })

  it('accepts AI-only setup in discovery mode', async () => {
    const app = createApp(makeDeps())
    const body = {
      aiProvider: 'ollama',
      aiModel: 'llama3',
    }
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
  })

  it('strips legacy listening-source fields before persisting setup', async () => {
    const completeSetup = vi.fn(async () => ({ id: 1, setupComplete: true }))
    const app = createApp(makeDeps({ completeSetup }))
    const body = {
      ...validBody,
      listenbrainzUsername: 'legacy-lb',
      listenbrainzToken: 'legacy-token',
      lastfmUsername: 'legacy-lastfm',
      lastfmApiKey: 'legacy-key',
    }
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
    expect(completeSetup).toHaveBeenCalledWith({
      lidarrUrl: 'http://lidarr:8686',
      lidarrApiKey: 'abc123',
      aiProvider: 'ollama',
      aiModel: 'llama3',
    })
  })

  it('rejects emby fields when apiKey or userId are missing', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embyUrl: 'http://emby:8096',
        aiProvider: 'ollama',
        aiModel: 'llama3',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts emby fields and creates an emby-playlist target during setup completion', async () => {
    updateUserConnectionsMock.mockClear()
    const createTarget = vi.fn().mockResolvedValue({ id: 7 })
    const deps = makeDeps({
      getUserCount: vi.fn(async () => 1),
      targetQueries: {
        createTarget,
        getTargetsByUser: vi.fn().mockResolvedValue([]),
        getAllTargets: vi.fn().mockResolvedValue([]),
        getTarget: vi.fn().mockResolvedValue(null),
        updateTarget: vi.fn().mockResolvedValue(undefined),
        deleteTarget: vi.fn().mockResolvedValue(undefined),
      },
    })
    const app = createApp(deps)
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-session-token',
      },
      body: JSON.stringify({
        embyUrl: 'http://emby:8096',
        embyApiKey: 'key',
        embyUserId: 'user-1',
        skipTlsVerify: true,
        aiProvider: 'openai',
        aiModel: 'gpt-5.4-mini',
      }),
    })
    expect(res.status).toBe(200)
    expect(createTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'emby-playlist',
        name: 'Emby',
        config: {
          url: 'http://emby:8096',
          apiKey: 'key',
          userId: 'user-1',
          skipTlsVerify: true,
        },
        userId: 42,
      }),
    )
    // Emby credentials must also land on the users row so library sync, the
    // discovery plugin, and the listening fallback can read them post-setup.
    expect(updateUserConnectionsMock).toHaveBeenCalledWith(expect.anything(), 42, {
      embyUrl: 'http://emby:8096',
      embyApiKey: 'key',
      embyUserId: 'user-1',
    })
  })
})
