// @vitest-environment node

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { envConfig } from '@/config/env'
import type { OidcService } from '@/core/auth/oidc'
import { clearAllSessions } from '@/core/sessions'
import { FirstUserRequiredError } from '@/db/queries/users'
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

function usernameCollision(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'users_username_unique',
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
    createUser: vi.fn(async () => userRow()),
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async () => userRow()),
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
      cancel: vi.fn().mockResolvedValue(undefined),
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
  Object.assign(envConfig, { disableRegistration: false })
})

afterEach(async () => {
  await clearAllSessions()
})

describe('first-admin race: POST /api/auth/register', () => {
  it('uses the user selected by atomic bootstrap', async () => {
    const createUser = vi.fn(async (data: { username: string; isAdmin?: boolean }) => {
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

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'loser', password: 'password1234' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.user.isAdmin).toBe(false)
    expect(createUser).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ username: 'loser' }),
      { bootstrap: 'allow-existing' },
    )
  })

  it('refuses a closed-registration race loser without creating a session', async () => {
    Object.assign(envConfig, { disableRegistration: true })
    const createUser = vi.fn(async () => {
      throw new FirstUserRequiredError()
    })
    const app = createApp(makeRegisterDeps({ createUser }))
    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'loser', password: 'password1234' }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error:
        'Registration is disabled. Set DIGARR_DISABLE_REGISTRATION=false to allow open registration.',
    })
    expect(createUser).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
      bootstrap: 'first-user-only',
    })
  })

  it('returns 409 when the race is already lost AND the username was taken', async () => {
    const createUser = vi.fn(async () => {
      throw usernameCollision()
    })
    const getUserByUsername = vi.fn(async () => null)

    const app = createApp(
      makeRegisterDeps({
        createUser,
        getUserByUsername,
        getUserCount: vi.fn(async () => 0),
      }),
    )

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'loser', password: 'password1234' }),
    })

    expect(res.status).toBe(409)
    expect(createUser).toHaveBeenCalledTimes(1)
  })

  it('propagates unrelated unique violations as 500', async () => {
    const createUser = vi.fn(async () => {
      throw Object.assign(new Error('email taken'), {
        code: '23505',
        constraint: 'users_email_unique',
      })
    })
    const app = createApp(
      makeRegisterDeps({
        createUser,
        getUserByUsername: vi.fn(async () => null),
        getUserCount: vi.fn(async () => 0),
      }),
    )

    const res = await app.request('/api/v1/auth/register', {
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
  }) {
    const app = new Hono()
    app.use(
      '*',
      proxyAuthMiddleware({
        enabled: true,
        trustedProxies: ['0.0.0.0/32'],
        getUserByUsername: opts.getUserByUsername ?? (async () => null),
        createUser: opts.createUser,
      }),
    )
    app.get('/test', (c) => {
      const userId = c.get('userId' as never)
      return c.json({ userId })
    })
    return app
  }

  it('delegates admin selection to atomic bootstrap', async () => {
    const createUser = vi.fn(async (data: { username: string; isAdmin?: boolean }) => {
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
    expect(createUser).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
      bootstrap: 'allow-existing',
    })
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
      throw usernameCollision()
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
      updateUser: vi.fn(async () => {}),
      ...overrides,
    }
    const app = new Hono()
    app.route('/', oidcRoutes(deps))
    return { app, deps }
  }

  it('delegates admin selection to atomic bootstrap', async () => {
    const createUser = vi.fn(async (data: { username: string; isAdmin?: boolean }) => {
      return { id: 99, username: data.username, isAdmin: data.isAdmin ?? false }
    })

    const { app } = buildOidcApp({ createUser })
    const res = await app.request('/api/v1/auth/oidc/callback?state=s&code=c')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('/')
    expect(location).not.toContain('token')
    expect(location).not.toContain('race-test-token')
    expect(res.headers.get('set-cookie')).toContain(
      'digarr_session=race-test-token; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax',
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(createUser).toHaveBeenCalledExactlyOnceWith(expect.any(Object), {
      bootstrap: 'allow-existing',
    })
  })

  it('propagates unrelated errors as oidc_error', async () => {
    const createUser = vi.fn(async () => {
      throw new Error('db offline')
    })

    const { app } = buildOidcApp({ createUser })
    const res = await app.request('/api/v1/auth/oidc/callback?state=s&code=c')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('oidc_error=')
    expect(createUser).toHaveBeenCalledTimes(1)
  })
})
