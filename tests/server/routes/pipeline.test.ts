// @vitest-environment node

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

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

describe('POST /api/pipeline/run', () => {
  it('returns 202 when pipeline is not running', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await app.request('/api/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.message).toBe('Pipeline started')
  })

  it('returns 409 when pipeline is already running', async () => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await app.request('/api/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already running/i)
  })

  it('returns 400 when settings are missing', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const app = createApp(
      makeDeps({
        orchestrator,
        getSettings: vi.fn(async () => null),
      }),
    )
    const res = await app.request('/api/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/pipeline/status', () => {
  it('returns running: false when not running', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/pipeline/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.running).toBe(false)
    expect(body.lastRun).toBeUndefined()
  })

  it('returns running: true when orchestrator is running', async () => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await app.request('/api/pipeline/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.running).toBe(true)
  })

  it('includes lastRun when a batch exists', async () => {
    const lastBatch = { id: 42, createdAt: new Date('2024-06-01'), status: 'completed' }
    const app = createApp(makeDeps({ getLastBatch: vi.fn(async () => lastBatch) }))
    const res = await app.request('/api/pipeline/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lastRun).toBeDefined()
    expect(body.lastRun.batchId).toBe(42)
    expect(body.lastRun.status).toBe('completed')
  })
})

describe('GET /api/pipeline/events', () => {
  it('returns text/event-stream content type', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/pipeline/events')
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })
})
