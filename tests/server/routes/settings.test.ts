// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

const mockSettings = {
  id: 1,
  lidarrUrl: 'http://lidarr:8686',
  lidarrApiKey: 'secret-key',
  listenbrainzUsername: 'testuser',
  listenbrainzToken: 'lb-token',
  lastfmUsername: null,
  lastfmApiKey: null,
  aiProvider: 'ollama',
  aiApiKey: null,
  aiModel: 'llama3',
  aiBaseUrl: 'http://ollama:11434',
  preferences: null,
  setupComplete: true,
  createdAt: new Date('2024-01-01').toISOString(),
  updatedAt: new Date('2024-01-01').toISOString(),
}

function makeMockOrchestrator() {
  const { EventEmitter } = require('node:events')
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
    getSettings: vi.fn(async () => mockSettings as unknown as SettingsRow),
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
      discogsToken: null,
      discogsUsername: null,
      createdAt: new Date(),
    })),
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async () => ({
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
      discogsToken: null,
      discogsUsername: null,
      createdAt: new Date(),
    })),
    getUserCount: vi.fn(async () => 0),
    updatePassword: vi.fn(async () => {}),
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

describe('GET /api/settings', () => {
  it('returns settings with secrets masked', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/settings')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lidarrUrl).toBe('http://lidarr:8686')
    expect(body.lidarrApiKey).toBe('***')
    expect(body.listenbrainzToken).toBe('***')
    expect(body.aiApiKey).toBe('***')
  })

  it('masks null secret fields as *** too', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/settings')
    expect(res.status).toBe(200)
    const body = await res.json()
    // aiApiKey is null in mockSettings, still gets masked
    expect(body.aiApiKey).toBe('***')
    // lastfmApiKey is null too
    expect(body.lastfmApiKey).toBe('***')
  })

  it('returns 403 when setup not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/api/settings')
    expect(res.status).toBe(403)
  })

  it('returns 404 when no settings exist', async () => {
    const app = createApp(makeDeps({ getSettings: vi.fn(async () => null) }))
    const res = await app.request('/api/settings')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/settings', () => {
  it('calls updateSettings and returns updated settings', async () => {
    const updateSettings = vi.fn(async () => {})
    const updatedSettings = { ...mockSettings, lidarrUrl: 'http://new:8686' }
    const getSettings = vi.fn(async () => updatedSettings as unknown as SettingsRow)
    const app = createApp(makeDeps({ updateSettings, getSettings }))

    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lidarrUrl: 'http://new:8686' }),
    })
    expect(res.status).toBe(200)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.lidarrUrl).toBe('http://new:8686')
  })

  it('restarts scheduler when cron is updated', async () => {
    const restartScheduler = vi.fn()
    const app = createApp(makeDeps({ restartScheduler }))
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { scheduleCron: '0 3 * * *' } }),
    })
    expect(res.status).toBe(200)
    expect(restartScheduler).toHaveBeenCalledWith('0 3 * * *')
  })

  it('stops scheduler when cron is set to empty string', async () => {
    const restartScheduler = vi.fn()
    const app = createApp(makeDeps({ restartScheduler }))
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { scheduleCron: '' } }),
    })
    expect(res.status).toBe(200)
    expect(restartScheduler).toHaveBeenCalledWith(null)
  })

  it('returns warning when cron expression is invalid', async () => {
    const restartScheduler = vi.fn(() => {
      throw new TypeError('Invalid cron expression')
    })
    const app = createApp(makeDeps({ restartScheduler }))
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { scheduleCron: 'not a cron' } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warning).toBe('Settings saved but cron expression is invalid')
  })

  it('does not restart scheduler when preferences lack scheduleCron', async () => {
    const restartScheduler = vi.fn()
    const app = createApp(makeDeps({ restartScheduler }))
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { librarySeedRatio: 0.5 } }),
    })
    expect(res.status).toBe(200)
    expect(restartScheduler).not.toHaveBeenCalled()
  })

  it('restarts playlist scheduling when playlist preferences change', async () => {
    const restartPlaylistScheduler = vi.fn(async () => {})
    const app = createApp(makeDeps({ restartPlaylistScheduler }))
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { playlistEnabled: true } }),
    })
    expect(res.status).toBe(200)
    expect(restartPlaylistScheduler).toHaveBeenCalledOnce()
  })

  it('does not restart scheduler when no preferences in body', async () => {
    const restartScheduler = vi.fn()
    const app = createApp(makeDeps({ restartScheduler }))
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lidarrUrl: 'http://new:8686' }),
    })
    expect(res.status).toBe(200)
    expect(restartScheduler).not.toHaveBeenCalled()
  })

  it('returns 403 when setup not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lidarrUrl: 'http://new:8686' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/settings/test/:service', () => {
  it('tests lidarr and returns ServiceTestResult shape', async () => {
    const app = createApp(makeDeps())
    // Client will fail to connect but must return a ServiceTestResult (not throw)
    const res = await app.request('/api/settings/test/lidarr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://invalid-lidarr:9999', apiKey: 'key' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.success).toBe('boolean')
    expect(typeof body.message).toBe('string')
  })

  it('tests listenbrainz and returns ServiceTestResult shape', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/settings/test/listenbrainz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', token: 'token123' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.success).toBe('boolean')
    expect(typeof body.message).toBe('string')
  })

  it('tests lastfm and returns ServiceTestResult shape', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/settings/test/lastfm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', apiKey: 'lfmkey' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.success).toBe('boolean')
    expect(typeof body.message).toBe('string')
  })

  it('tests ai provider and returns ServiceTestResult shape', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/settings/test/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'ollama',
        apiKey: null,
        model: 'llama3',
        baseUrl: 'http://invalid:11434',
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.success).toBe('boolean')
    expect(typeof body.message).toBe('string')
  })

  it('returns 400 for unknown service', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/settings/test/unknown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('allows test endpoints even when setup not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/api/settings/test/lidarr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://lidarr:8686', apiKey: 'key' }),
    })
    // Test endpoints are exempted from setup guard so users can
    // verify connections during the setup wizard
    expect(res.status).toBe(200)
  })
})

