import { EventEmitter } from 'node:events'
import { vi } from 'vitest'
import { type AppDependencies, createApp } from '@/server'

export function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    db: { execute: vi.fn(async () => []) } as unknown as AppDependencies['db'],
    storeDb: {
      getExistingRecommendationMbids: vi.fn(async () => new Set()),
      insertBatch: vi.fn(async () => ({ id: 1 })),
      completeBatch: vi.fn(),
      upsertArtist: vi.fn(async () => ({ id: 1 })),
      insertRecommendation: vi.fn(),
      getRejectedMbids: vi.fn(async () => new Set()),
      getFeedbackHistory: vi.fn(async () => new Map()),
    } as unknown as AppDependencies['storeDb'],
    orchestrator: Object.assign(new EventEmitter(), {
      isRunning: false,
      run: vi.fn(async () => ({ batchId: 1 })),
      stage: null,
      stageMessage: null,
      currentUserId: undefined,
    }) as unknown as AppDependencies['orchestrator'],
    scheduler: {
      nextRun: vi.fn(() => null),
      schedule: vi.fn(),
      remove: vi.fn(),
    } as unknown as AppDependencies['scheduler'],
    providerRegistry: { create: vi.fn() } as unknown as AppDependencies['providerRegistry'],
    isSetupComplete: vi.fn(async () => true),
    getSettings: vi.fn(
      async () =>
        ({ id: 1, setupComplete: true }) as unknown as Awaited<
          ReturnType<AppDependencies['getSettings']>
        >,
    ),
    updateSettings: vi.fn(),
    completeSetup: vi.fn(),
    getLastBatch: vi.fn(async () => null),
    listRecommendations: vi.fn(async () => ({ items: [], total: 0 })),
    getRecommendation: vi.fn(async () => null),
    updateRecommendationStatus: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    filterOwnedIds: vi.fn(async (ids: number[]) => ids),
    listBatches: vi.fn(async () => []),
    getBatch: vi.fn(async () => null),
    getArtistById: vi.fn(async () => null),
    restartScheduler: vi.fn(),
    restartPlaylistScheduler: vi.fn(async () => {}),
    createUser: vi.fn(async (data) => ({
      id: 1,
      username: data.username,
      isAdmin: data.isAdmin ?? false,
    })) as unknown as AppDependencies['createUser'],
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async () => ({
      id: 1,
      username: 'admin',
      isAdmin: true,
    })) as unknown as AppDependencies['getUserById'],
    getUserCount: vi.fn(async () => 1),
    updatePassword: vi.fn(),
    getOidcService: vi.fn(async () => null),
    getUserByOidcSubject: vi.fn(async () => null),
    getUserByEmail: vi.fn(async () => null),
    updateUser: vi.fn(),
    listUsers: vi.fn(async () => []),
    deleteUser: vi.fn(),
    genreService: {} as unknown as AppDependencies['genreService'],
    libraryHealth: {} as unknown as AppDependencies['libraryHealth'],
    subscriptionQueries: {
      createSubscription: vi.fn(
        async (data) =>
          ({ id: 1, ...data }) as unknown as Awaited<
            ReturnType<AppDependencies['subscriptionQueries']['createSubscription']>
          >,
      ),
      getSubscription: vi.fn(async () => null),
      getSubscriptionsByUser: vi.fn(async () => []),
      getEnabledSubscriptions: vi.fn(async () => []),
      updateSubscription: vi.fn(),
      deleteSubscription: vi.fn(),
    },
    runSubscription: vi.fn(),
    targetQueries: {
      createTarget: vi.fn(async () => ({ id: 1 })),
      getTargetsByUser: vi.fn(async () => []),
      getAllTargets: vi.fn(async () => []),
      getTarget: vi.fn(async () => null),
      updateTarget: vi.fn(),
      deleteTarget: vi.fn(),
    },
    testTargetConnection: vi.fn(async () => ({ success: true, message: 'OK' })),
    getEnabledTargetsForUser: vi.fn(async () => []),
    getFeedbackHistory: vi.fn(async () => new Map()),
    dashboardQueries: {
      getTopGenresForUser: vi.fn(async () => []),
      getRecentActivity: vi.fn(async () => []),
    },
    jobRecorder: {
      start: vi.fn(async () => 1),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      markStuck: vi.fn(async () => 0),
    } as unknown as AppDependencies['jobRecorder'],
    jobQueries: {
      listJobs: vi.fn(async () => ({ items: [], total: 0 })),
      getJobById: vi.fn(async () => null),
      getJobHealth: vi.fn(async () => ({
        pipeline: { status: 'ok', lastRun: null, nextRun: null },
        subscriptions: { status: 'ok', healthy: 0, total: 0 },
        playlists: { status: 'ok', lastRun: null },
        sources: {},
      })),
      getJobsForSubscription: vi.fn(async () => []),
    },
    ...overrides,
  }
}

export function createTestApp(overrides?: Partial<AppDependencies>) {
  const deps = makeDeps(overrides)
  const app = createApp(deps)
  return { app, deps }
}
