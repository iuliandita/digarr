// @vitest-environment node

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'

// Registration closed by default; override so future tests that register don't blow up.
vi.mock('@/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/config/env')>()
  return {
    ...original,
    envConfig: { ...original.envConfig, disableRegistration: false },
  }
})

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
    getUserById: vi.fn(async () => null),
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
  await clearAllSessions()
})

describe('GET /api/auth/status response shape', () => {
  it('never returns a raw session token', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/status')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('token')
  })

  it('never returns a proxyAuth field', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('proxyAuth')
  })

  it('exposes authenticated / hasUsers / required', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('authenticated')
    expect(body).toHaveProperty('hasUsers')
    expect(body).toHaveProperty('required')
  })

  it('authenticated=false and isAdmin=false for anonymous callers', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body.authenticated).toBe(false)
    expect(body.isAdmin).toBe(false)
    expect(body.userId).toBeUndefined()
  })

  it('anonymous response does NOT include version (fingerprint protection)', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('version')
  })

  it('anonymous response does NOT include proxyAuthEnabled (deployment topology)', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('proxyAuthEnabled')
  })

  it('anonymous response still includes oidcEnabled for login-screen UX', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/auth/status')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('oidcEnabled')
  })
})

describe('GET /api/auth/meta', () => {
  it('returns 401 for unauthenticated callers (non-degenerate state)', async () => {
    // Setup complete, users exist: auth is strictly required, 401 on miss.
    const app = createApp(
      makeDeps({
        isSetupComplete: async () => true,
        getUserCount: vi.fn(async () => 1),
      }),
    )
    const res = await app.request('/api/auth/meta')
    expect(res.status).toBe(401)
  })

  it('exposes version / proxyAuthEnabled / oidcEnabled to authenticated callers', async () => {
    // Seed a session directly - the module-level vi.mock on @/config/env
    // freezes envConfig.authToken at undefined, so the legacy-token path is
    // unreachable. Session auth bypasses that.
    const SESSION_TOKEN = 'session-token-for-meta-test-abc123'
    await createSession(1, SESSION_TOKEN)
    const app = createApp(
      makeDeps({
        isSetupComplete: async () => true,
        getUserCount: vi.fn(async () => 1),
      }),
    )
    const res = await app.request('/api/auth/meta', {
      headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('proxyAuthEnabled')
    expect(body).toHaveProperty('oidcEnabled')
  })
})

describe('authGuard degenerate state (setup complete + no users)', () => {
  it('returns 503 on auth-required endpoints', async () => {
    const app = createApp(
      makeDeps({
        isSetupComplete: async () => true,
        getUserCount: vi.fn(async () => 0),
      }),
    )
    // /api/auth/me is auth-required (not in PUBLIC_PATHS)
    const res = await app.request('/api/auth/me')
    expect(res.status).toBe(503)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ error: 're-run setup' })
  })
})