describe('per-user listening source connections', () => {
  afterEach(async () => {
    await clearAllSessions()
  })

  it('GET returns global settings with no scope indicators when no user session', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/settings')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.listenbrainzUsername).toBe('testuser')
    expect(body._listenbrainzScope).toBeUndefined()
    expect(body._lastfmScope).toBeUndefined()
  })

  it('PATCH ignores user-scoped listening fields when no user session exists', async () => {
    const updateSettings = vi.fn(async () => {})
    const app = createApp(makeDeps({ updateSettings }))

    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listenbrainzUsername: 'global-lb',
        listenbrainzToken: 'global-token',
      }),
    })
    expect(res.status).toBe(200)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('PATCH excludes listenbrainz fields from global updateSettings when user is authenticated', async () => {
    await clearAllSessions()
    const sessionToken = 'patch-session-token-99'
    await createSession(99, sessionToken)

    const updateSettings = vi.fn(async () => {})
    // db needs update() for updateUserConnections and select() for getUserConnections (in PATCH response)
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    const dbWithUpdate = {
      execute: vi.fn(async () => []),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      })),
      select: vi.fn(() => selectChain),
    } as unknown as AppDependencies['db']

    const app = createApp(
      makeDeps({
        db: dbWithUpdate,
        updateSettings,
        getUserCount: vi.fn(async () => 1),
      }),
    )

    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        listenbrainzUsername: 'my-lb',
        listenbrainzToken: 'my-token',
        lidarrUrl: 'http://lidarr:8686',
      }),
    })
    expect(res.status).toBe(200)
    // lidarrUrl should go to global settings, listenbrainz fields should NOT
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ lidarrUrl: 'http://lidarr:8686' }),
    )
    expect(updateSettings).toHaveBeenCalledWith(
      expect.not.objectContaining({ listenbrainzUsername: expect.anything() }),
    )
    // db.update was called (listenbrainz fields routed to user record)
    expect(dbWithUpdate.update).toHaveBeenCalled()
  })

  it('PATCH excludes lastfm fields from global updateSettings when user is authenticated', async () => {
    await clearAllSessions()
    const sessionToken = 'patch-session-token-lfm'
    await createSession(42, sessionToken)

    const updateSettings = vi.fn(async () => {})
    const selectChain2 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    const dbWithUpdate = {
      execute: vi.fn(async () => []),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      })),
      select: vi.fn(() => selectChain2),
    } as unknown as AppDependencies['db']

    const app = createApp(
      makeDeps({
        db: dbWithUpdate,
        updateSettings,
        getUserCount: vi.fn(async () => 1),
      }),
    )

    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        lastfmUsername: 'my-lfm',
        lastfmApiKey: 'my-key',
      }),
    })
    expect(res.status).toBe(200)
    // Only user-connection fields sent -- global updateSettings should NOT be called
    expect(updateSettings).not.toHaveBeenCalled()
    // db.update was called (lastfm fields routed to user record)
    expect(dbWithUpdate.update).toHaveBeenCalled()
  })
})
