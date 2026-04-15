// @vitest-environment node

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'

vi.mock('@/db/queries/oauth-tokens', () => ({
  getOAuthToken: vi.fn(),
}))

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning: false,
    run: vi.fn(async () => ({ batchId: 1 })),
  })
}

const USER_ID = 42

const mockSub = {
  id: 1,
  userId: USER_ID,
  name: 'My Sub',
  enabled: true,
  sourceType: 'genre',
  sourceProvider: 'library',
  sourceConfig: { genreSlug: 'rock' } as Record<string, unknown>,
  maxArtistsPerRun: 20,
  listenerRange: null,
  cron: '0 9 * * *',
  action: 'recommend',
  scoreThreshold: null,
  scoringWeightPreset: null,
  scoringWeightOverrides: null,
  lastRunAt: null,
  lastResultCount: null,
  lastError: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const mockSubQueries = {
  createSubscription: vi.fn(async () => mockSub),
  getSubscription: vi.fn(async (id: number) => (id === 1 ? mockSub : null)),
  getSubscriptionsByUser: vi.fn(async () => [mockSub]),
  getEnabledSubscriptions: vi.fn(async () => [mockSub]),
  updateSubscription: vi.fn(async () => {}),
  deleteSubscription: vi.fn(async () => {}),
}

const mockScheduler = {
  schedule: vi.fn(),
  remove: vi.fn(),
  has: vi.fn(() => false),
  listJobs: vi.fn((): Array<{ name: string; expression: string; nextRun: Date | null }> => []),
  stopAll: vi.fn(),
  nextRun: vi.fn(() => null),
}

const mockGenreService = {
  getLibraryGenres: vi.fn(async () => []),
  search: vi.fn(async () => []),
  getOrFetchGenre: vi.fn(async () => null),
  getSubGenres: vi.fn(async () => []),
  seedFromLibrary: vi.fn(async () => {}),
  slugify: vi.fn((name: string) => name.toLowerCase()),
  isStale: vi.fn(() => false),
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    db: { execute: vi.fn(async () => []) } as unknown as AppDependencies['db'],
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: makeMockOrchestrator() as unknown as AppDependencies['orchestrator'],
    scheduler: mockScheduler as unknown as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    isSetupComplete: async () => true,
    getSettings: vi.fn(
      async () =>
        ({
          id: 1,
          lidarrUrl: 'http://lidarr:8686',
          lidarrApiKey: 'key',
          preferences: {},
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
    // Auth: return user so userId is set to USER_ID
    getUserById: vi.fn(async (id: number) =>
      id === USER_ID
        ? {
            id: USER_ID,
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
          }
        : null,
    ),
    getUserCount: vi.fn(async () => 0),
    updatePassword: vi.fn(async () => {}),
    updateUserPreferredLocale: vi.fn(async () => {}),
    genreService: mockGenreService as unknown as AppDependencies['genreService'],
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
    subscriptionQueries: mockSubQueries as unknown as AppDependencies['subscriptionQueries'],
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

// Helper to make authenticated requests (injects userId via session simulation)
// Since auth middleware checks getUserCount() == 0 to skip auth, we keep it at 0
// so no token is needed and userId is undefined. For endpoints that need userId,
// we need a session. Instead we test the 401 paths (no auth) and ownership (403).
// For ownership tests, we need a way to set userId. We do this by patching
// the app to bypass auth (getUserCount returns 0) and set userId via a custom middleware.
// The cleanest approach is to use the existing session mechanism - but since sessions
// are in-memory we can't easily inject one in tests. Instead we wrap createApp
// with a pre-auth middleware that sets userId on the context.

import { Hono } from 'hono'
import { getOAuthToken } from '@/db/queries/oauth-tokens'
import { genreRoutes } from '@/server/routes/genres'
import { subscriptionRoutes } from '@/server/routes/subscriptions'

const mockGetOAuthToken = getOAuthToken as ReturnType<typeof vi.fn>

function createTestApp(deps: AppDependencies, userId: number | undefined) {
  const app = new Hono()
  // Inject userId before route handlers
  app.use('*', async (c, next) => {
    if (userId !== undefined) {
      c.set('userId' as never, userId as never)
    }
    return next()
  })
  app.route('/', genreRoutes(deps))
  app.route('/', subscriptionRoutes(deps))
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetOAuthToken.mockResolvedValue({
    userId: USER_ID,
    provider: 'spotify',
    accessToken: 'spotify-token',
    refreshToken: 'refresh-token',
    expiresAt: new Date('2026-05-01'),
    scopes: 'user-library-read',
    clientId: 'cid',
    clientSecret: 'secret',
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-01'),
  })
  mockSubQueries.createSubscription.mockResolvedValue(mockSub)
  mockSubQueries.getSubscription.mockImplementation(async (id: number) =>
    id === 1 ? mockSub : null,
  )
  mockSubQueries.getSubscriptionsByUser.mockResolvedValue([mockSub])
  mockSubQueries.getEnabledSubscriptions.mockResolvedValue([mockSub])
  mockSubQueries.updateSubscription.mockResolvedValue(undefined)
  mockSubQueries.deleteSubscription.mockResolvedValue(undefined)
  mockScheduler.schedule.mockReset()
  mockScheduler.remove.mockReset()
  mockScheduler.has.mockReturnValue(false)
  mockScheduler.listJobs.mockReturnValue([])
})

describe('GET /api/subscriptions', () => {
  it('returns subscriptions for authenticated user', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(mockSubQueries.getSubscriptionsByUser).toHaveBeenCalledWith(USER_ID)
  })

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const res = await app.request('/api/subscriptions')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/subscriptions', () => {
  const validBody = {
    name: 'Test Sub',
    sourceType: 'genre',
    sourceProvider: 'library',
    sourceConfig: { genreSlug: 'rock' },
    cron: '0 9 * * *',
  }

  it('creates a subscription with valid fields', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(201)
    expect(mockSubQueries.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Sub',
        userId: USER_ID,
        action: 'add_to_recommendations',
      }),
    )
  })

  for (const field of ['name', 'sourceType', 'sourceProvider', 'sourceConfig', 'cron'] as const) {
    it(`returns 400 when ${field} is missing`, async () => {
      const app = createTestApp(makeDeps(), USER_ID)
      const body = { ...validBody }
      delete (body as Record<string, unknown>)[field]
      const res = await app.request('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
    })
  }

  it('returns 400 for invalid cron expression', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, cron: 'not-a-cron' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const res = await app.request('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(401)
  })

  it('auto-schedules new subscription in scheduler', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(201)
    expect(mockScheduler.schedule).toHaveBeenCalledWith(
      `subscription-${mockSub.id}`,
      validBody.cron,
      expect.any(Function),
    )
  })
})

