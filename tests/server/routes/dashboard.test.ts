// @vitest-environment node

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { dashboardRoutes } from '@/server/routes/dashboard'
import { makeDeps as makeSharedDeps } from '../../helpers/test-app'

const USER_ID = 42

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return makeSharedDeps({
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: {} as unknown as AppDependencies['orchestrator'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    getSettings: vi.fn(
      async () =>
        ({
          id: 1,
          lidarrUrl: 'http://lidarr:8686',
          lidarrApiKey: 'key',
          preferences: {},
        }) as SettingsRow,
    ),
    getUserById: vi.fn(async (id: number) =>
      id === USER_ID
        ? { id: USER_ID, username: 'testuser', isAdmin: false, preferences: null }
        : null,
    ) as unknown as AppDependencies['getUserById'],
    getUserCount: vi.fn(async () => 0),
    ...overrides,
  })
}

function createTestApp(deps: AppDependencies, userId: number | undefined) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    if (userId !== undefined) {
      c.set('userId' as never, userId as never)
    }
    return next()
  })
  app.route('/', dashboardRoutes(deps))
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  delete process.env.DIGARR_AUTH_TOKEN
})

async function createMountedAppWithLegacyToken(
  token: string,
  overrides: Partial<AppDependencies> = {},
) {
  vi.resetModules()
  process.env.DIGARR_AUTH_TOKEN = token
  const { createApp } = await import('@/server')
  return createApp(makeDeps(overrides))
}

describe('GET /api/v1/dashboard/taste', () => {
  it('returns array of taste genres', async () => {
    const mockResult = [{ genre: 'post-rock', count: 5, percentage: 32 }]
    const deps = makeDeps({
      dashboardQueries: {
        getTopGenresForUser: vi.fn(async () => mockResult),
        getLatestGenreCoverage: vi.fn(async () => null),
        getRecentActivity: vi.fn(async () => []),
      },
    })
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/dashboard/taste')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ genre: 'post-rock', count: 5, percentage: 32 })
    expect(deps.dashboardQueries.getTopGenresForUser).toHaveBeenCalledWith(USER_ID)
  })

  it('passes undefined userId when not authenticated', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, undefined)
    const res = await app.request('/api/v1/dashboard/taste')
    expect(res.status).toBe(200)
    expect(deps.dashboardQueries.getTopGenresForUser).toHaveBeenCalledWith(undefined)
  })
})

describe('GET /api/v1/dashboard/genre-coverage', () => {
  it('returns the latest user-scoped pipeline coverage', async () => {
    const coverage = { coveredArtists: 18, pendingArtists: 4, totalArtists: 25 }
    const getLatestGenreCoverage = vi.fn(async () => coverage)
    const deps = makeDeps({
      dashboardQueries: {
        getTopGenresForUser: vi.fn(async () => []),
        getRecentActivity: vi.fn(async () => []),
        getLatestGenreCoverage,
      },
    })
    const app = createTestApp(deps, USER_ID)

    const res = await app.request('/api/v1/dashboard/genre-coverage')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(coverage)
    expect(getLatestGenreCoverage).toHaveBeenCalledWith(USER_ID)
  })

  it('returns null before a pipeline has recorded coverage', async () => {
    const deps = makeDeps({
      dashboardQueries: {
        getTopGenresForUser: vi.fn(async () => []),
        getRecentActivity: vi.fn(async () => []),
        getLatestGenreCoverage: vi.fn(async () => null),
      },
    })
    const app = createTestApp(deps, USER_ID)

    const res = await app.request('/api/v1/dashboard/genre-coverage')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toBeNull()
  })
})

describe('GET /api/v1/dashboard/activity', () => {
  it('returns array of activity entries', async () => {
    const mockActivity = [
      {
        type: 'approved' as const,
        timestamp: '2026-03-21T10:00:00Z',
        data: { artistName: 'Slowdive' },
      },
    ]
    const deps = makeDeps({
      dashboardQueries: {
        getTopGenresForUser: vi.fn(async () => []),
        getLatestGenreCoverage: vi.fn(async () => null),
        getRecentActivity: vi.fn(async () => mockActivity),
      },
    })
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/dashboard/activity')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ type: 'approved', data: { artistName: 'Slowdive' } })
  })

  it('passes limit from query param', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/dashboard/activity?limit=3')
    expect(res.status).toBe(200)
    expect(deps.dashboardQueries.getRecentActivity).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Boolean),
      3,
    )
  })

  it('caps limit at 20', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/dashboard/activity?limit=100')
    expect(res.status).toBe(200)
    expect(deps.dashboardQueries.getRecentActivity).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Boolean),
      20,
    )
  })

  it('returns 400 when limit is not an integer', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/dashboard/activity?limit=abc')
    expect(res.status).toBe(400)
    expect(deps.dashboardQueries.getRecentActivity).not.toHaveBeenCalled()
  })

  it('treats legacy-token auth as non-admin even when user 1 is admin', async () => {
    const token = 'legacy-dashboard-token'
    const getRecentActivity = vi.fn(async () => [])
    const app = await createMountedAppWithLegacyToken(token, {
      getUserById: vi.fn(async () => ({
        id: 1,
        username: 'admin',
        isAdmin: true,
        preferences: null,
        email: null,
        oidcSubject: null,
        oidcIssuer: null,
        authProvider: 'local',
        listenbrainzUsername: null,
        listenbrainzToken: null,
        lastfmUsername: null,
        lastfmApiKey: null,
        plexUrl: null,
        plexToken: null,
        plexSectionId: null,
        plexAccountId: null,
        plexAccountName: null,
        plexMachineIdentifier: null,
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
      })) as unknown as AppDependencies['getUserById'],
      dashboardQueries: {
        getTopGenresForUser: vi.fn(async () => []),
        getLatestGenreCoverage: vi.fn(async () => null),
        getRecentActivity,
      },
    })

    const res = await app.request('/api/v1/dashboard/activity', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(getRecentActivity).toHaveBeenCalledWith(1, false, 5)
  }, 15_000)
})
