// @vitest-environment node

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning: false,
    run: vi.fn(async () => ({ batchId: 1 })),
  })
}

function makeDeps(overrides: Partial<import('@/server').AppDependencies> = {}) {
  // Inline import type to avoid pulling in the whole module at top level
  type AppDependencies = import('@/server').AppDependencies
  return {
    db: { execute: vi.fn(async () => []) } as unknown as AppDependencies['db'],
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: makeMockOrchestrator() as unknown as AppDependencies['orchestrator'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    isSetupComplete: async () => true,
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
      preferredLocale: null,
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
  } satisfies AppDependencies
}

describe('auth middleware', () => {
  const TOKEN = 'test-secret-token-12345'

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.DIGARR_AUTH_TOKEN
  })

  async function createAppWithAuth(options?: {
    token?: string
    overrides?: Partial<import('@/server').AppDependencies>
  }) {
    if (options?.token) process.env.DIGARR_AUTH_TOKEN = options.token
    // Re-import to pick up the new env var
    const { createApp } = await import('@/server')
    return createApp(makeDeps(options?.overrides))
  }

  describe('when DIGARR_AUTH_TOKEN is not set', () => {
    it('reports auth as not required before setup completes', async () => {
      const app = await createAppWithAuth({
        overrides: { isSetupComplete: async () => false },
      })
      const res = await app.request('/api/auth/status')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.required).toBe(false)
    }, 10_000)

    it('requires auth after setup completes even when no users exist yet', async () => {
      const app = await createAppWithAuth({
        overrides: { isSetupComplete: async () => true, getUserCount: vi.fn(async () => 0) },
      })

      const statusRes = await app.request('/api/auth/status')
      expect(statusRes.status).toBe(200)
      await expect(statusRes.json()).resolves.toMatchObject({
        required: true,
        hasUsers: false,
      })

      const res = await app.request('/api/settings')
      expect(res.status).toBe(401)
      await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
    })
  })

  describe('when DIGARR_AUTH_TOKEN is set', () => {
    it('reports auth as required', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/auth/status')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.required).toBe(true)
    })

    it('returns 401 for requests without Authorization header', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/settings')
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe('Unauthorized')
    })

    it('returns 401 for requests with wrong token', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/settings', {
        headers: { Authorization: 'Bearer wrong-token' },
      })
      expect(res.status).toBe(401)
    })

    it('returns 401 for malformed Authorization header', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/settings', {
        headers: { Authorization: `Basic ${TOKEN}` },
      })
      expect(res.status).toBe(401)
    })

    it('allows requests with correct Bearer token', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/settings', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      // Should pass auth (may get other errors, but not 401)
      expect(res.status).not.toBe(401)
    })

    it('allows SSE requests with correct token as query param', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request(`/api/pipeline/events?token=${TOKEN}`)
      expect(res.status).not.toBe(401)
    })

    it('returns 401 for token query params on regular API routes', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request(`/api/settings?token=${TOKEN}`)
      expect(res.status).toBe(401)
    })

    it('returns 401 for wrong token as query param on SSE routes', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/pipeline/events?token=wrong')
      expect(res.status).toBe(401)
    })

    it('bypasses auth for /health', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/health')
      expect(res.status).toBe(200)
    })

    it('bypasses auth for /api/auth/status', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/auth/status')
      expect(res.status).toBe(200)
    })

    it('returns 401 for length-mismatched tokens (timing-safe)', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/settings', {
        headers: { Authorization: 'Bearer x' },
      })
      expect(res.status).toBe(401)
    })
  })
})
