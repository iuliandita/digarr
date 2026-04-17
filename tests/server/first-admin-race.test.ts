// @vitest-environment node

/**
 * Tests for the first-admin bootstrap race (subphase 1c). The 0026 migration
 * installs a partial unique index `users_single_admin ON users(is_admin) WHERE
 * is_admin = true` that guarantees at-most-one admin at the DB layer. These
 * tests simulate the 23505 collision raised by the index and assert that the
 * three admin-creation sites (register, proxy-auth, oidc) resolve the race
 * correctly instead of surfacing a 500.
 */

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OidcService } from '@/core/auth/oidc'
import { clearAllSessions } from '@/core/sessions'
import { proxyAuthMiddleware } from '@/server/middleware/proxy-auth'
import { oidcRoutes } from '@/server/routes/oidc'

vi.mock('@/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/config/env')>()
  return {
    ...original,
    envConfig: {
      ...original.envConfig,
      disableRegistration: false,
      allowedOrigin: 'http://localhost:3000',
    },
  }
})

vi.mock('@/core/auth', () => ({
  generateSessionToken: vi.fn(() => 'race-test-token'),
  hashPassword: vi.fn(() => 'mocked-hash'),
  verifyPassword: vi.fn(() => false),
}))

vi.mock('@/core/sessions', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/sessions')>()
  return {
    ...orig,
    createSession: vi.fn(async () => {}),
    getSession: vi.fn(async () => null),
  }
})

import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

function singleAdminCollision(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'users_single_admin',
  })
}

function userRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    username: 'admin',
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
    ...overrides,
  }
}

function makeRegisterDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  const base: Partial<AppDependencies> = {
    db: { execute: vi.fn(async () => []) } as unknown as AppDependencies['db'],
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: {
      isRunning: false,
      run: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as AppDependencies['orchestrator'],
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
    createUser: vi.fn(async () => userRow()),
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async () => userRow()),
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
  }
  return { ...base, ...overrides } as AppDependencies
}

beforeEach(async () => {
  await clearAllSessions()
})

afterEach(async () => {
  await clearAllSessions()
})

describe('first-admin race: POST /api/auth/register', () => {
  it('falls back to a non-admin user when the single-admin index collides', async () => {
    let call = 0
    const createUser = vi.fn(async (data: { username: string; isAdmin?: boolean }) => {
      call += 1
      if (call === 1) {
        // The DB-level partial unique index serialises admin creation.
        throw singleAdminCollision()
      }
      return userRow({ id: 2, username: data.username, isAdmin: data.isAdmin ?? false })
    })
    const getUserByUsername = vi.fn(async () => null)

    const app = createApp(
      makeRegisterDeps({
        createUser,
        getUserByUsername,
        getUserCount: vi.fn(async () => 0),
      }),
    )

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'loser', password: 'password1234' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.user.isAdmin).toBe(false)
    expect(createUser).toHaveBeenCalledTimes(2)
    expect(createUser).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ username: 'loser', isAdmin: true }),
    )
    expect(createUser).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ username: 'loser', isAdmin: false }),
    )
  })

  it('returns 409 when the race is already lost AND the username was taken', async () => {
    const createUser = vi.fn(async () => {
      throw singleAdminCollision()
    })
    let usernameLookup = 0
    const getUserByUsername = vi.fn(async () => {
      usernameLookup += 1
      // First call is the pre-insert existence check (no user yet).
      // Second call is the post-collision recheck (winner now exists).
      return usernameLookup === 1
        ? null
        : {
            id: 1,
            username: 'loser',
            passwordHash: 'h',
            isAdmin: true,
          }
    })

    const app = createApp(
      makeRegisterDeps({
        createUser,
        getUserByUsername,
        getUserCount: vi.fn(async () => 0),
      }),
    )

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'loser', password: 'password1234' }),
    })

    expect(res.status).toBe(409)
    expect(createUser).toHaveBeenCalledTimes(1)
  })

  it('propagates unrelated 23505 errors (e.g. username uniqueness) as 500', async () => {
    const createUser = vi.fn(async () => {
      throw Object.assign(new Error('username taken'), {
        code: '23505',
        constraint: 'users_username_unique',
      })
    })
    const app = createApp(
      makeRegisterDeps({
        createUser,
        getUserByUsername: vi.fn(async () => null),
        getUserCount: vi.fn(async () => 0),
      }),
    )

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'collider', password: 'password1234' }),
    })

    expect(res.status).toBe(500)
    expect(createUser).toHaveBeenCalledTimes(1)
  })
})

