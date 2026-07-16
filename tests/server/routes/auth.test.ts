// @vitest-environment node

import { EventEmitter } from 'node:events'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '@/core/auth'
import { clearAllSessions, createSession, getSession } from '@/core/sessions'

// Registration is closed by default (DIGARR_DISABLE_REGISTRATION defaults to true).
// Override to false so registration tests can create users.
vi.mock('@/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/config/env')>()
  return {
    ...original,
    envConfig: { ...original.envConfig, disableRegistration: false },
  }
})

import type { AppDependencies } from '@/server'
import { createApp } from '@/server'
import { authRoutes } from '@/server/routes/auth'
import type { HonoEnv } from '@/server/types'

const APP_ORIGIN = 'http://localhost'

function sessionCookieToken(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  const match = setCookie?.match(/(?:^|,\s*)digarr_session=([^;]+)/)
  if (!match?.[1]) throw new Error('session cookie missing')
  return match[1]
}

const sameOriginHeaders = {
  'X-Digarr-CSRF': '1',
  Origin: APP_ORIGIN,
  'Sec-Fetch-Site': 'same-origin',
} as const

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
    createUser: vi.fn(async (data) => ({
      id: 1,
      username: data.username,
      isAdmin: data.isAdmin ?? false,
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
    getUserById: vi.fn(async () => ({
      id: 1,
      username: 'testuser',
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
  }
}

beforeEach(async () => {
  await clearAllSessions()
})

afterEach(async () => {
  delete process.env.DIGARR_AUTH_TOKEN
  await clearAllSessions()
  // Reset the shared in-memory rate-limit buckets so per-IP/user counts from one
  // test never bleed into the next (the rate-limited email/login/etc. endpoints
  // key on a module-global store).
  const { __shutdownRateLimiter } = await import('@/server/middleware/rate-limit')
  __shutdownRateLimiter()
})

describe('POST /api/v1/auth/register', () => {
  it('creates the first user as admin', async () => {
    const createUser = vi.fn(async (data: { username: string; isAdmin?: boolean }) => ({
      id: 1,
      username: data.username,
      isAdmin: true,
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
    }))
    const app = createApp(makeDeps({ createUser, getUserCount: vi.fn(async () => 0) }))

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password1234' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.user.username).toBe('admin')
    expect(body.token).toBeDefined()
    expect(typeof body.token).toBe('string')
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'admin', isAdmin: true }),
    )
  })

  it('creates subsequent users as non-admin', async () => {
    const createUser = vi.fn(async (data: { username: string; isAdmin?: boolean }) => ({
      id: 2,
      username: data.username,
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
    }))
    const app = createApp(makeDeps({ createUser, getUserCount: vi.fn(async () => 1) }))

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'user2', password: 'password1234' }),
    })

    expect(res.status).toBe(201)
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: false }))
  })

  it('issues a cookie-only session when cookie mode is requested', async () => {
    const app = createApp(makeDeps())
    await createSession(1, 'old-browser-session')
    await createSession(1, 'unrelated-device-session')

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Digarr-Auth-Mode': 'cookie',
        Cookie: 'digarr_session=old-browser-session',
        ...sameOriginHeaders,
      },
      body: JSON.stringify({ username: 'admin', password: 'password1234' }),
    })

    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toContain('HttpOnly')
    expect(res.headers.get('set-cookie')).toContain('SameSite=Lax')
    const body = await res.json()
    expect(body).toEqual({ user: expect.objectContaining({ username: 'admin' }) })
    expect(body.token).toBeUndefined()

    const newToken = sessionCookieToken(res)
    await expect(getSession(newToken)).resolves.toEqual({ userId: 1 })
    await expect(getSession('old-browser-session')).resolves.toBeNull()
    await expect(getSession('unrelated-device-session')).resolves.toEqual({ userId: 1 })
  })

  it('returns 400 for missing username or password', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for short password', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test', password: 'short' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for short username', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'x', password: 'password1234' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 409 for duplicate username', async () => {
    const app = createApp(
      makeDeps({
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'taken',
          passwordHash: 'hash',
          isAdmin: false,
        })),
      }),
    )
    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'taken', password: 'password1234' }),
    })
    expect(res.status).toBe(409)
  })
})

