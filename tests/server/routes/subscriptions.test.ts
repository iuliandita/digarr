// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { makeDeps as makeSharedDeps } from '../../helpers/test-app'

vi.mock('@/db/queries/oauth-tokens', () => ({
  getOAuthToken: vi.fn(),
}))

const validBody = {
  name: 'Test Sub',
  sourceType: 'genre',
  sourceProvider: 'library',
  sourceConfig: { genreSlug: 'rock' },
  cron: '0 9 * * *',
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
}

function json(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return makeSharedDeps({
    storeDb: {} as unknown as AppDependencies['storeDb'],
    scheduler: mockScheduler as unknown as AppDependencies['scheduler'],
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
        ? {
            id: USER_ID,
            username: 'testuser',
            isAdmin: false,
            preferences: null,
            preferredLocale: null,
          }
        : null,
    ) as unknown as AppDependencies['getUserById'],
    getUserCount: vi.fn(async () => 0),
    genreService: mockGenreService as unknown as AppDependencies['genreService'],
    subscriptionQueries: mockSubQueries as unknown as AppDependencies['subscriptionQueries'],
    runSubscription: vi.fn(async () => {}),
    ...overrides,
  })
}

import { Hono } from 'hono'
import { getOAuthToken } from '@/db/queries/oauth-tokens'
import { genreRoutes } from '@/server/routes/genres'
import { subscriptionRoutes } from '@/server/routes/subscriptions'

const mockGetOAuthToken = getOAuthToken as ReturnType<typeof vi.fn>

function createTestApp(deps: AppDependencies, userId: number | undefined) {
  const app = new Hono()
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

describe('GET /api/v1/subscriptions', () => {
  it('returns subscriptions for authenticated user', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(mockSubQueries.getSubscriptionsByUser).toHaveBeenCalledWith(USER_ID)
  })

  it('returns {data, meta} envelope when limit is sent', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      ...mockSub,
      id: i + 1,
      createdAt: new Date(Date.UTC(2026, 0, 20 - i)),
    }))
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce(rows)
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions?limit=10')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('data')
    expect(body).toHaveProperty('meta.limit', 10)
    expect(body.data).toHaveLength(10)
    expect(typeof body.meta.nextCursor).toBe('string')
  })

  it('returns nextCursor=null when result set fits within limit', async () => {
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce([mockSub])
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions?limit=10')
    const body = await res.json()
    expect(body.meta.nextCursor).toBeNull()
    expect(body.data).toHaveLength(1)
  })
})