describe('POST /api/subscriptions/import/spotify-liked-songs', () => {
  it('creates a helper subscription on first import and starts a run', async () => {
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request('/api/subscriptions/import/spotify-liked-songs', {
      method: 'POST',
    })

    expect(res.status).toBe(202)
    expect(mockSubQueries.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        sourceType: 'spotify-liked-songs',
        sourceProvider: 'spotify',
        enabled: false,
      }),
    )
    expect(mockGetOAuthToken).toHaveBeenCalled()
  })

  it('reuses an existing helper subscription instead of creating duplicates', async () => {
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce([
      { ...mockSub, sourceType: 'spotify-liked-songs', sourceProvider: 'spotify' },
    ])

    const runSubscription = vi.fn(async () => {})
    const app = createTestApp(makeDeps({ runSubscription }), USER_ID)

    const res = await app.request('/api/subscriptions/import/spotify-liked-songs', {
      method: 'POST',
    })

    expect(res.status).toBe(202)
    expect(mockSubQueries.createSubscription).not.toHaveBeenCalled()
    expect(runSubscription).toHaveBeenCalledWith(1)
  })

  it('returns 400 when Spotify is not connected', async () => {
    mockGetOAuthToken.mockResolvedValueOnce(null)
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request('/api/subscriptions/import/spotify-liked-songs', {
      method: 'POST',
    })

    expect(res.status).toBe(400)
    expect(mockSubQueries.createSubscription).not.toHaveBeenCalled()
  })

  it('localizes spotify import errors', async () => {
    mockGetOAuthToken.mockResolvedValueOnce(null)
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request('/api/subscriptions/import/spotify-liked-songs', {
      method: 'POST',
      headers: {
        'X-Digarr-Locale': 'fr',
      },
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'Spotify n est pas connecte',
    })
  })
})