describe('POST /api/v1/auth/login', () => {
  it('returns token on successful login', async () => {
    const storedHash = hashPassword('correctpassword')
    const app = createApp(
      makeDeps({
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          passwordHash: storedHash,
          isAdmin: false,
        })),
      }),
    )

    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'correctpassword' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBeDefined()
    expect(body.user.username).toBe('testuser')
    // passwordHash should not be in the response
    expect(body.user.passwordHash).toBeUndefined()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('issues a cookie-only session and replaces only the presented browser cookie', async () => {
    const storedHash = hashPassword('correctpassword')
    const app = createApp(
      makeDeps({
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          passwordHash: storedHash,
          isAdmin: false,
        })),
      }),
    )
    await createSession(1, 'old-browser-session')
    await createSession(1, 'unrelated-device-session')

    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Digarr-Auth-Mode': 'cookie',
        Cookie: 'digarr_session=old-browser-session',
        ...sameOriginHeaders,
      },
      body: JSON.stringify({ username: 'testuser', password: 'correctpassword' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toContain('HttpOnly')
    expect(res.headers.get('set-cookie')).toContain('SameSite=Lax')
    const body = await res.json()
    expect(body).toEqual({ user: expect.objectContaining({ username: 'testuser' }) })
    expect(body.token).toBeUndefined()

    const newToken = sessionCookieToken(res)
    await expect(getSession(newToken)).resolves.toEqual({ userId: 1 })
    await expect(getSession('old-browser-session')).resolves.toBeNull()
    await expect(getSession('unrelated-device-session')).resolves.toEqual({ userId: 1 })
  })

  it('returns 401 for wrong password', async () => {
    const storedHash = hashPassword('correctpassword')
    const app = createApp(
      makeDeps({
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          passwordHash: storedHash,
          isAdmin: false,
        })),
      }),
    )

    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'wrongpassword' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for nonexistent user', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'password1234' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing fields', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('localizes missing-credentials errors from the request locale', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Digarr-Locale': 'fr',
      },
      body: JSON.stringify({ username: '', password: '' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        error: "Le nom d'utilisateur et le mot de passe sont requis",
      }),
    )
  })

  it('emits i18n code for invalid credentials', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nope', password: 'wrongpassword' }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('errors.auth.invalidCredentials')
  })

  it('rate limits bursts from the same source at 11th request', async () => {
    // Each failed login runs constant-time scrypt (~700ms uninstrumented,
    // ~2s under v8 coverage), so the burst can reach 20-25s. Bump timeout.
    const { __shutdownRateLimiter } = await import('@/server/middleware/rate-limit')
    __shutdownRateLimiter()
    const app = createApp(makeDeps())
    const headers = { 'Content-Type': 'application/json' }
    const body = JSON.stringify({ username: 'nobody', password: 'wrongpassword123' })
    for (let i = 0; i < 10; i++) {
      const r = await app.request('/api/v1/auth/login', { method: 'POST', headers, body })
      expect(r.status).toBe(401)
    }
    const r11 = await app.request('/api/v1/auth/login', { method: 'POST', headers, body })
    expect(r11.status).toBe(429)
    expect(r11.headers.get('Retry-After')).not.toBeNull()
    __shutdownRateLimiter()
  }, 60_000)
})

