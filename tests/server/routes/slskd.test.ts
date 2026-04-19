// @vitest-environment node

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsRow } from '@/db/queries/settings'
import type { UserPublic } from '@/db/queries/users'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

vi.mock('@/core/sessions', () => ({
  getSession: vi.fn(async () => ({
    userId: 1,
    token: 'test-token',
    expiresAt: new Date(Date.now() + 86_400_000),
  })),
  setSessionStore: vi.fn(),
}))

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning: false,
    stage: null,
    stageMessage: null,
    run: vi.fn(async () => ({ batchId: 1 })),
  })
}

type SlskdAppDeps = AppDependencies & {
  slskdOrchestrator?: {
    isSyncing: boolean
    triggerSync: () => Promise<void>
    warmup: () => Promise<void>
    getActiveJobs: (limit?: number) => Promise<
      Array<{
        id: number
        targetId: number
        recommendationId: number | null
        state: string
        releaseTitle: string
      }>
    >
  }
}

function makeUser(overrides: Partial<UserPublic> = {}): UserPublic {
  return {
    id: 1,
    username: 'admin',
    isAdmin: true,
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
    ...overrides,
  }
}

function makeDeps(overrides: Partial<SlskdAppDeps> = {}): SlskdAppDeps {
  return {
    db: { execute: vi.fn(async () => []) } as unknown as AppDependencies['db'],
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: makeMockOrchestrator() as unknown as AppDependencies['orchestrator'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    isSetupComplete: async () => true,
    getSettings: vi.fn(
      async () =>
        ({
          id: 1,
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
    createUser: vi.fn(async () => makeUser()),
    getUserByUsername: vi.fn(async () => null),
    getUserById: async () => makeUser(),
    getUserCount: vi.fn(async () => 1),
    updatePassword: vi.fn(async () => {}),
    updateUserPreferredLocale: vi.fn(async () => {}),
    getOidcService: vi.fn(async () => null),
    getUserByOidcSubject: vi.fn(async () => null),
    getUserByEmail: vi.fn(async () => null),
    updateUser: vi.fn(async () => {}),
    listUsers: vi.fn(async () => []),
    deleteUser: vi.fn(async () => {}),
    genreService: {} as unknown as AppDependencies['genreService'],
    libraryHealth: {} as unknown as AppDependencies['libraryHealth'],
    skyhookWarmer: null,
    librarySync: {} as unknown as AppDependencies['librarySync'],
    librarySyncStore: {} as unknown as AppDependencies['librarySyncStore'],
    subscriptionQueries: {
      createSubscription: vi.fn(async () => ({}) as never),
      getSubscription: vi.fn(async () => null),
      getSubscriptionsByUser: vi.fn(async () => []),
      getEnabledSubscriptions: vi.fn(async () => []),
      updateSubscription: vi.fn(async () => {}),
      deleteSubscription: vi.fn(async () => {}),
    },
    runSubscription: vi.fn(async () => {}),
    targetQueries: {
      createTarget: vi.fn().mockResolvedValue({ id: 1 }),
      getTargetsByUser: vi.fn().mockResolvedValue([]),
      getAllTargets: vi.fn().mockResolvedValue([]),
      getTarget: vi.fn().mockResolvedValue(null),
      updateTarget: vi.fn().mockResolvedValue(undefined),
      deleteTarget: vi.fn().mockResolvedValue(undefined),
    },
    testTargetConnection: vi.fn(async () => ({ success: true, message: 'ok' })),
    getEnabledTargetsForUser: vi.fn(async () => []),
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
    slskdOrchestrator: {
      isSyncing: false,
      triggerSync: vi.fn(async () => {}),
      warmup: vi.fn(async () => {}),
      getActiveJobs: vi.fn(async () => []),
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/slskd/sync', () => {
  it('returns 202 and triggers a background sync', async () => {
    const slskdOrchestrator = {
      isSyncing: false,
      triggerSync: vi.fn(async () => {}),
      warmup: vi.fn(async () => {}),
      getActiveJobs: vi.fn(async () => []),
    }
    const app = createApp(makeDeps({ slskdOrchestrator }))

    const res = await app.request('/api/v1/slskd/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
    expect(slskdOrchestrator.triggerSync).toHaveBeenCalledTimes(1)
  })

  it('acknowledges immediately instead of waiting for the full sync run', async () => {
    let releaseSync!: () => void
    const slskdOrchestrator = {
      isSyncing: false,
      triggerSync: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseSync = resolve
          }),
      ),
      warmup: vi.fn(async () => {}),
      getActiveJobs: vi.fn(async () => []),
    }
    const app = createApp(makeDeps({ slskdOrchestrator }))

    const responsePromise = Promise.resolve(
      app.request('/api/v1/slskd/sync', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )

    const winner = await Promise.race([
      responsePromise.then(() => 'response'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ])

    expect(winner).toBe('response')
    releaseSync()
    const res = await responsePromise
    expect(res.status).toBe(202)
  })

  it('returns 403 for non-admin users', async () => {
    const slskdOrchestrator = {
      isSyncing: false,
      triggerSync: vi.fn(async () => {}),
      warmup: vi.fn(async () => {}),
      getActiveJobs: vi.fn(async () => []),
    }
    const app = createApp(
      makeDeps({
        slskdOrchestrator,
        getUserById: async () => makeUser({ isAdmin: false }),
      }),
    )

    const res = await app.request('/api/v1/slskd/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(res.status).toBe(403)
    expect(slskdOrchestrator.triggerSync).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/slskd/jobs', () => {
  it('returns sync status and active jobs for admins', async () => {
    const getActiveJobs = vi.fn(async () => [
      {
        id: 101,
        targetId: 7,
        recommendationId: 40,
        state: 'downloading',
        releaseTitle: 'Geogaddi',
      },
    ])
    const slskdOrchestrator = {
      isSyncing: true,
      triggerSync: vi.fn(async () => {}),
      warmup: vi.fn(async () => {}),
      getActiveJobs,
    }
    const app = createApp(makeDeps({ slskdOrchestrator }))

    const res = await app.request('/api/v1/slskd/jobs?limit=25', {
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      syncing: true,
      jobs: [
        {
          id: 101,
          targetId: 7,
          recommendationId: 40,
          state: 'downloading',
          releaseTitle: 'Geogaddi',
        },
      ],
    })
    expect(getActiveJobs).toHaveBeenCalledWith(25)
  })

  it('returns 403 for non-admin users', async () => {
    const getActiveJobs = vi.fn(async () => [])
    const slskdOrchestrator = {
      isSyncing: false,
      triggerSync: vi.fn(async () => {}),
      warmup: vi.fn(async () => {}),
      getActiveJobs,
    }
    const app = createApp(
      makeDeps({
        slskdOrchestrator,
        getUserById: async () => makeUser({ isAdmin: false }),
      }),
    )

    const res = await app.request('/api/v1/slskd/jobs', {
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(res.status).toBe(403)
    expect(getActiveJobs).not.toHaveBeenCalled()
  })
})
