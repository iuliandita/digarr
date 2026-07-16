// @vitest-environment node

import { EventEmitter } from 'node:events'
import { type Context, Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

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

  async function createCredentialSourceApp(options?: {
    legacyToken?: string
    session?: { token: string; userId: number }
  }) {
    if (options?.legacyToken) process.env.DIGARR_AUTH_TOKEN = options.legacyToken
    vi.resetModules()

    const [{ createSession }, { authGuard }, { SESSION_COOKIE_NAME }] = await Promise.all([
      import('@/core/sessions'),
      import('@/server/middleware/auth'),
      import('@/server/middleware/session-cookie'),
    ])
    if (options?.session) {
      await createSession(options.session.userId, options.session.token)
    }

    const app = new Hono<HonoEnv>()
    app.use(
      '*',
      authGuard({
        hasUsers: async () => true,
        isSetupComplete: async () => true,
      }),
    )
    const respondWithAuthContext = (c: Context<HonoEnv>) =>
      c.json({
        userId: c.get('userId'),
        authMethod: c.get('authMethod'),
        legacyTokenAuth: c.get('legacyTokenAuth'),
      })
    app.get('/api/v1/test', respondWithAuthContext)
    app.get('/api/v1/pipeline/events', respondWithAuthContext)
    app.get('/api/v1/preview/audio', respondWithAuthContext)

    return { app, sessionCookieName: SESSION_COOKIE_NAME }
  }

  describe('verified credential source', () => {
    const SESSION_TOKEN = 'verified-session-token-12345'

    it('records a verified bearer session', async () => {
      const { app } = await createCredentialSourceApp({
        session: { token: SESSION_TOKEN, userId: 42 },
      })

      const res = await app.request('/api/v1/test', {
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
      })

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        userId: 42,
        authMethod: 'session-bearer',
      })
    })

    it('records a verified cookie session', async () => {
      const { app, sessionCookieName } = await createCredentialSourceApp({
        session: { token: SESSION_TOKEN, userId: 42 },
      })

      const res = await app.request('/api/v1/test', {
        headers: { cookie: `${sessionCookieName}=${SESSION_TOKEN}` },
      })

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        userId: 42,
        authMethod: 'session-cookie',
      })
    })

    it('records a query session only on an allowlisted route', async () => {
      const { app } = await createCredentialSourceApp({
        session: { token: SESSION_TOKEN, userId: 42 },
      })

      const allowed = await app.request(`/api/v1/pipeline/events?token=${SESSION_TOKEN}`)
      expect(allowed.status).toBe(200)
      await expect(allowed.json()).resolves.toEqual({
        userId: 42,
        authMethod: 'session-query',
      })

      const denied = await app.request(`/api/v1/test?token=${SESSION_TOKEN}`)
      expect(denied.status).toBe(401)
    })

    it('records a legacy query token only on an allowlisted route', async () => {
      const { app } = await createCredentialSourceApp({ legacyToken: TOKEN })

      const allowed = await app.request(`/api/v1/preview/audio?token=${TOKEN}`)
      expect(allowed.status).toBe(200)
      await expect(allowed.json()).resolves.toEqual({
        userId: 1,
        authMethod: 'legacy-query',
        legacyTokenAuth: true,
      })

      const denied = await app.request(`/api/v1/test?token=${TOKEN}`)
      expect(denied.status).toBe(401)
    })

    it('records a verified legacy bearer token and compatibility flag', async () => {
      const { app } = await createCredentialSourceApp({ legacyToken: TOKEN })

      const res = await app.request('/api/v1/test', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        userId: 1,
        authMethod: 'legacy-bearer',
        legacyTokenAuth: true,
      })
    })

    it('does not fall back to a valid cookie after an invalid bearer token', async () => {
      const { app, sessionCookieName } = await createCredentialSourceApp({
        session: { token: SESSION_TOKEN, userId: 42 },
      })

      const res = await app.request('/api/v1/test', {
        headers: {
          Authorization: 'Bearer invalid-session-token',
          cookie: `${sessionCookieName}=${SESSION_TOKEN}`,
        },
      })

      expect(res.status).toBe(401)
    })

    it('does not fall back to a valid cookie after a malformed Authorization header', async () => {
      const { app, sessionCookieName } = await createCredentialSourceApp({
        session: { token: SESSION_TOKEN, userId: 42 },
      })

      const res = await app.request('/api/v1/test', {
        headers: {
          Authorization: 'Basic invalid-credentials',
          cookie: `${sessionCookieName}=${SESSION_TOKEN}`,
        },
      })

      expect(res.status).toBe(401)
    })

    it('never accepts the legacy deployment token from a cookie', async () => {
      const { app, sessionCookieName } = await createCredentialSourceApp({ legacyToken: TOKEN })

      const res = await app.request('/api/v1/test', {
        headers: { cookie: `${sessionCookieName}=${TOKEN}` },
      })

      expect(res.status).toBe(401)
    })
  })

  describe('when DIGARR_AUTH_TOKEN is not set', () => {
    it('reports auth as not required before setup completes', async () => {
      const app = await createAppWithAuth({
        overrides: { isSetupComplete: async () => false },
      })
      const res = await app.request('/api/v1/auth/status')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.required).toBe(false)
    }, 10_000)

    it('returns 503 for degenerate state: setup complete but no users exist', async () => {
      // Orphaned DB state - admin record deleted while setup flag stayed true,
      // or an interrupted migration. 503 signals ops to re-run setup rather
      // than letting callers retry a 401 indefinitely.
      const app = await createAppWithAuth({
        overrides: { isSetupComplete: async () => true, getUserCount: vi.fn(async () => 0) },
      })

      const statusRes = await app.request('/api/v1/auth/status')
      expect(statusRes.status).toBe(200)
      await expect(statusRes.json()).resolves.toMatchObject({
        required: true,
        hasUsers: false,
      })

      const res = await app.request('/api/v1/settings')
      expect(res.status).toBe(503)
      expect(res.headers.get('content-type')).toContain('application/problem+json')
      await expect(res.json()).resolves.toMatchObject({
        type: '/problems/setup-admin-missing',
        title: 'Setup admin user missing',
        status: 503,
      })
    })
  })

  describe('when DIGARR_AUTH_TOKEN is set', () => {
    it('reports auth as required', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/v1/auth/status')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.required).toBe(true)
    })

    it('returns 401 for requests without Authorization header', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/v1/settings')
      expect(res.status).toBe(401)
      expect(res.headers.get('content-type')).toContain('application/problem+json')
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="digarr"')
      const body = await res.json()
      expect(body).toMatchObject({
        type: '/problems/not-authenticated',
        title: 'Not authenticated',
        status: 401,
        code: 'errors.auth.notAuthenticated',
      })
    })

    it('returns 401 for requests with wrong token', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/v1/settings', {
        headers: { Authorization: 'Bearer wrong-token' },
      })
      expect(res.status).toBe(401)
    })

    it('returns 401 for malformed Authorization header', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/v1/settings', {
        headers: { Authorization: `Basic ${TOKEN}` },
      })
      expect(res.status).toBe(401)
    })

    it('allows requests with correct Bearer token', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/v1/settings', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      // Should pass auth (may get other errors, but not 401)
      expect(res.status).not.toBe(401)
    })

    it('allows SSE requests with correct token as query param', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request(`/api/v1/pipeline/events?token=${TOKEN}`)
      expect(res.status).not.toBe(401)
    })

    it('returns 401 for token query params on regular API routes', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request(`/api/v1/settings?token=${TOKEN}`)
      expect(res.status).toBe(401)
    })

    it('returns 401 for wrong token as query param on SSE routes', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/v1/pipeline/events?token=wrong')
      expect(res.status).toBe(401)
    })

    it('bypasses auth for /health', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/health')
      expect(res.status).toBe(200)
    })

    it('bypasses auth for /api/auth/status', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/v1/auth/status')
      expect(res.status).toBe(200)
    })

    it('returns 401 for length-mismatched tokens (timing-safe)', async () => {
      const app = await createAppWithAuth({ token: TOKEN })
      const res = await app.request('/api/v1/settings', {
        headers: { Authorization: 'Bearer x' },
      })
      expect(res.status).toBe(401)
    })
  })
})
