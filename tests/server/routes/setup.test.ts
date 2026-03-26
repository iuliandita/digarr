// @vitest-environment node

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

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
      discogsToken: null,
      discogsUsername: null,
      createdAt: new Date(),
    })),
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 0),
    updatePassword: vi.fn(async () => {}),
    genreService: {} as unknown as AppDependencies['genreService'],
    libraryHealth: {} as unknown as AppDependencies['libraryHealth'],
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
      getRunsForSubscription: vi.fn(async () => []),
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
    listenbrainzUsername: 'testuser',
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

  it('rejects when neither listenbrainzUsername nor lastfmUsername is provided', async () => {
    const app = createApp(makeDeps())
    const body = {
      lidarrUrl: 'http://lidarr:8686',
      lidarrApiKey: 'abc123',
      aiProvider: 'ollama',
      aiModel: 'llama3',
    }
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
  })

  it('accepts lastfmUsername as the music source', async () => {
    const app = createApp(makeDeps())
    const body = {
      lidarrUrl: 'http://lidarr:8686',
      lidarrApiKey: 'abc123',
      aiProvider: 'ollama',
      aiModel: 'llama3',
      lastfmUsername: 'lfmuser',
    }
    const res = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
  })
})