describe('session token authentication', () => {
  it('session token from login grants access to protected routes', async () => {
    const storedHash = hashPassword('password1234')
    const app = createApp(
      makeDeps({
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          passwordHash: storedHash,
          isAdmin: false,
        })),
        getUserCount: vi.fn(async () => 1),
      }),
    )

    // Login to get a session token
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password1234' }),
    })
    const { token } = await loginRes.json()

    // Use the session token to access a protected route
    const res = await app.request('/api/v1/settings', {
      headers: { Authorization: `Bearer ${token}` },
    })
    // Should not be 401 (may be 404 since getSettings returns null)
    expect(res.status).not.toBe(401)
  })

  it('invalid session token returns 401 when users exist', async () => {
    const app = createApp(
      makeDeps({
        getUserCount: vi.fn(async () => 1),
      }),
    )

    const res = await app.request('/api/v1/settings', {
      headers: { Authorization: 'Bearer invalid-token-here' },
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/auth/session/migrate', () => {
  it('atomically rotates a verified bearer into a cookie without leaking a token', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 1) }))
    await createSession(1, 'browser-bearer')
    await createSession(1, 'old-browser-cookie')
    await createSession(1, 'unrelated-device-session')

    const res = await app.request('/api/v1/auth/session/migrate', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer browser-bearer',
        Cookie: 'digarr_session=old-browser-cookie',
      },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('')
    const newToken = sessionCookieToken(res)
    await expect(getSession(newToken)).resolves.toEqual({ userId: 1 })
    await expect(getSession('browser-bearer')).resolves.toBeNull()
    await expect(getSession('old-browser-cookie')).resolves.toBeNull()
    await expect(getSession('unrelated-device-session')).resolves.toEqual({ userId: 1 })

    const replay = await app.request('/api/v1/auth/session/migrate', {
      method: 'POST',
      headers: { Authorization: 'Bearer browser-bearer' },
    })
    expect(replay.status).toBe(401)
  })

  it('rejects the legacy bearer with a dedicated problem', async () => {
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      c.set('legacyTokenAuth', true)
      c.set('authMethod', 'legacy-bearer')
      await next()
    })
    app.route('/', authRoutes(makeDeps()))

    const res = await app.request('/api/v1/auth/session/migrate', {
      method: 'POST',
      headers: { Authorization: 'Bearer legacy-token' },
    })

    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    await expect(res.json()).resolves.toMatchObject({
      type: '/problems/auth-session-migration-legacy-token',
      status: 403,
    })
  })

  it.each([
    'session-cookie',
    'session-query',
    'proxy',
  ] as const)('rejects verified %s auth because migration requires a bearer', async (authMethod) => {
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      c.set('authMethod', authMethod)
      await next()
    })
    app.route('/', authRoutes(makeDeps()))

    const res = await app.request('/api/v1/auth/session/migrate', { method: 'POST' })

    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    await expect(res.json()).resolves.toMatchObject({
      type: '/problems/auth-session-migration-requires-bearer',
      status: 403,
    })
  })

  it('leaves an invalid bearer to the auth middleware', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 1) }))

    const res = await app.request('/api/v1/auth/session/migrate', {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-session' },
    })

    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('maps rotation conflicts to a stable generic 409 problem', async () => {
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      c.set('authMethod', 'session-bearer')
      await next()
    })
    app.route('/', authRoutes(makeDeps()))

    const res = await app.request('/api/v1/auth/session/migrate', {
      method: 'POST',
      headers: { Authorization: 'Bearer already-consumed-session' },
    })

    expect(res.status).toBe(409)
    expect(res.headers.get('set-cookie')).toBeNull()
    await expect(res.json()).resolves.toEqual({
      type: '/problems/auth-session-migration-conflict',
      title: 'Session migration conflict',
      status: 409,
    })
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('invalidates the session token', async () => {
    const storedHash = hashPassword('password1234')
    const app = createApp(
      makeDeps({
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          passwordHash: storedHash,
          isAdmin: false,
        })),
        getUserCount: vi.fn(async () => 1),
      }),
    )

    // Login
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password1234' }),
    })
    const { token } = await loginRes.json()

    // Logout
    const logoutRes = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(logoutRes.status).toBe(204)
    expect(await logoutRes.text()).toBe('')

    // Token should no longer work
    const res = await app.request('/api/v1/settings', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  it('clears the session cookie on logout', async () => {
    const storedHash = hashPassword('password1234')
    const app = createApp(
      makeDeps({
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          passwordHash: storedHash,
          isAdmin: false,
        })),
        getUserCount: vi.fn(async () => 1),
      }),
    )

    // Login
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password1234' }),
    })
    const { token } = await loginRes.json()

    // Logout with Bearer token
    const logoutRes = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(logoutRes.status).toBe(204)
    // The response should include a Set-Cookie header clearing the session cookie
    const setCookie = logoutRes.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('digarr_session=')
    expect(setCookie?.toLowerCase()).toContain('max-age=0')
  })

  it('deletes session from cookie when no Bearer header is present', async () => {
    const storedHash = hashPassword('password1234')
    const app = createApp(
      makeDeps({
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          passwordHash: storedHash,
          isAdmin: false,
        })),
        getUserCount: vi.fn(async () => 1),
      }),
    )

    // Login
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password1234' }),
    })
    const { token } = await loginRes.json()

    // Logout without Bearer header, using cookie instead
    const logoutRes = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Cookie: `digarr_session=${token}`, ...sameOriginHeaders },
    })
    expect(logoutRes.status).toBe(204)

    // Token should no longer work (session was deleted from DB)
    const res = await app.request('/api/v1/settings', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  it('invalidates distinct bearer and cookie sessions while preserving other devices', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 1) }))
    await createSession(1, 'bearer-session')
    await createSession(1, 'cookie-session')
    await createSession(1, 'unrelated-session')

    const res = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-session',
        Cookie: 'digarr_session=cookie-session',
      },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toContain('digarr_session=;')
    expect(res.headers.get('set-cookie')).toContain('Path=/')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
    await expect(getSession('bearer-session')).resolves.toBeNull()
    await expect(getSession('cookie-session')).resolves.toBeNull()
    await expect(getSession('unrelated-session')).resolves.toEqual({ userId: 1 })
  })

  it('does not interpret a malformed Authorization value as a session token', async () => {
    const app = new Hono<HonoEnv>()
    app.route('/', authRoutes(makeDeps()))
    await createSession(1, 'opaque-header-value')
    await createSession(1, 'cookie-session')

    const res = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: 'opaque-header-value',
        Cookie: 'digarr_session=cookie-session',
      },
    })

    expect(res.status).toBe(204)
    await expect(getSession('opaque-header-value')).resolves.toEqual({ userId: 1 })
    await expect(getSession('cookie-session')).resolves.toBeNull()
  })
})

