// @vitest-environment node

import { EventEmitter } from 'node:events'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '@/core/auth'
import { clearAllSessions, createSession } from '@/core/sessions'

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

beforeEach(async () => {
  await clearAllSessions()
})

afterEach(async () => {
  delete process.env.DIGARR_AUTH_TOKEN
  await clearAllSessions()
})

describe('POST /api/auth/register', () => {
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
      jellyfinUrl: null,
      jellyfinApiKey: null,
      jellyfinUserId: null,
      embyUrl: null,
      embyApiKey: null,
      embyUserId: null,
      discogsToken: null,
      discogsUsername: null,
      createdAt: new Date(),
    }))
    const app = createApp(makeDeps({ createUser, getUserCount: vi.fn(async () => 0) }))

    const res = await app.request('/api/auth/register', {
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
      jellyfinUrl: null,
      jellyfinApiKey: null,
      jellyfinUserId: null,
      embyUrl: null,
      embyApiKey: null,
      embyUserId: null,
      discogsToken: null,
      discogsUsername: null,
      createdAt: new Date(),
    }))
    const app = createApp(makeDeps({ createUser, getUserCount: vi.fn(async () => 1) }))

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'user2', password: 'password1234' }),
    })

    expect(res.status).toBe(201)
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: false }))
  })

  it('returns 400 for missing username or password', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for short password', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test', password: 'short' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for short username', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/register', {
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
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'taken', password: 'password1234' }),
    })
    expect(res.status).toBe(409)
  })
})

describe('POST /api/auth/login', () => {
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

    const res = await app.request('/api/auth/login', {
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

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'wrongpassword' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for nonexistent user', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'password1234' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing fields', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('localizes missing-credentials errors from the request locale', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/login', {
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
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password1234' }),
    })
    const { token } = await loginRes.json()

    // Use the session token to access a protected route
    const res = await app.request('/api/settings', {
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

    const res = await app.request('/api/settings', {
      headers: { Authorization: 'Bearer invalid-token-here' },
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
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
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password1234' }),
    })
    const { token } = await loginRes.json()

    // Logout
    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(logoutRes.status).toBe(200)

    // Token should no longer work
    const res = await app.request('/api/settings', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/auth/me', () => {
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
        getUserCount: vi.fn(async () => 1),
      }),
    )

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password1234' }),
    })
    const { token } = await loginRes.json()

    const res = await app.request('/api/auth/me', {
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
        getUserCount: vi.fn(async () => 1),
      }),
    )

    await createSession(1, 'session-token')
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer session-token' },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ preferredLocale: 'de' }))
  })
})

describe('GET /api/auth/validate', () => {
  it('returns 204 for a valid session token', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 1) }))

    await createSession(1, 'session-token')
    const res = await app.request('/api/auth/validate', {
      headers: { Authorization: 'Bearer session-token' },
    })

    expect(res.status).toBe(204)
  })

  it('returns 401 when unauthenticated', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 1) }))
    const res = await app.request('/api/auth/validate')
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/auth/me/locale', () => {
  it('updates preferred locale through PATCH /api/auth/me/locale', async () => {
    const updateUserPreferredLocale = vi.fn(async () => {})
    const app = createApp({
      ...makeDeps({ getUserCount: vi.fn(async () => 1) }),
      updateUserPreferredLocale,
    } as AppDependencies)

    await createSession(1, 'session-token')
    const res = await app.request('/api/auth/me/locale', {
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

    const res = await app.request('/api/auth/me/locale', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preferredLocale: 'de' }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Session authentication required' })
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
    const res = await app.request('/api/auth/me/locale', {
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
    const res = await app.request('/api/auth/me/locale', {
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

describe('POST /api/auth/change-password', () => {
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
    const res = await app.request('/api/auth/change-password', {
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
    expect(body.ok).toBe(true)
    expect(body.token).toEqual(expect.any(String))
    expect(body.token).not.toBe('session-token')
    expect(updatePassword).toHaveBeenCalledOnce()
    expect(updatePassword).toHaveBeenCalledWith(1, expect.any(String))
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

    const res = await app.request('/api/auth/change-password', {
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
    await expect(res.json()).resolves.toEqual({ error: 'Session authentication required' })
    expect(updatePassword).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/auth/me/preferences', () => {
  it('rejects legacy read-only token auth', async () => {
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', 1)
      c.set('legacyTokenAuth', true)
      await next()
    })
    app.route('/', authRoutes(makeDeps()))

    const res = await app.request('/api/auth/me/preferences', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scoreThreshold: 0.8,
      }),
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Session authentication required' })
  })
})

describe('GET /api/auth/status', () => {
  it('reports hasUsers: false when no users exist', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 0) }))
    const res = await app.request('/api/auth/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hasUsers).toBe(false)
    expect(body.required).toBe(true)
  })

  it('reports hasUsers: true and required: true when users exist', async () => {
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 2) }))
    const res = await app.request('/api/auth/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hasUsers).toBe(true)
    expect(body.required).toBe(true)
  })
})