describe('first-admin race: proxyAuthMiddleware', () => {
  type ProxyCreateUser = (data: {
    username: string
    passwordHash: string
    isAdmin?: boolean
    email?: string
    authProvider?: string
  }) => Promise<{ id: number; username: string }>
  type ProxyGetUserByUsername = (
    username: string,
  ) => Promise<{ id: number; username: string } | null>

  function buildProxyApp(opts: {
    createUser: ProxyCreateUser
    getUserByUsername?: ProxyGetUserByUsername
    getUserCount?: () => Promise<number>
  }) {
    const app = new Hono()
    app.use(
      '*',
      proxyAuthMiddleware({
        enabled: true,
        trustedProxies: ['0.0.0.0/32'],
        getUserByUsername: opts.getUserByUsername ?? (async () => null),
        createUser: opts.createUser,
        getUserCount: opts.getUserCount ?? (async () => 0),
      }),
    )
    app.get('/test', (c) => {
      const userId = c.get('userId' as never)
      return c.json({ userId })
    })
    return app
  }

  it('retries as non-admin when the single-admin index collides', async () => {
    let call = 0
    const createUser = vi.fn(async (data: { username: string; isAdmin?: boolean }) => {
      call += 1
      if (call === 1) throw singleAdminCollision()
      return {
        id: 42,
        username: data.username,
        isAdmin: data.isAdmin ?? false,
        createdAt: new Date(),
      }
    })

    const app = buildProxyApp({ createUser })
    const res = await app.request('/test', { headers: { 'X-Forwarded-User': 'alice' } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe(42)
    expect(createUser).toHaveBeenCalledTimes(2)
    expect(createUser).toHaveBeenNthCalledWith(1, expect.objectContaining({ isAdmin: true }))
    expect(createUser).toHaveBeenNthCalledWith(2, expect.objectContaining({ isAdmin: false }))
  })

  it('uses the existing row when the race winner shares our username', async () => {
    const existing = {
      id: 7,
      username: 'alice',
      passwordHash: 'h',
      isAdmin: true,
      createdAt: new Date(),
    }
    let lookupCall = 0
    const getUserByUsername = vi.fn(async () => {
      lookupCall += 1
      // First lookup: user not found (before createUser). Second: winner exists.
      return lookupCall === 1 ? null : existing
    })
    const createUser = vi.fn(async () => {
      throw singleAdminCollision()
    })

    const app = buildProxyApp({ createUser, getUserByUsername })
    const res = await app.request('/test', { headers: { 'X-Forwarded-User': 'alice' } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe(7)
    expect(createUser).toHaveBeenCalledTimes(1)
  })
})

describe('first-admin race: oidc callback', () => {
  function makeOidcService() {
    return {
      getAuthorizationUrl: vi.fn(async () => ({
        url: 'https://idp.example.com/authorize',
        state: 's',
      })),
      handleCallback: vi.fn(async () => ({
        claims: {
          sub: 'oidc-sub-xyz',
          email: 'bob@example.com',
          emailVerified: true,
          preferredUsername: 'bob',
        },
        accessToken: 'at',
        expiresIn: 3600,
      })),
      resetDiscovery: vi.fn(),
    } as unknown as OidcService
  }

  function buildOidcApp(overrides: Record<string, unknown>) {
    const service = makeOidcService()
    const deps = {
      getOidcService: vi.fn(async () => service),
      getUserByOidcSubject: vi.fn(async () => null),
      getUserByEmail: vi.fn(async () => null),
      getUserByUsername: vi.fn(async () => null),
      createUser: vi.fn(async (data: { username: string; isAdmin?: boolean }) => ({
        id: 1,
        username: data.username,
        isAdmin: data.isAdmin ?? false,
      })),
      getUserCount: vi.fn(async () => 0),
      updateUser: vi.fn(async () => {}),
      ...overrides,
    }
    const app = new Hono()
    app.route('/', oidcRoutes(deps))
    return { app, deps }
  }

  it('retries as non-admin when the single-admin index collides', async () => {
    let call = 0
    const createUser = vi.fn(async (data: { username: string; isAdmin?: boolean }) => {
      call += 1
      if (call === 1) throw singleAdminCollision()
      return { id: 99, username: data.username, isAdmin: data.isAdmin ?? false }
    })

    const { app } = buildOidcApp({ createUser })
    const res = await app.request('/api/auth/oidc/callback?state=s&code=c')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oidc_token=')
    expect(createUser).toHaveBeenCalledTimes(2)
    expect(createUser).toHaveBeenNthCalledWith(1, expect.objectContaining({ isAdmin: true }))
    expect(createUser).toHaveBeenNthCalledWith(2, expect.objectContaining({ isAdmin: false }))
  })

  it('propagates unrelated errors as oidc_error', async () => {
    const createUser = vi.fn(async () => {
      throw new Error('db offline')
    })

    const { app } = buildOidcApp({ createUser })
    const res = await app.request('/api/auth/oidc/callback?state=s&code=c')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oidc_error=')
    expect(createUser).toHaveBeenCalledTimes(1)
  })
})
