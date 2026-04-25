// @vitest-environment node
import { lookup } from 'node:dns/promises'
import { describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import type { SettingsRow } from '@/db/queries/settings'
import type { UserConnections } from '@/db/queries/users'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

const { mockGetUserConnections, mockUpdateUserConnections } = vi.hoisted(() => ({
  mockGetUserConnections: vi.fn(async () => ({
    listenbrainzUsername: null as string | null,
    listenbrainzToken: null as string | null,
    lastfmUsername: null as string | null,
    lastfmApiKey: null as string | null,
    plexUrl: null as string | null,
    plexToken: null as string | null,
    jellyfinUrl: null as string | null,
    jellyfinApiKey: null as string | null,
    jellyfinUserId: null as string | null,
    embyUrl: null as string | null,
    embyApiKey: null as string | null,
    embyUserId: null as string | null,
    discogsToken: null as string | null,
    discogsUsername: null as string | null,
  })),
  mockUpdateUserConnections: vi.fn(async () => {}),
}))

const { mockCreateEmbyClient } = vi.hoisted(() => ({
  mockCreateEmbyClient: vi.fn(() => ({
    testConnection: vi.fn(async () => ({
      success: true,
      message: 'Connected to Emby',
    })),
  })),
}))

const { mockOidcTestConnection } = vi.hoisted(() => ({
  mockOidcTestConnection: vi.fn(async () => ({
    success: true,
    message: 'OIDC discovery successful',
  })),
}))

vi.mock('@/db/queries/users', async () => {
  const actual = await vi.importActual<typeof import('@/db/queries/users')>('@/db/queries/users')
  return {
    ...actual,
    getUserConnections: mockGetUserConnections,
    updateUserConnections: mockUpdateUserConnections,
  }
})

// The real ListenBrainz and Last.fm clients hit public APIs when testConnection()
// is called. Those network round-trips collide with vitest's 5s default timeout
// once the http client's retry backoff kicks in, making these tests flaky in CI.
// Stub both client factories so the settings test route tests stay hermetic.
vi.mock('@/core/clients/listenbrainz', () => ({
  createListenBrainzClient: vi.fn(() => ({
    getTopArtists: vi.fn(async () => []),
    getListenCount: vi.fn(async () => 0),
    getListeningActivity: vi.fn(async () => []),
    getSimilarArtists: vi.fn(async () => []),
    testConnection: vi.fn(async () => ({
      success: true,
      message: 'Connected to ListenBrainz - 0 listens for testuser',
      details: { listenCount: 0 },
    })),
  })),
}))

vi.mock('@/core/clients/lastfm', () => ({
  createLastFmClient: vi.fn(() => ({
    getTopArtists: vi.fn(async () => []),
    getRecentTracks: vi.fn(async () => []),
    testConnection: vi.fn(async () => ({
      success: true,
      message: 'Connected to Last.fm as testuser',
    })),
  })),
}))

vi.mock('@/core/clients/emby', () => ({
  createEmbyClient: mockCreateEmbyClient,
}))

vi.mock('@/core/auth/oidc', () => ({
  OidcService: class OidcService {
    testConnection = mockOidcTestConnection
  },
}))

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

const defaultUserConnections: UserConnections = {
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
    rejectRecommendation: vi.fn(async () => 1),
    listArtistBlocks: vi.fn(async () => ({ items: [], nextCursor: null })),
    removeArtistBlock: vi.fn(async () => true),
    addArtistBlock: vi.fn(async () => {}),
    bulkUpdateStatus: vi.fn(async () => {}),
    filterOwnedIds: vi.fn(async (ids: number[]) => ids),
    listBatches: vi.fn(async () => []),
    getBatch: vi.fn(async () => null),
    getArtistById: vi.fn(async () => null),
    restartScheduler: vi.fn(),
    restartPlaylistScheduler: vi.fn(),
    restartLibraryMaintenanceScheduler: vi.fn(),
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

const SESSION_TOKEN = 'settings-session-token'

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

describe('GET /api/v1/settings', () => {
  it('returns settings with secrets masked', async () => {
    mockGetUserConnections.mockResolvedValueOnce({
      ...defaultUserConnections,
      listenbrainzUsername: 'testuser',
      listenbrainzToken: 'lb-token',
    })
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/settings')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lidarrUrl).toBe('http://lidarr:8686')
    expect(body.lidarrApiKey).toBe('***')
    expect(body.listenbrainzToken).toBe('***')
    expect(body.aiApiKey).toBeNull()
  })

  it('preserves null secret fields instead of pretending they were saved', async () => {
    mockGetUserConnections.mockResolvedValueOnce(defaultUserConnections)
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/settings')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.aiApiKey).toBeNull()
    expect(body.lastfmApiKey).toBeNull()
  })

  it('returns 403 when setup not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/api/v1/settings')
    expect(res.status).toBe(403)
  })

  it('returns 404 when no settings exist', async () => {
    const app = createApp(makeDeps({ getSettings: vi.fn(async () => null) }))
    const res = await authedRequest(app, '/api/v1/settings')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/settings', () => {
  it('calls updateSettings and returns updated settings', async () => {
    const updateSettings = vi.fn(async () => {})
    const updatedSettings = { ...mockSettings, lidarrUrl: 'http://new:8686' }
    const getSettings = vi.fn(async () => updatedSettings as unknown as SettingsRow)
    const app = createApp(makeDeps({ updateSettings, getSettings }))

    const res = await authedRequest(app, '/api/v1/settings', {
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
    const res = await authedRequest(app, '/api/v1/settings', {
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
    const res = await authedRequest(app, '/api/v1/settings', {
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
    const res = await authedRequest(app, '/api/v1/settings', {
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
    const res = await authedRequest(app, '/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { librarySeedRatio: 0.5 } }),
    })
    expect(res.status).toBe(200)
    expect(restartScheduler).not.toHaveBeenCalled()
  })

  it('does not restart scheduler when scheduleCron only exists in stored preferences', async () => {
    const restartScheduler = vi.fn()
    const getSettings = vi.fn(
      async () =>
        ({
          ...mockSettings,
          preferences: {
            scheduleCron: '0 4 * * *',
            playlistEnabled: false,
          },
        }) as unknown as SettingsRow,
    )
    const app = createApp(makeDeps({ restartScheduler, getSettings }))

    const res = await authedRequest(app, '/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { librarySeedRatio: 0.4 } }),
    })

    expect(res.status).toBe(200)
    expect(restartScheduler).not.toHaveBeenCalled()
  })

  it('restarts playlist scheduling when playlist preferences change', async () => {
    const restartPlaylistScheduler = vi.fn(async () => {})
    const app = createApp(makeDeps({ restartPlaylistScheduler }))
    const res = await authedRequest(app, '/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { playlistEnabled: true } }),
    })
    expect(res.status).toBe(200)
    expect(restartPlaylistScheduler).toHaveBeenCalledOnce()
  })

  it('does not restart playlist scheduling when playlist fields only exist in stored preferences', async () => {
    const restartPlaylistScheduler = vi.fn(async () => {})
    const getSettings = vi.fn(
      async () =>
        ({
          ...mockSettings,
          preferences: {
            scheduleCron: null,
            playlistEnabled: true,
            playlistSchedule: '0 6 * * 1',
          },
        }) as unknown as SettingsRow,
    )
    const app = createApp(makeDeps({ restartPlaylistScheduler, getSettings }))

    const res = await authedRequest(app, '/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { librarySeedRatio: 0.4 } }),
    })

    expect(res.status).toBe(200)
    expect(restartPlaylistScheduler).not.toHaveBeenCalled()
  })

  it('does not restart scheduler when no preferences in body', async () => {
    const restartScheduler = vi.fn()
    const app = createApp(makeDeps({ restartScheduler }))
    const res = await authedRequest(app, '/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lidarrUrl: 'http://new:8686' }),
    })
    expect(res.status).toBe(200)
    expect(restartScheduler).not.toHaveBeenCalled()
  })

  it('restarts library maintenance scheduling when the sync interval is updated', async () => {
    const restartLibraryMaintenanceScheduler = vi.fn()
    const app = createApp(makeDeps({ restartLibraryMaintenanceScheduler }))
    const res = await authedRequest(app, '/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ librarySyncIntervalHours: 12 }),
    })

    expect(res.status).toBe(200)
    expect(restartLibraryMaintenanceScheduler).toHaveBeenCalledWith(12)
  })

  it('merges partial preference updates with the stored preferences blob', async () => {
    const updateSettings = vi.fn(async () => {})
    const getSettings = vi.fn(
      async () =>
        ({
          ...mockSettings,
          preferences: {
            scoreThreshold: 0.72,
            rejectionCooldownDays: 45,
            subscriptionMode: 'active',
          },
        }) as unknown as SettingsRow,
    )
    const app = createApp(makeDeps({ updateSettings, getSettings }))

    const res = await authedRequest(app, '/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { subscriptionMode: 'ai-only' } }),
    })

    expect(res.status).toBe(200)
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: {
          scoreThreshold: 0.72,
          rejectionCooldownDays: 45,
          subscriptionMode: 'ai-only',
        },
      }),
    )
  })

  it('returns 403 when setup not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lidarrUrl: 'http://new:8686' }),
    })
    expect(res.status).toBe(403)
  })

  it('accepts private media-server URLs (self-hosted LAN / reverse-proxy setups)', async () => {
    await clearAllSessions()
    await createSession(7, 'user-session-token')

    const dbWithUpdate = {
      execute: vi.fn(async () => []),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      })),
    } as unknown as AppDependencies['db']

    const app = createApp(
      makeDeps({
        db: dbWithUpdate,
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 7,
          username: 'user7',
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
      }),
    )

    const res = await app.request('/api/v1/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-session-token',
      },
      body: JSON.stringify({
        embyUrl: 'http://127.0.0.1:8096',
        embyApiKey: 'secret',
        embyUserId: 'user-1',
      }),
    })

    // Self-hosted media servers are the user's own box. Private IPs and
    // split-horizon-DNS hostnames that resolve to LAN addresses must be
    // accepted - that's the default deployment, not an SSRF target.
    expect(res.status).toBe(200)
    expect(mockUpdateUserConnections).toHaveBeenCalledWith(
      expect.anything(),
      7,
      expect.objectContaining({
        embyUrl: 'http://127.0.0.1:8096',
        embyApiKey: 'secret',
        embyUserId: 'user-1',
      }),
    )
  })
})