describe('PATCH /api/subscriptions/:id', () => {
  it('updates subscription when user owns it', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    })
    expect(res.status).toBe(200)
    expect(mockSubQueries.updateSubscription).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'Updated Name' }),
    )
  })

  it('returns 403 when user does not own subscription', async () => {
    const OTHER_USER = 99
    const app = createTestApp(makeDeps(), OTHER_USER)
    const res = await app.request('/api/subscriptions/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacked' }),
    })
    expect(res.status).toBe(403)
    expect(mockSubQueries.updateSubscription).not.toHaveBeenCalled()
  })

  it('returns 404 when subscription does not exist', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid cron in update', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron: 'bad-cron' }),
    })
    expect(res.status).toBe(400)
  })

  it('reschedules in scheduler when cron changes', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron: '0 12 * * 1' }),
    })
    expect(res.status).toBe(200)
    expect(mockScheduler.schedule).toHaveBeenCalledWith(
      'subscription-1',
      '0 12 * * 1',
      expect.any(Function),
    )
  })

  it('removes from scheduler when disabled via PATCH', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    expect(mockScheduler.remove).toHaveBeenCalledWith('subscription-1')
  })

  it('re-schedules when re-enabled via PATCH', async () => {
    mockSubQueries.getSubscription.mockResolvedValueOnce({ ...mockSub, enabled: false })
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(200)
    expect(mockScheduler.schedule).toHaveBeenCalledWith(
      'subscription-1',
      '0 9 * * *',
      expect.any(Function),
    )
  })

  it('rejects non-allowlisted fields on update (strict schema)', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ok', sourceType: 'evil', userId: 999 }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
    expect(mockSubQueries.updateSubscription).not.toHaveBeenCalled()
  })
})