describe('GET /api/v1/auth/me', () => {
  it('returns current user when authenticated via session', async () => {
    const storedHash = hashPassword('password1234')
    const app = createApp(
      makeDeps({
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          passwordHash: storedHash,
          isAdmin: false,
        })),
        getUserById: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
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
        getUserCount: vi.fn(async () => 1),
      }),
    )

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password1234' }),
    })
    const { token } = await loginRes.json()

    const res = await app.request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.username).toBe('testuser')
  }, 15_000)

  it('returns preferredLocale from /api/auth/me', async () => {
    const app = createApp(
      makeDeps({
        getUserById: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          isAdmin: false,
          preferences: null,
          preferredLocale: 'de',
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
        getUserCount: vi.fn(async () => 1),
      }),
    )

    await createSession(1, 'session-token')
    const res = await app.request('/api/v1/auth/me', {
      headers: { Authorization: 'Bearer session-token' },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ preferredLocale: 'de' }))
  })
})

describe('GET /api/v1/auth/validate', () => {
  it('returns 204 for a valid session token', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 1) }))

    await createSession(1, 'session-token')
    const res = await app.request('/api/v1/auth/validate', {
      headers: { Authorization: 'Bearer session-token' },
    })

    expect(res.status).toBe(204)
  })

  it('returns 401 when unauthenticated', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 1) }))
    const res = await app.request('/api/v1/auth/validate')
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/v1/auth/me/locale', () => {
  it('updates preferred locale through PATCH /api/auth/me/locale', async () => {
    const updateUserPreferredLocale = vi.fn(async () => {})
    const app = createApp({
      ...makeDeps({ getUserCount: vi.fn(async () => 1) }),
      updateUserPreferredLocale,
    } as AppDependencies)

    await createSession(1, 'session-token')
    const res = await app.request('/api/v1/auth/me/locale', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preferredLocale: 'es-MX' }),
    })

    expect(res.status).toBe(200)
    expect(updateUserPreferredLocale).toHaveBeenCalledWith(1, 'es')
  })

  it('rejects legacy read-only token auth', async () => {
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      c.set('legacyTokenAuth', true)
      await next()
    })
    app.route('/', authRoutes(makeDeps()))

    const res = await app.request('/api/v1/auth/me/locale', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preferredLocale: 'de' }),
    })

    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    await expect(res.json()).resolves.toMatchObject({
      type: '/problems/session-auth-required',
      title: 'Session authentication required',
      status: 403,
      code: 'errors.auth.notAuthenticated',
    })
  })

  it('returns 400 for non-string preferredLocale payloads', async () => {
    const updateUserPreferredLocale = vi.fn(async () => {})
    const app = createApp(
      makeDeps({
        updateUserPreferredLocale,
        getUserCount: vi.fn(async () => 1),
      }),
    )

    await createSession(1, 'session-token')
    const res = await app.request('/api/v1/auth/me/locale', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preferredLocale: 123 }),
    })

    expect(res.status).toBe(400)
    expect(updateUserPreferredLocale).not.toHaveBeenCalled()
  })

  it('returns 404 when the authenticated user no longer exists', async () => {
    const updateUserPreferredLocale = vi.fn(async () => {})
    const app = createApp(
      makeDeps({
        updateUserPreferredLocale,
        getUserById: vi.fn(async () => null),
        getUserCount: vi.fn(async () => 1),
      }),
    )

    await createSession(1, 'session-token')
    const res = await app.request('/api/v1/auth/me/locale', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preferredLocale: 'de' }),
    })

    expect(res.status).toBe(404)
    expect(updateUserPreferredLocale).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/auth/change-password', () => {
  it('changes the password for a session-authenticated user', async () => {
    const storedHash = hashPassword('oldpassword123')
    const updatePassword = vi.fn(async () => {})
    const app = createApp(
      makeDeps({
        updatePassword,
        getUserCount: vi.fn(async () => 1),
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          passwordHash: storedHash,
          isAdmin: false,
        })),
      }),
    )

    await createSession(1, 'session-token')
    await createSession(1, 'second-user-session')
    await createSession(2, 'other-account-session')
    const res = await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toEqual(expect.any(String))
    expect(body.token).not.toBe('session-token')
    expect(body.ok).toBeUndefined()
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(updatePassword).toHaveBeenCalledOnce()
    expect(updatePassword).toHaveBeenCalledWith(1, expect.any(String))
    await expect(getSession('session-token')).resolves.toBeNull()
    await expect(getSession('second-user-session')).resolves.toBeNull()
    await expect(getSession(body.token)).resolves.toEqual({ userId: 1 })
    await expect(getSession('other-account-session')).resolves.toEqual({ userId: 2 })
  }, 10_000)

  it('returns only a fresh cookie for a cookie-authenticated password change', async () => {
    const storedHash = hashPassword('oldpassword123')
    const updatePassword = vi.fn(async () => {})
    const app = createApp(
      makeDeps({
        updatePassword,
        getUserCount: vi.fn(async () => 1),
        getUserByUsername: vi.fn(async () => ({
          id: 1,
          username: 'testuser',
          passwordHash: storedHash,
          isAdmin: false,
        })),
      }),
    )
    await createSession(1, 'cookie-session')
    await createSession(1, 'second-user-session')
    await createSession(2, 'other-account-session')

    const res = await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: {
        Cookie: 'digarr_session=cookie-session',
        'Content-Type': 'application/json',
        ...sameOriginHeaders,
      },
      body: JSON.stringify({
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
      }),
    })

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const newToken = sessionCookieToken(res)
    await expect(getSession(newToken)).resolves.toEqual({ userId: 1 })
    await expect(getSession('cookie-session')).resolves.toBeNull()
    await expect(getSession('second-user-session')).resolves.toBeNull()
    await expect(getSession('other-account-session')).resolves.toEqual({ userId: 2 })
  })

  it('returns only a fresh cookie for a proxy-authenticated password change', async () => {
    const storedHash = hashPassword('oldpassword123')
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      c.set('authMethod', 'proxy')
      c.set('proxyAuth', true)
      await next()
    })
    app.route(
      '/',
      authRoutes(
        makeDeps({
          getUserByUsername: vi.fn(async () => ({
            id: 1,
            username: 'testuser',
            passwordHash: storedHash,
            isAdmin: false,
          })),
        }),
      ),
    )

    const res = await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
      }),
    })

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toContain('HttpOnly')
  })

  it('keeps query-authenticated password changes behind the CSRF rejection', async () => {
    const updatePassword = vi.fn(async () => {})
    const { csrfGuard } = await import('@/server/middleware/csrf')
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      c.set('authMethod', 'session-query')
      await next()
    })
    app.use('*', csrfGuard)
    app.route('/', authRoutes(makeDeps({ updatePassword })))

    const res = await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
      }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      type: '/problems/csrf-validation-failed',
    })
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('rejects legacy read-only token auth', async () => {
    const updatePassword = vi.fn(async () => {})
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      c.set('legacyTokenAuth', true)
      await next()
    })
    app.route('/', authRoutes(makeDeps({ updatePassword })))

    const res = await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
      }),
    })

    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    await expect(res.json()).resolves.toMatchObject({
      type: '/problems/session-auth-required',
      title: 'Session authentication required',
      status: 403,
      code: 'errors.auth.notAuthenticated',
    })
    expect(updatePassword).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/v1/auth/me/preferences', () => {
  it('rejects legacy read-only token auth', async () => {
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      c.set('legacyTokenAuth', true)
      await next()
    })
    app.route('/', authRoutes(makeDeps()))

    const res = await app.request('/api/v1/auth/me/preferences', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scoreThreshold: 0.8,
      }),
    })

    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    await expect(res.json()).resolves.toMatchObject({
      type: '/problems/session-auth-required',
      title: 'Session authentication required',
      status: 403,
      code: 'errors.auth.notAuthenticated',
    })
  })
})

