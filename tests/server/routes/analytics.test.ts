// @vitest-environment node

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createSession } from '@/core/sessions'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning: false,
    run: vi.fn(async () => ({ batchId: 1 })),
  })
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    db: {
      execute: vi.fn(async () => ({ rows: [] })),
    } as unknown as AppDependencies['db'],
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
      username: 'admin',
      isAdmin: true,
    })) as unknown as AppDependencies['getUserById'],
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

const SESSION_TOKEN = 'analytics-session-token'

async function authedRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  await createSession(1, SESSION_TOKEN)
  return app.request(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${SESSION_TOKEN}`,
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  })
}

describe('GET /api/analytics/overview', () => {
  it('returns 200 with expected shape on empty db', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ total_recs: 0, avg_score: 0, approved: 0, acted: 0 }],
      })
      .mockResolvedValueOnce({
        rows: [{ total: 0 }],
      })
    const app = createApp(makeDeps({ db: { execute } as unknown as AppDependencies['db'] }))
    const res = await authedRequest(app, '/api/analytics/overview')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      totalRecs: 0,
      approvalRate: 0,
      avgScore: 0,
      totalBatches: 0,
    })
  })

  it('calculates approval rate correctly', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ total_recs: 10, avg_score: 0.75, approved: 3, acted: 5 }],
      })
      .mockResolvedValueOnce({
        rows: [{ total: 2 }],
      })
    const app = createApp(makeDeps({ db: { execute } as unknown as AppDependencies['db'] }))
    const res = await authedRequest(app, '/api/analytics/overview')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalRecs).toBe(10)
    expect(body.approvalRate).toBeCloseTo(0.6)
    expect(body.avgScore).toBeCloseTo(0.75)
    expect(body.totalBatches).toBe(2)
  })
})

describe('GET /api/analytics/batches', () => {
  it('returns 200 with empty array on empty db', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/analytics/batches')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('returns batch data with counts', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          created_at: '2024-06-01T00:00:00Z',
          status: 'completed',
          stats: { discovered: 20, filtered: 5, added: 15, failed: 0 },
          total: 15,
          approved: 5,
          rejected: 3,
          pending: 7,
        },
      ],
    })
    const app = createApp(makeDeps({ db: { execute } as unknown as AppDependencies['db'] }))
    const res = await authedRequest(app, '/api/analytics/batches')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe(1)
    expect(body[0].approved).toBe(5)
    expect(body[0].rejected).toBe(3)
    expect(body[0].pending).toBe(7)
    expect(body[0].total).toBe(15)
  })
})

describe('GET /api/analytics/genres', () => {
  it('returns 200 with empty array on empty db', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/analytics/genres')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('returns genre stats with approval rate', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      rows: [
        { genre: 'rock', count: 10, approved: 4 },
        { genre: 'jazz', count: 5, approved: 3 },
      ],
    })
    const app = createApp(makeDeps({ db: { execute } as unknown as AppDependencies['db'] }))
    const res = await authedRequest(app, '/api/analytics/genres')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].genre).toBe('rock')
    expect(body[0].approvalRate).toBeCloseTo(0.4)
    expect(body[1].genre).toBe('jazz')
    expect(body[1].approvalRate).toBeCloseTo(0.6)
  })
})

describe('GET /api/analytics/sources', () => {
  it('returns 200 with empty array on empty db', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/analytics/sources')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('returns source stats with approval rate and avg score', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      rows: [
        { source: 'consensus', count: 8, avg_score: 0.82, approved: 5 },
        { source: 'similarity', count: 6, avg_score: 0.65, approved: 2 },
      ],
    })
    const app = createApp(makeDeps({ db: { execute } as unknown as AppDependencies['db'] }))
    const res = await authedRequest(app, '/api/analytics/sources')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].source).toBe('consensus')
    expect(body[0].approvalRate).toBeCloseTo(0.625)
    expect(body[0].avgScore).toBeCloseTo(0.82)
    expect(body[1].source).toBe('similarity')
    expect(body[1].approvalRate).toBeCloseTo(0.333, 2)
  })
})