describe('POST /api/v1/settings/test/:service', () => {
  it('requires admin access for every settings test service', async () => {
    await clearAllSessions()
    await createSession(7, 'non-admin-settings-test-token')

    const app = createApp(
      makeDeps({
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 7,
          username: 'user7',
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
      }),
    )

    const services = [
      'lidarr',
      'listenbrainz',
      'lastfm',
      'ai',
      'plex',
      'jellyfin',
      'emby',
      'discogs',
      'spotify',
      'oidc',
    ]

    for (const service of services) {
      const res = await app.request(`/api/v1/settings/test/${service}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer non-admin-settings-test-token',
        },
        body: JSON.stringify({}),
      })

      expect(res.status, `service: ${service}`).toBe(403)
      const body = await res.json()
      expect(body.type).toBe('/problems/admin-required')
      expect(body.title).toBe('Admin access required')
    }
  })

  it('allows admins to test private HTTP service URLs', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/settings/test/emby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:8096',
        apiKey: 'key',
        userId: 'user-1',
      }),
    })

    expect(res.status).toBe(200)
    expect(mockCreateEmbyClient).toHaveBeenCalledWith('http://127.0.0.1:8096', 'key', 'user-1', {
      skipTlsVerify: false,
    })
  })

  it('sanitizes failed probe responses', async () => {
    const providerRegistry = {
      create: vi.fn(async () => ({
        testConnection: vi.fn(async () => ({
          success: false,
          message: 'HTTP 500 <html>probe failed from 127.0.0.1</html>',
        })),
      })),
    }

    const app = createApp(makeDeps({ providerRegistry: providerRegistry as never }))
    const res = await authedRequest(app, '/api/v1/settings/test/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Digarr-Locale': 'de',
      },
      body: JSON.stringify({
        provider: 'ollama',
        model: 'llama3',
        baseUrl: 'http://127.0.0.1:11434',
      }),
    })

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.type).toBe('/problems/probe-failed')
    expect(body.detail).not.toContain('HTTP 500')
    expect(body.detail).not.toContain('probe failed')
    expect(body.detail).not.toContain('127.0.0.1')
    expect(body.detail).toBe('Unbekannter Fehler')
  })

  it('tests lidarr and returns 200 or 502 with problem+json', async () => {
    const app = createApp(makeDeps())
    // Client will fail to connect - 502 problem+json, not a 200 with success:false
    const res = await authedRequest(app, '/api/v1/settings/test/lidarr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://invalid-lidarr:9999', apiKey: 'key' }),
    })
    expect([200, 502]).toContain(res.status)
    const body = await res.json()
    if (res.status === 200) expect(typeof body.message).toBe('string')
    else expect(body.type).toBe('/problems/probe-failed')
  })

  it('tests listenbrainz and returns 200 or 502 with problem+json', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/settings/test/listenbrainz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', token: 'token123' }),
    })
    expect([200, 502]).toContain(res.status)
    const body = await res.json()
    if (res.status === 200) expect(typeof body.message).toBe('string')
    else expect(body.type).toBe('/problems/probe-failed')
  })

  it('tests lastfm and returns 200 or 502 with problem+json', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/settings/test/lastfm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', apiKey: 'lfmkey' }),
    })
    expect([200, 502]).toContain(res.status)
    const body = await res.json()
    if (res.status === 200) expect(typeof body.message).toBe('string')
    else expect(body.type).toBe('/problems/probe-failed')
  })

  it('tests ai provider and returns 200 or 502 with problem+json', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 })
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/settings/test/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'ollama',
        apiKey: null,
        model: 'llama3',
        baseUrl: 'http://ollama.example.com:11434',
      }),
    })
    expect([200, 502]).toContain(res.status)
    const body = await res.json()
    if (res.status === 200) expect(typeof body.message).toBe('string')
    else expect(body.type).toBe('/problems/probe-failed')
  })

  it('returns 400 for unknown service', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/settings/test/unknown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('blocks test endpoints until setup is complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/api/v1/settings/test/lidarr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://lidarr:8686', apiKey: 'key' }),
    })
    expect(res.status).toBe(403)
  })

  it('requires admin access for OIDC connection tests', async () => {
    await clearAllSessions()
    await createSession(7, 'non-admin-oidc-token')

    const app = createApp(
      makeDeps({
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 7,
          username: 'user7',
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
      }),
    )

    const res = await app.request('/api/v1/settings/test/oidc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer non-admin-oidc-token',
      },
      body: JSON.stringify({
        issuerUrl: 'https://issuer.example',
        clientId: 'client-id',
      }),
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.type).toBe('/problems/admin-required')
    expect(body.title).toBe('Admin access required')
  })

  it('localizes admin-only test endpoint errors', async () => {
    await clearAllSessions()
    await createSession(7, 'non-admin-oidc-token')

    const app = createApp(
      makeDeps({
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 7,
          username: 'user7',
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
      }),
    )

    const res = await app.request('/api/v1/settings/test/oidc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer non-admin-oidc-token',
        'X-Digarr-Locale': 'de',
      },
      body: JSON.stringify({
        issuerUrl: 'https://issuer.example',
        clientId: 'client-id',
      }),
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.type).toBe('/problems/admin-required')
    expect(body.code).toBe('common.adminAccessRequired')
  })

  it('allows admins to test OIDC issuer URLs', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/settings/test/oidc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issuerUrl: 'https://issuer.example',
        clientId: 'client-id',
      }),
    })

    expect(res.status).toBe(200)
    expect(mockOidcTestConnection).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.message).toBe('OIDC discovery successful')
  })
})

describe('per-user listening source connections', () => {
  it('GET requires authentication once setup is complete', async () => {
    // Users exist -> non-degenerate state. authGuard 401s the unauthenticated
    // call. (Degenerate state `setupComplete=true && no users` returns 503,
    // covered separately in auth-status-shape.test.ts.)
    const app = createApp(makeDeps({ getUserCount: vi.fn(async () => 1) }))
    const res = await app.request('/api/v1/settings')
    expect(res.status).toBe(401)
  })

  it('PATCH requires authentication once setup is complete', async () => {
    const updateSettings = vi.fn(async () => {})
    const app = createApp(makeDeps({ updateSettings, getUserCount: vi.fn(async () => 1) }))

    const res = await app.request('/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listenbrainzUsername: 'global-lb',
        listenbrainzToken: 'global-token',
      }),
    })
    expect(res.status).toBe(401)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('PATCH excludes listenbrainz fields from global updateSettings when user is authenticated', async () => {
    await clearAllSessions()
    const sessionToken = 'patch-session-token-99'
    await createSession(99, sessionToken)

    const updateSettings = vi.fn(async () => {})
    const app = createApp(makeDeps({ updateSettings, getUserCount: vi.fn(async () => 1) }))

    const res = await app.request('/api/v1/settings', {
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
    expect(mockUpdateUserConnections).toHaveBeenCalledWith(
      expect.anything(),
      99,
      expect.objectContaining({
        listenbrainzUsername: 'my-lb',
        listenbrainzToken: 'my-token',
      }),
    )
  })

  it('GET /api/v1/settings exposes user-scoped emby fields for non-admins', async () => {
    await clearAllSessions()
    const sessionToken = 'emby-session-token-7'
    await createSession(7, sessionToken)

    mockGetUserConnections.mockResolvedValueOnce({
      listenbrainzUsername: null,
      listenbrainzToken: null,
      lastfmUsername: null,
      lastfmApiKey: null,
      plexUrl: null,
      plexToken: null,
      jellyfinUrl: null,
      jellyfinApiKey: null,
      jellyfinUserId: null,
      embyUrl: 'http://emby:8096',
      embyApiKey: 'secret',
      embyUserId: 'user-1',
      discogsToken: null,
      discogsUsername: null,
    })

    const app = createApp(
      makeDeps({
        getUserById: vi.fn(async () => ({
          id: 7,
          username: 'user7',
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
          embyUrl: 'http://emby:8096',
          embyApiKey: 'secret',
          embyUserId: 'user-1',
          discogsToken: null,
          discogsUsername: null,
          createdAt: new Date(),
        })),
      }),
    )
    const res = await app.request('/api/v1/settings', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.embyUrl).toBe('http://emby:8096')
    expect(body.embyApiKey).toBe('***')
    expect(body.embyUserId).toBe('user-1')
    expect(body._embyScope).toBe('user')
  })

  it('POST /api/v1/settings/test/emby validates the Emby connection', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/settings/test/emby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'http://invalid-emby:9999',
        apiKey: 'key',
        userId: 'user-1',
      }),
    })
    expect([200, 502]).toContain(res.status)
    const body = await res.json()
    if (res.status === 200) expect(typeof body.message).toBe('string')
    else expect(body.type).toBe('/problems/probe-failed')
  })

  it('PATCH excludes lastfm fields from global updateSettings when user is authenticated', async () => {
    await clearAllSessions()
    const sessionToken = 'patch-session-token-lfm'
    await createSession(42, sessionToken)

    const updateSettings = vi.fn(async () => {})
    const app = createApp(makeDeps({ updateSettings, getUserCount: vi.fn(async () => 1) }))

    const res = await app.request('/api/v1/settings', {
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
    expect(updateSettings).not.toHaveBeenCalled()
    expect(mockUpdateUserConnections).toHaveBeenCalledWith(
      expect.anything(),
      42,
      expect.objectContaining({
        lastfmUsername: 'my-lfm',
        lastfmApiKey: 'my-key',
      }),
    )
  })
})