describe('GET /api/v1/auth/status', () => {
  it('reports hasUsers: false when no users exist', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 0) }))
    const res = await app.request('/api/v1/auth/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hasUsers).toBe(false)
    expect(body.required).toBe(true)
  })

  it('reports hasUsers: true and required: true when users exist', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 2) }))
    const res = await app.request('/api/v1/auth/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hasUsers).toBe(true)
    expect(body.required).toBe(true)
  })
})

describe('PATCH /api/v1/auth/me/email', () => {
  async function emailRequest(deps: AppDependencies, body: unknown) {
    const app = createApp(deps)
    await createSession(1, 'session-token')
    return app.request('/api/v1/auth/me/email', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  it('sets the email for a session-authenticated user', async () => {
    const updateUser = vi.fn(async () => {})
    const res = await emailRequest(makeDeps({ updateUser, getUserCount: vi.fn(async () => 1) }), {
      email: 'me@example.com',
    })
    expect(res.status).toBe(200)
    expect(updateUser).toHaveBeenCalledWith(1, { email: 'me@example.com' })
  })

  it('clears the email when given an empty string', async () => {
    const updateUser = vi.fn(async () => {})
    const res = await emailRequest(makeDeps({ updateUser, getUserCount: vi.fn(async () => 1) }), {
      email: '',
    })
    expect(res.status).toBe(200)
    expect(updateUser).toHaveBeenCalledWith(1, { email: null })
  })

  it('returns 400 for an invalid email', async () => {
    const updateUser = vi.fn(async () => {})
    const res = await emailRequest(makeDeps({ updateUser, getUserCount: vi.fn(async () => 1) }), {
      email: 'not-an-email',
    })
    expect(res.status).toBe(400)
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('returns 409 when the email belongs to another user', async () => {
    const updateUser = vi.fn(async () => {})
    const res = await emailRequest(
      makeDeps({
        updateUser,
        getUserByEmail: vi.fn(async () => ({ id: 2, username: 'other' })),
        getUserCount: vi.fn(async () => 2),
      }),
      { email: 'taken@example.com' },
    )
    expect(res.status).toBe(409)
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('allows re-saving an email the user already owns', async () => {
    const updateUser = vi.fn(async () => {})
    const res = await emailRequest(
      makeDeps({
        updateUser,
        getUserByEmail: vi.fn(async () => ({ id: 1, username: 'testuser' })),
        getUserCount: vi.fn(async () => 1),
      }),
      { email: 'me@example.com' },
    )
    expect(res.status).toBe(200)
    expect(updateUser).toHaveBeenCalledWith(1, { email: 'me@example.com' })
  })

  it('normalizes the email to lowercase before the uniqueness check and storage', async () => {
    const updateUser = vi.fn(async () => {})
    const getUserByEmail = vi.fn(async () => null)
    const res = await emailRequest(
      makeDeps({ updateUser, getUserByEmail, getUserCount: vi.fn(async () => 1) }),
      { email: 'Mixed@Case.COM' },
    )
    expect(res.status).toBe(200)
    // Case-insensitive: storing and checking both use the lowercased form, so
    // Mixed@Case.COM and mixed@case.com cannot become two distinct rows.
    expect(getUserByEmail).toHaveBeenCalledWith('mixed@case.com')
    expect(updateUser).toHaveBeenCalledWith(1, { email: 'mixed@case.com' })
  })

  it('rate-limits the email endpoint (blunts the email-collision enumeration oracle)', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 1) }))
    await createSession(1, 'session-token')
    const fire = () =>
      app.request('/api/v1/auth/me/email', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer session-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'probe@example.com' }),
      })
    // 5/min budget: the 6th attempt from the same caller is throttled.
    for (let i = 0; i < 5; i++) expect((await fire()).status).toBe(200)
    expect((await fire()).status).toBe(429)
  })
})