describe('POST /api/v1/subscriptions', () => {
  it('creates a subscription with valid fields', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions', json(validBody))
    expect(res.status).toBe(201)
    expect(mockSubQueries.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Sub',
        userId: USER_ID,
        action: 'add_to_recommendations',
      }),
    )
    expect(mockScheduler.schedule).toHaveBeenCalledWith(
      `subscription-${mockSub.id}`,
      validBody.cron,
      expect.any(Function),
    )
  })

  it.each(['name', 'sourceType', 'sourceProvider', 'sourceConfig', 'cron'] as const)(
    'returns 400 when %s is missing',
    async (field) => {
      const app = createTestApp(makeDeps(), USER_ID)
      const body = { ...validBody }
      delete (body as Record<string, unknown>)[field]
      const res = await app.request('/api/v1/subscriptions', json(body))
      expect(res.status).toBe(400)
    },
  )

  it('returns 400 for invalid cron expression', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request(
      '/api/v1/subscriptions',
      json({ ...validBody, cron: 'not-a-cron' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/subscriptions/import/spotify-liked-songs', () => {
  it('creates a helper subscription on first import and starts a run', async () => {
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request('/api/v1/subscriptions/import/spotify-liked-songs', {
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

    const res = await app.request('/api/v1/subscriptions/import/spotify-liked-songs', {
      method: 'POST',
    })

    expect(res.status).toBe(202)
    expect(mockSubQueries.createSubscription).not.toHaveBeenCalled()
    expect(runSubscription).toHaveBeenCalledWith(1)
  })

  it.each([null, { accessToken: 'pending:1:abc' }])(
    'rejects unusable Spotify liked-song credentials: %j',
    async (credential) => {
      mockGetOAuthToken.mockResolvedValueOnce(credential)
      const app = createTestApp(makeDeps(), USER_ID)
      const res = await app.request('/api/v1/subscriptions/import/spotify-liked-songs', {
        method: 'POST',
      })
      expect(res.status).toBe(400)
      expect(mockSubQueries.createSubscription).not.toHaveBeenCalled()
    },
  )

  it('localizes spotify import errors', async () => {
    mockGetOAuthToken.mockResolvedValueOnce(null)
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request('/api/v1/subscriptions/import/spotify-liked-songs', {
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

describe('PATCH /api/v1/subscriptions/:id', () => {
  it('updates subscription when user owns it', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request(
      '/api/v1/subscriptions/1',
      json({ name: 'Updated Name' }, 'PATCH'),
    )
    expect(res.status).toBe(204)
    expect(mockSubQueries.updateSubscription).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: 'Updated Name' }),
    )
  })

  it('hides cross-user subscription with 404', async () => {
    const OTHER_USER = 99
    const app = createTestApp(makeDeps(), OTHER_USER)
    const res = await app.request('/api/v1/subscriptions/1', json({ name: 'Hacked' }, 'PATCH'))
    expect(res.status).toBe(404)
    expect(mockSubQueries.updateSubscription).not.toHaveBeenCalled()
  })

  it('returns 404 when subscription does not exist', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/999', json({ name: 'x' }, 'PATCH'))
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid cron in update', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/1', json({ cron: 'bad-cron' }, 'PATCH'))
    expect(res.status).toBe(400)
  })

  it('reschedules in scheduler when cron changes', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/1', json({ cron: '0 12 * * 1' }, 'PATCH'))
    expect(res.status).toBe(204)
    expect(mockScheduler.schedule).toHaveBeenCalledWith(
      'subscription-1',
      '0 12 * * 1',
      expect.any(Function),
    )
  })

  it('removes from scheduler when disabled via PATCH', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/1', json({ enabled: false }, 'PATCH'))
    expect(res.status).toBe(204)
    expect(mockScheduler.remove).toHaveBeenCalledWith('subscription-1')
  })

  it('re-schedules when re-enabled via PATCH', async () => {
    mockSubQueries.getSubscription.mockResolvedValueOnce({ ...mockSub, enabled: false })
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/1', json({ enabled: true }, 'PATCH'))
    expect(res.status).toBe(204)
    expect(mockScheduler.schedule).toHaveBeenCalledWith(
      'subscription-1',
      '0 9 * * *',
      expect.any(Function),
    )
  })

  it('rejects non-allowlisted fields on update (strict schema)', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request(
      '/api/v1/subscriptions/1',
      json({ name: 'ok', sourceType: 'evil', userId: 999 }, 'PATCH'),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
    expect(mockSubQueries.updateSubscription).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/subscriptions/bulk-toggle', () => {
  it('disables all user subscriptions and removes from scheduler', async () => {
    const subs = [mockSub, { ...mockSub, id: 2, name: 'Sub B', cron: '0 0 * * 1' }]
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce(subs)
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/bulk-toggle', json({ enabled: false }))
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
    const res = await app.request('/api/v1/subscriptions/bulk-toggle', json({ enabled: true }))
    expect(res.status).toBe(200)
    expect(mockScheduler.schedule).toHaveBeenCalledWith(
      'subscription-1',
      mockSub.cron,
      expect.any(Function),
    )
  })

  it('returns 400 when enabled is missing', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/bulk-toggle', json({}))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/subscriptions/scheduler', () => {
  it('filters out jobs belonging to other users', async () => {
    mockScheduler.listJobs.mockReturnValueOnce([
      { name: 'subscription-1', expression: '0 9 * * *', nextRun: new Date('2026-04-01') },
      { name: 'subscription-2', expression: '0 10 * * *', nextRun: new Date('2026-04-02') },
      { name: 'subscription-99', expression: '0 11 * * *', nextRun: new Date('2026-04-03') },
    ])
    // User 42 owns subscription 1 only (mockSub.id = 1)
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/scheduler')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.jobs)).toBe(true)
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].name).toBe('subscription-1')
  })
})

describe('DELETE /api/v1/subscriptions/:id', () => {
  it('deletes subscription and removes from scheduler', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/1', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(mockSubQueries.deleteSubscription).toHaveBeenCalledWith(1)
    expect(mockScheduler.remove).toHaveBeenCalledWith('subscription-1')
  })

  it('hides cross-user subscription with 404', async () => {
    const app = createTestApp(makeDeps(), 99)
    const res = await app.request('/api/v1/subscriptions/1', { method: 'DELETE' })
    expect(res.status).toBe(404)
    expect(mockSubQueries.deleteSubscription).not.toHaveBeenCalled()
  })

  it('returns the same hidden 404 body for missing and cross-user subscriptions', async () => {
    const missing = await createTestApp(makeDeps(), USER_ID).request('/api/v1/subscriptions/999', {
      method: 'DELETE',
    })
    const crossUser = await createTestApp(makeDeps(), 99).request('/api/v1/subscriptions/1', {
      method: 'DELETE',
    })

    expect(missing.status).toBe(404)
    expect(crossUser.status).toBe(404)
    expect(missing.headers.get('content-type')).toContain('application/problem+json')
    expect(crossUser.headers.get('content-type')).toContain('application/problem+json')
    expect(await crossUser.text()).toBe(await missing.text())
  })
})

describe('POST /api/v1/subscriptions/:id/run', () => {
  it('triggers subscription run and returns 202', async () => {
    const runSubscription = vi.fn(async () => {})
    const app = createTestApp(makeDeps({ runSubscription }), USER_ID)
    const res = await app.request('/api/v1/subscriptions/1/run', { method: 'POST' })
    expect(res.status).toBe(202)
  })

  it.each(['No Deezer OAuth token - connect Deezer in Settings', 'HTTP 401', 'HTTP 503'])(
    'reports a Deezer source failure without expiring the app session: %s',
    async (message) => {
      mockSubQueries.getSubscription.mockResolvedValueOnce({ ...mockSub, sourceType: 'deezer' })
      const runSubscription = vi.fn().mockRejectedValue(new Error(message))
      const app = createTestApp(makeDeps({ runSubscription }), USER_ID)
      const res = await app.request('/api/v1/subscriptions/1/run', { method: 'POST' })
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({
        error:
          'Deezer request failed. Check your Deezer connection in Settings and reconnect if needed.',
        service: 'deezer',
        retryable: true,
      })
    },
  )

  it('hides cross-user subscription with 404', async () => {
    const app = createTestApp(makeDeps(), 99)
    const res = await app.request('/api/v1/subscriptions/1/run', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/subscriptions/:id/runs', () => {
  it('returns run history for owned subscription', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/subscriptions/1/runs')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(deps.jobQueries.getJobsForSubscription).toHaveBeenCalledWith(1)
  })

  it('hides cross-user subscription with 404', async () => {
    const app = createTestApp(makeDeps(), 99)
    const res = await app.request('/api/v1/subscriptions/1/runs')
    expect(res.status).toBe(404)
  })

  it('returns 404 for unknown subscription', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/999/runs')
    expect(res.status).toBe(404)
  })

  it('rejects fractional ids before querying run history', async () => {
    const deps = makeDeps()
    const app = createTestApp(deps, USER_ID)
    const res = await app.request('/api/v1/subscriptions/1.5/runs')
    expect(res.status).toBe(400)
    expect(deps.subscriptionQueries.getSubscription).not.toHaveBeenCalled()
    expect(deps.jobQueries.getJobsForSubscription).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/subscriptions/import/csv', () => {
  it('imports artists from a CSV file', async () => {
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce([])
    const app = createTestApp(makeDeps(), USER_ID)

    const formData = new FormData()
    formData.append(
      'file',
      new Blob(['artist\nRadiohead\nPortishead'], { type: 'text/csv' }),
      'artists.csv',
    )

    const res = await app.request('/api/v1/subscriptions/import/csv', {
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
    const res = await app.request('/api/v1/subscriptions/import/csv', {
      method: 'POST',
      body: new FormData(),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when CSV has no valid artists', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const formData = new FormData()
    formData.append('file', new Blob([''], { type: 'text/csv' }), 'empty.csv')

    const res = await app.request('/api/v1/subscriptions/import/csv', {
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

    const res = await app.request('/api/v1/subscriptions/import/csv', {
      method: 'POST',
      body: formData,
    })
    expect(res.status).toBe(413)
  })

  it('imports an M3U playlist and reports unreadable entries', async () => {
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce([])
    const app = createTestApp(makeDeps(), USER_ID)

    const formData = new FormData()
    formData.append(
      'file',
      new Blob(['#EXTM3U\n#EXTINF:1,Radiohead - Karma Police\na.mp3\nmystery.mp3\n'], {
        type: 'audio/x-mpegurl',
      }),
      'mix.m3u8',
    )

    const res = await app.request('/api/v1/subscriptions/import/csv', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.artistCount).toBe(1)
    expect(body.unreadable).toBe(1)
    expect(mockSubQueries.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ sourceConfig: { artists: ['Radiohead'] } }),
    )
  })

  it('returns 400 for a malformed XSPF file', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const formData = new FormData()
    formData.append(
      'file',
      new Blob(['<playlist><trackList><track><creator>X</creator></trackList>'], {
        type: 'application/xspf+xml',
      }),
      'broken.xspf',
    )

    const res = await app.request('/api/v1/subscriptions/import/csv', {
      method: 'POST',
      body: formData,
    })
    expect(res.status).toBe(400)
    expect(mockSubQueries.createSubscription).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/subscriptions/import/spotify-playlist', () => {
  beforeEach(() => {
    // Drain any leftover Once queue entries from earlier tests that don't consume them
    mockSubQueries.getSubscriptionsByUser.mockReset()
    mockSubQueries.getSubscriptionsByUser.mockResolvedValue([mockSub])
  })

  it('creates a subscription for a new playlist and starts a run', async () => {
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce([])
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request(
      '/api/v1/subscriptions/import/spotify-playlist',
      json({ playlistId: '37i9dQZEVXbMDoHDwVN2tF' }),
    )

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.created).toBe(true)
    expect(mockSubQueries.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        sourceType: 'spotify-playlist',
        sourceProvider: 'spotify',
        sourceConfig: { playlistId: '37i9dQZEVXbMDoHDwVN2tF' },
        maxArtistsPerRun: 100,
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

    const res = await app.request(
      '/api/v1/subscriptions/import/spotify-playlist',
      json({ playlistId: '37i9dQZEVXbMDoHDwVN2tF' }),
    )

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.created).toBe(false)
  })

  it('normalizes playlist URLs to bare IDs', async () => {
    mockSubQueries.getSubscriptionsByUser.mockResolvedValueOnce([])
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request(
      '/api/v1/subscriptions/import/spotify-playlist',
      json({
        playlistId: 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF?si=abc',
      }),
    )

    expect(res.status).toBe(202)
    expect(mockSubQueries.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceConfig: { playlistId: '37i9dQZEVXbMDoHDwVN2tF' },
      }),
    )
  })

  it('returns 400 when playlistId is missing', async () => {
    const app = createTestApp(makeDeps(), USER_ID)
    const res = await app.request('/api/v1/subscriptions/import/spotify-playlist', json({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when Spotify is not connected', async () => {
    mockGetOAuthToken.mockResolvedValueOnce(null)
    const app = createTestApp(makeDeps(), USER_ID)

    const res = await app.request('/api/v1/subscriptions/import/spotify-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: '37i9dQZEVXbMDoHDwVN2tF' }),
    })
    expect(res.status).toBe(400)
  })
})

it.each([
  { method: 'GET', path: '/api/v1/subscriptions', body: undefined },
  { method: 'POST', path: '/api/v1/subscriptions', body: validBody },
  { method: 'POST', path: '/api/v1/subscriptions/bulk-toggle', body: { enabled: false } },
  { method: 'GET', path: '/api/v1/subscriptions/scheduler', body: undefined },
  { method: 'POST', path: '/api/v1/subscriptions/import/csv', body: 'csv' },
])('rejects anonymous $method $path', async ({ method, path, body }) => {
  const app = createTestApp(makeDeps(), undefined)
  let init: RequestInit = { method }
  if (body === 'csv') {
    const form = new FormData()
    form.append('file', new Blob(['artist\nRadiohead'], { type: 'text/csv' }), 'a.csv')
    init = { method, body: form }
  } else if (body !== undefined) init = json(body, method)
  const res = await app.request(path, init)
  expect(res.status).toBe(401)
})