describe('POST /api/subscriptions/bulk-toggle', () => {
  it('disables all user subscriptions and removes from scheduler', async () => {
    const subs = [mockSub, { ...mockSub, id: 2, name: 'Sub B', cron: '0 0 * * 1' }]
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce(subs)
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/bulk-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(2)
    expect(mockSubQueries.updateSubscription).toHaveBeenCalledTimes(2)
    expect(mockScheduler.remove).toHaveBeenCalledWith('subscription-1')
    expect(mockScheduler.remove).toHaveBeenCalledWith('subscription-2')
  })

  it('enables all user subscriptions and schedules them', async () => {
    const subs = [{ ...mockSub, enabled: false }]
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce(subs)
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/bulk-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(200)
    expect(mockScheduler.schedule).toHaveBeenCalledWith(
      'subscription-1',
      mockSub.cron,
      expect.any(Function),
    )
  })

  it('returns 400 when enabled is missing', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/bulk-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const res = await app.request('/api/subscriptions/bulk-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/subscriptions/scheduler', () => {
  it('returns scheduler job info', async () => {
    mockScheduler.listJobs.mockReturnValueOnce([
      { name: 'subscription-1', expression: '0 9 * * *', nextRun: new Date('2026-04-01') },
    ])
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/scheduler')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.jobs)).toBe(true)
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].name).toBe('subscription-1')
  })

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const res = await app.request('/api/subscriptions/scheduler')
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/subscriptions/:id', () => {
  it('deletes subscription and removes from scheduler', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(mockSubQueries.deleteSubscription).toHaveBeenCalledWith(1)
    expect(mockScheduler.remove).toHaveBeenCalledWith('subscription-1')
  })

  it('returns 403 when user does not own subscription', async () => {
    const app = createTestApp(makeDeps(), 99)
    const res = await app.request('/api/subscriptions/1', { method: 'DELETE' })
    expect(res.status).toBe(403)
    expect(mockSubQueries.deleteSubscription).not.toHaveBeenCalled()
  })

  it('returns 404 when subscription does not exist', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/999', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/subscriptions/:id/run', () => {
  it('triggers subscription run and returns 202', async () => {
    const runSubscription = vi.fn(async () => {})
    const app = createTestApp(makeDeps({ runSubscription }), USER_ID)
    const res = await app.request('/api/subscriptions/1/run', { method: 'POST' })
    expect(res.status).toBe(202)
  })

  it('returns 403 when user does not own subscription', async () => {
    const app = createTestApp(makeDeps(), 99)
    const res = await app.request('/api/subscriptions/1/run', { method: 'POST' })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/subscriptions/:id/runs', () => {
  it('returns run history for owned subscription', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/subscriptions/1/runs')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(deps.jobQueries.getJobsForSubscription).toHaveBeenCalledWith(1)
  })

  it('returns 403 for non-owner', async () => {
    const app = createTestApp(makeDeps(), 99)
    const res = await app.request('/api/subscriptions/1/runs')
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown subscription', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/999/runs')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/subscriptions/import/csv', () => {
  it('imports artists from a CSV file', async () => {
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce([])
    const app = createTestApp(makeDeps(), USER_ID)

    const formData = new FormData()
    formData.append(
      'file',
      new Blob(['artist\nRadiohead\nPortishead'], { type: 'text/csv' }),
      'artists.csv',
    )

    const res = await app.request('/api/subscriptions/import/csv', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.artistCount).toBe(2)
    expect(mockSubQueries.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        sourceType: 'csv-import',
        sourceProvider: 'csv',
      }),
    )
  })

  it('returns 400 when no file is uploaded', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/import/csv', {
      method: 'POST',
      body: new FormData(),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when CSV has no valid artists', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const formData = new FormData()
    formData.append('file', new Blob([''], { type: 'text/csv' }), 'empty.csv')

    const res = await app.request('/api/subscriptions/import/csv', {
      method: 'POST',
      body: formData,
    })
    expect(res.status).toBe(400)
  })

  it('returns 413 when file exceeds 1MB', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const formData = new FormData()
    const bigContent = 'a'.repeat(1_048_577) // 1MB + 1 byte
    formData.append('file', new Blob([bigContent], { type: 'text/csv' }), 'big.csv')

    const res = await app.request('/api/subscriptions/import/csv', {
      method: 'POST',
      body: formData,
    })
    expect(res.status).toBe(413)
  })

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp(makeDeps(), undefined)
    const formData = new FormData()
    formData.append('file', new Blob(['artist\nRadiohead'], { type: 'text/csv' }), 'a.csv')

    const res = await app.request('/api/subscriptions/import/csv', {
      method: 'POST',
      body: formData,
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/subscriptions/import/spotify-playlist', () => {
  beforeEach(() => {
    // Drain any leftover Once queue entries from earlier tests that don't consume them
    mockSubQueries.getSubscriptionsByUser.mockReset()
    mockSubQueries.getSubscriptionsByUser.mockResolvedValue([mockSub])
  })

  it('creates a subscription for a new playlist and starts a run', async () => {
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce([])
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request('/api/subscriptions/import/spotify-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: '37i9dQZEVXbMDoHDwVN2tF' }),
    })

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.created).toBe(true)
    expect(mockSubQueries.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        sourceType: 'spotify-playlist',
        sourceProvider: 'spotify',
        sourceConfig: { playlistId: '37i9dQZEVXbMDoHDwVN2tF' },
      }),
    )
  })

  it('reuses existing subscription for same playlist', async () => {
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce([
      {
        ...mockSub,
        sourceType: 'spotify-playlist',
        sourceProvider: 'spotify',
        sourceConfig: { playlistId: '37i9dQZEVXbMDoHDwVN2tF' },
      },
    ])
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request('/api/subscriptions/import/spotify-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: '37i9dQZEVXbMDoHDwVN2tF' }),
    })

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.created).toBe(false)
  })

  it('normalizes playlist URLs to bare IDs', async () => {
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce([])
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request('/api/subscriptions/import/spotify-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playlistId: 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF?si=abc',
      }),
    })

    expect(res.status).toBe(202)
    expect(mockSubQueries.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceConfig: { playlistId: '37i9dQZEVXbMDoHDwVN2tF' },
      }),
    )
  })

  it('returns 400 when playlistId is missing', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/subscriptions/import/spotify-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when Spotify is not connected', async () => {
    mockGetOAuthToken.mockResolvedValueOnce(null)
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request('/api/subscriptions/import/spotify-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: '37i9dQZEVXbMDoHDwVN2tF' }),
    })
    expect(res.status).toBe(400)
  })
})
