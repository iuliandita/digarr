// @vitest-environment node
import { lookup } from 'node:dns/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptField, encryptField, initEncryption } from '@/core/crypto'
import { clearAllSessions, createSession } from '@/core/sessions'
import type { SettingsRow } from '@/db/queries/settings'
import type { UserConnections } from '@/db/queries/users'
import type { Preferences } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'
import { makeDeps as makeSharedDeps } from '../../helpers/test-app'
import { makeUser } from '../helpers/user-fixture'

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
    plexSectionId: null as string | null,
    plexAccountId: null as number | null,
    plexAccountName: null as string | null,
    plexMachineIdentifier: null as string | null,
    jellyfinUrl: null as string | null,
    jellyfinApiKey: null as string | null,
    jellyfinUserId: null as string | null,
    jellyfinLibraryId: null as string | null,
    embyUrl: null as string | null,
    embyApiKey: null as string | null,
    embyUserId: null as string | null,
    embyLibraryId: null as string | null,
    discogsToken: null as string | null,
    discogsUsername: null as string | null,
    subsonicUrl: null as string | null,
    subsonicUsername: null as string | null,
    subsonicPassword: null as string | null,
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

const { mockCreatePlexClient } = vi.hoisted(() => ({
  mockCreatePlexClient: vi.fn(() => ({
    getIdentity: vi.fn(async () => ({ machineIdentifier: 'machine-1' })),
    getAccounts: vi.fn(async () => [{ id: 7, name: 'Listener' }]),
    getMusicSections: vi.fn(async () => [{ key: 'music-1', title: 'Music' }]),
    testConnection: vi.fn(async () => ({
      success: true,
      message: 'Connected to Plex',
      details: {
        sectionId: 'music-1',
        sections: [{ key: 'music-1', title: 'Music' }],
        machineIdentifier: 'machine-1',
        accounts: [{ id: 7, name: 'Listener' }],
      },
    })),
  })),
}))

const { mockCreateJellyfinClient } = vi.hoisted(() => ({
  mockCreateJellyfinClient: vi.fn(() => ({
    testConnection: vi.fn(async () => ({
      success: true,
      message: 'Connected to Jellyfin',
    })),
  })),
}))

const { mockCreateSubsonicClient } = vi.hoisted(() => ({
  mockCreateSubsonicClient: vi.fn(() => ({
    testConnection: vi.fn(async () => ({
      success: true,
      message: 'Connected to Subsonic',
    })),
  })),
}))

const { mockOidcTestConnection } = vi.hoisted(() => ({
  mockOidcTestConnection: vi.fn(async () => ({
    success: true,
    message: 'OIDC discovery successful',
  })),
}))

const { mockCreateTidalClient } = vi.hoisted(() => ({
  mockCreateTidalClient: vi.fn(() => ({
    searchArtists: vi.fn(async () => []),
    testConnection: vi.fn(async () => ({
      success: true,
      message: 'Connected to TIDAL - API responding',
    })),
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

vi.mock('@/core/clients/plex', () => ({
  createPlexClient: mockCreatePlexClient,
}))

vi.mock('@/core/clients/jellyfin', () => ({
  createJellyfinClient: mockCreateJellyfinClient,
}))

vi.mock('@/core/clients/subsonic', () => ({
  createSubsonicClient: mockCreateSubsonicClient,
}))

vi.mock('@/core/auth/oidc', () => ({
  OidcService: class OidcService {
    testConnection = mockOidcTestConnection
  },
}))

vi.mock('@/core/clients/tidal', () => ({
  createTidalClient: mockCreateTidalClient,
}))

vi.mock('@/core/notifications', () => ({
  dispatch: vi.fn(),
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
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return makeSharedDeps({
    storeDb: {} as unknown as AppDependencies['storeDb'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    getSettings: vi.fn(async () => mockSettings as unknown as SettingsRow),
    restartLibraryMaintenanceScheduler: vi.fn(),
    restartDigestNotifier: vi.fn(async () => {}),
    getUserById: vi.fn(async () =>
      makeUser({ username: 'admin', isAdmin: true }),
    ) as unknown as AppDependencies['getUserById'],
    getUserCount: vi.fn(async () => 0),
    ...overrides,
  })
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

function authedJson(
  app: ReturnType<typeof createApp>,
  path: string,
  method: string,
  body: unknown,
) {
  return authedRequest(app, path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makePreferenceFixture(preferences: Partial<Preferences>) {
  let stored = { ...mockSettings, preferences } as unknown as SettingsRow
  const deps = makeDeps({
    getSettings: vi.fn(async () => stored),
    updateSettings: vi.fn(async (update) => {
      stored = { ...stored, ...update }
    }),
  })
  return { deps, read: () => stored }
}

const storedPreferenceSecrets = [
  { fanartApiKey: 'private-fanart-key', webhookUrl: 'https://hooks.example/secret-token' },
  {
    fanartApiKey: 'enc:v1:stored-fanart-ciphertext',
    webhookUrl: 'enc:v1:stored-webhook-ciphertext',
  },
]

describe('settings preference secrets', () => {
  it.each(
    storedPreferenceSecrets.flatMap((secrets) =>
      [true, false].flatMap((isAdmin) =>
        [true, false].map((withChannels) => ({ secrets, isAdmin, withChannels })),
      ),
    ),
  )(
    'protects GET preferences for admin=$isAdmin channels=$withChannels with $secrets',
    async ({ secrets, isAdmin, withChannels }) => {
      const preferences: Partial<Preferences> = {
        ...secrets,
        scoreThreshold: 0.72,
        ...(withChannels
          ? {
              channels: [
                {
                  id: 't1',
                  type: 'telegram',
                  enabled: true,
                  events: ['digest'],
                  botToken: 'channel-secret',
                  chatId: '1',
                },
              ],
            }
          : {}),
      }
      const original = structuredClone(preferences)
      const { deps, read } = makePreferenceFixture(preferences)
      const user = await deps.getUserById(1)
      deps.getUserById = vi.fn(async () => (user ? { ...user, isAdmin } : null))
      const res = await authedRequest(createApp(deps), '/api/v1/settings')
      expect(res.status).toBe(200)
      const serialized = await res.text()
      for (const secret of [...Object.values(secrets), 'channel-secret']) {
        expect(serialized).not.toContain(secret)
      }
      const body = JSON.parse(serialized)
      expect(body.preferences.scoreThreshold).toBe(0.72)
      if (isAdmin) {
        expect(body.preferences.fanartApiKey).toBe('***')
        expect(body.preferences.webhookUrl).toBe('***')
        if (withChannels) expect(body.preferences.channels[0].botToken).toBe('***')
      } else {
        expect(body.preferences).not.toHaveProperty('fanartApiKey')
        expect(body.preferences).not.toHaveProperty('webhookUrl')
        expect(body.preferences).not.toHaveProperty('channels')
      }
      expect(read().preferences).toEqual(original)
    },
  )

  it.each(
    storedPreferenceSecrets.flatMap((secrets) =>
      ['normal', 'scheduleCron', 'digestCron'].map((path) => ({ secrets, path })),
    ),
  )('protects $path PATCH responses with $secrets', async ({ secrets, path }) => {
    const { deps, read } = makePreferenceFixture({ ...secrets, scoreThreshold: 0.72 })
    if (path === 'scheduleCron')
      deps.restartScheduler = vi.fn(() => {
        throw new Error('Invalid cron')
      })
    if (path === 'digestCron')
      deps.restartDigestNotifier = vi.fn(async () => {
        throw new Error('Invalid cron')
      })
    const res = await authedJson(createApp(deps), '/api/v1/settings', 'PATCH', {
      preferences: path === 'normal' ? { scoreThreshold: 0.8 } : { [path]: '0 3 * * *' },
    })
    expect(res.status).toBe(200)
    const serialized = await res.text()
    for (const secret of Object.values(secrets)) expect(serialized).not.toContain(secret)
    const body = JSON.parse(serialized)
    expect(body.preferences.fanartApiKey).toBe('***')
    expect(body.preferences.webhookUrl).toBe('***')
    if (path === 'normal') expect(body).not.toHaveProperty('warning')
    else expect(body.warning).toBe('Settings saved but cron expression is invalid')
    expect(read().preferences).toMatchObject(secrets)
  })

  it.each<Partial<Pick<Preferences, 'fanartApiKey' | 'webhookUrl'>>>([
    ...storedPreferenceSecrets,
    {},
    { fanartApiKey: '', webhookUrl: '' },
  ])('preserves stored values when preference placeholders are saved: %j', async (secrets) => {
    const channels: Preferences['channels'] = [
      {
        id: 't1',
        type: 'telegram',
        enabled: true,
        events: ['digest'],
        botToken: 'enc:v1:stored-channel-ciphertext',
        chatId: '1',
      },
    ]
    const { deps, read } = makePreferenceFixture({
      ...secrets,
      scoreThreshold: 0.72,
      rejectionCooldownDays: 45,
      channels,
    })
    const app = createApp(deps)
    const get = await authedRequest(app, '/api/v1/settings')
    const body = await get.json()
    for (const key of ['fanartApiKey', 'webhookUrl'] as const) {
      expect(body.preferences[key]).toBe(secrets[key] ? '***' : secrets[key])
    }
    const res = await authedJson(app, '/api/v1/settings', 'PATCH', {
      preferences: {
        ...body.preferences,
        fanartApiKey: body.preferences.fanartApiKey || '***',
        webhookUrl: body.preferences.webhookUrl || '***',
        scoreThreshold: 0.8,
      },
    })
    expect(res.status).toBe(200)
    expect(read().preferences).toEqual({
      ...secrets,
      scoreThreshold: 0.8,
      rejectionCooldownDays: 45,
      channels,
    })
    const after = await authedRequest(app, '/api/v1/settings')
    const saved = await after.json()
    expect(saved.preferences.channels[0].botToken).toBe('***')
    for (const key of ['fanartApiKey', 'webhookUrl'] as const) {
      expect(saved.preferences[key]).toBe(secrets[key] ? '***' : secrets[key])
    }
  })

  it.each([
    { fanartApiKey: 'replacement-key', webhookUrl: 'https://hooks.example/replacement' },
    { fanartApiKey: '', webhookUrl: '' },
  ])('persists explicit scalar preference replacements: %j', async (replacement) => {
    const { deps, read } = makePreferenceFixture({
      ...storedPreferenceSecrets[0],
      scoreThreshold: 0.72,
    })
    const res = await authedJson(createApp(deps), '/api/v1/settings', 'PATCH', {
      preferences: replacement,
    })
    expect(res.status).toBe(200)
    expect(read().preferences).toEqual({ ...replacement, scoreThreshold: 0.72 })
    const body = await res.json()
    expect(body.preferences.fanartApiKey).toBe(replacement.fanartApiKey ? '***' : '')
    expect(body.preferences.webhookUrl).toBe(replacement.webhookUrl ? '***' : '')
  })
})

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

  it.each([true, false])(
    'hides digest delivery positions from settings when admin=%s',
    async (isAdmin) => {
      const positions = { w1: '2024-01-01T00:00:00.000Z' }
      const deps = makeDeps({
        getSettings: vi.fn(
          async () =>
            ({ ...mockSettings, digestDeliveryPositions: positions }) as unknown as SettingsRow,
        ),
      })
      const user = await deps.getUserById(1)
      deps.getUserById = vi.fn(async () => (user ? { ...user, isAdmin } : null))
      const res = await authedRequest(createApp(deps), '/api/v1/settings')
      expect(res.status).toBe(200)
      expect(await res.json()).not.toHaveProperty('digestDeliveryPositions')
      expect(positions).toEqual({ w1: '2024-01-01T00:00:00.000Z' })
    },
  )

  it('masks the stored TIDAL client secret', async () => {
    mockGetUserConnections.mockResolvedValueOnce(defaultUserConnections)
    const app = createApp(
      makeDeps({
        getSettings: vi.fn(
          async () =>
            ({
              ...mockSettings,
              tidalClientId: 'tidal-id',
              tidalClientSecret: 'tidal-secret',
            }) as unknown as SettingsRow,
        ),
      }),
    )
    const res = await authedRequest(app, '/api/v1/settings')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tidalClientId).toBe('tidal-id')
    expect(body.tidalClientSecret).toBe('***')
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

describe('GET /api/v1/settings/plex/sections', () => {
  it('loads only the authenticated non-admin user connection', async () => {
    await createSession(2, 'plex-listener-session')
    mockGetUserConnections.mockClear()
    mockCreatePlexClient.mockClear()
    mockGetUserConnections.mockResolvedValueOnce({
      ...defaultUserConnections,
      plexUrl: 'http://listener-plex:32400',
      plexToken: 'listener-token',
    })
    const deps = makeDeps()
    const admin = await deps.getUserById(1)
    deps.getUserById = vi.fn(async () => (admin ? { ...admin, id: 2, isAdmin: false } : null))
    const res = await createApp(deps).request(
      '/api/v1/settings/plex/sections?url=http://other-plex:32400&token=other-token',
      { headers: { Authorization: 'Bearer plex-listener-session' } },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sections: [{ key: 'music-1', title: 'Music' }] })
    expect(mockGetUserConnections).toHaveBeenCalledWith(deps.db, 2)
    expect(mockCreatePlexClient).toHaveBeenCalledWith(
      'http://listener-plex:32400',
      'listener-token',
    )
    expect(deps.getSettings).not.toHaveBeenCalled()
  })

  it('returns no sections when the user has no saved Plex connection', async () => {
    mockGetUserConnections.mockResolvedValueOnce(defaultUserConnections)
    mockCreatePlexClient.mockClear()
    const res = await authedRequest(createApp(makeDeps()), '/api/v1/settings/plex/sections')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sections: [] })
    expect(mockCreatePlexClient).not.toHaveBeenCalled()
  })

  it('redacts the saved token from provider failures', async () => {
    mockGetUserConnections.mockResolvedValueOnce({
      ...defaultUserConnections,
      plexUrl: 'http://plex:32400',
      plexToken: 'plain-plex-secret',
    })
    const client = mockCreatePlexClient()
    client.getMusicSections.mockRejectedValueOnce(
      new Error('Failed plain-plex-secret token=other-secret'),
    )
    mockCreatePlexClient.mockReturnValueOnce(client)
    const res = await authedRequest(createApp(makeDeps()), '/api/v1/settings/plex/sections')
    expect(res.status).toBe(502)
    expect(res.headers.get('Content-Type')).toContain('application/problem+json')
    const body = await res.json()
    expect(body.detail).toBe('Failed [redacted] token=[redacted]')
  })
})

describe('PATCH /api/v1/settings', () => {
  it.each([
    ['netNewAlbumDiscovery', true],
    ['netNewAlbumDiscovery', false],
    ['showExperimentalIntegrations', true],
    ['showExperimentalIntegrations', false],
  ] as const)('saves the global %s boolean %s for admins only', async (key, value) => {
    const updateSettings = vi.fn(async () => {})
    const deps = makeDeps({ updateSettings })
    const app = createApp(deps)
    const request = () =>
      authedJson(app, '/api/v1/settings', 'PATCH', { preferences: { [key]: value } })

    expect((await request()).status).toBe(200)
    expect(updateSettings).toHaveBeenCalledWith({
      preferences: { [key]: value },
    })
    updateSettings.mockClear()
    const admin = await deps.getUserById(1)
    deps.getUserById = vi.fn(async () => (admin ? { ...admin, isAdmin: false } : null))
    expect((await request()).status).toBe(403)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it.each(['netNewAlbumDiscovery', 'showExperimentalIntegrations'])(
    'rejects malformed global %s values without saving any settings',
    async (key) => {
      const updateSettings = vi.fn(async () => {})
      const app = createApp(makeDeps({ updateSettings }))
      for (const value of ['true', 'false', 1, 0, null, [], {}]) {
        const response = await authedJson(app, '/api/v1/settings', 'PATCH', {
          preferences: { [key]: value, scoreThreshold: 0.9 },
        })
        expect(response.status).toBe(400)
      }
      expect(updateSettings).not.toHaveBeenCalled()
    },
  )

  it.each(['lidarrUrl', 'lidarrApiKey'] as const)(
    'clears reference target tags when %s changes',
    async (field) => {
      const deps = makeDeps()
      vi.mocked(deps.targetQueries.getAllTargets).mockResolvedValue([
        { id: 5, type: 'lidarr', config: { useServerConnection: true, tags: [4] } },
        { id: 6, type: 'lidarr', config: { url: 'http://other', apiKey: 'k', tags: [4] } },
      ] as never)
      const response = await authedJson(createApp(deps), '/api/v1/settings', 'PATCH', {
        [field]: field === 'lidarrUrl' ? 'http://new:8686' : 'new-key',
      })
      expect(response.status).toBe(200)
      expect(deps.targetQueries.updateTarget).toHaveBeenCalledExactlyOnceWith(5, {
        config: { useServerConnection: true },
      })
    },
  )

  it('calls updateSettings and returns updated settings', async () => {
    const updateSettings = vi.fn(async () => {})
    const updatedSettings = { ...mockSettings, lidarrUrl: 'http://new:8686' }
    const getSettings = vi.fn(async () => updatedSettings as unknown as SettingsRow)
    const app = createApp(makeDeps({ updateSettings, getSettings }))

    const res = await authedJson(app, '/api/v1/settings', 'PATCH', { lidarrUrl: 'http://new:8686' })
    expect(res.status).toBe(200)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.lidarrUrl).toBe('http://new:8686')
  })

  it('accepts TIDAL client credentials through the strict schema and persists them', async () => {
    const updateSettings = vi.fn(async () => {})
    const app = createApp(makeDeps({ updateSettings }))

    const res = await authedJson(app, '/api/v1/settings', 'PATCH', {
      tidalClientId: 'tidal-id',
      tidalClientSecret: 'tidal-secret',
    })

    expect(res.status).toBe(200)
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        tidalClientId: 'tidal-id',
        tidalClientSecret: 'tidal-secret',
      }),
    )
  })

  it.each([
    ['0 3 * * *', '0 3 * * *'],
    ['', null],
  ])('updates scheduler for cron %j to %j', async (scheduleCron, expected) => {
    const restartScheduler = vi.fn()
    const app = createApp(makeDeps({ restartScheduler }))
    const res = await authedJson(app, '/api/v1/settings', 'PATCH', {
      preferences: { scheduleCron },
    })
    expect(res.status).toBe(200)
    expect(restartScheduler).toHaveBeenCalledWith(expected)
  })

  it.each(['scheduleCron', 'digestCron', 'playlistSchedule'])(
    'rejects an invalid %s with 400 without saving',
    async (field) => {
      const restartScheduler = vi.fn()
      const updateSettings = vi.fn(async () => {})
      const app = createApp(makeDeps({ restartScheduler, updateSettings }))
      const res = await authedJson(app, '/api/v1/settings', 'PATCH', {
        preferences: { [field]: 'not a cron' },
      })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('validation_failed')
      expect(updateSettings).not.toHaveBeenCalled()
      expect(restartScheduler).not.toHaveBeenCalled()
    },
  )

  it.each([
    { stored: null, body: { preferences: { librarySeedRatio: 0.5 } } },
    {
      stored: { scheduleCron: '0 4 * * *', playlistEnabled: false },
      body: { preferences: { librarySeedRatio: 0.4 } },
    },
    {
      stored: { scheduleCron: null, playlistEnabled: true, playlistSchedule: '0 6 * * 1' },
      body: { preferences: { librarySeedRatio: 0.4 } },
    },
    { stored: null, body: { lidarrUrl: 'http://new:8686' } },
  ])('does not restart schedules for unrelated updates: %j', async ({ stored, body }) => {
    const restartScheduler = vi.fn()
    const restartPlaylistScheduler = vi.fn(async () => {})
    const restartDigestNotifier = vi.fn(async () => {})
    const app = createApp(
      makeDeps({
        restartScheduler,
        restartPlaylistScheduler,
        restartDigestNotifier,
        getSettings: vi.fn(
          async () => ({ ...mockSettings, preferences: stored }) as unknown as SettingsRow,
        ),
      }),
    )
    const res = await authedJson(app, '/api/v1/settings', 'PATCH', body)
    expect(res.status).toBe(200)
    expect(restartScheduler).not.toHaveBeenCalled()
    expect(restartPlaylistScheduler).not.toHaveBeenCalled()
    expect(restartDigestNotifier).not.toHaveBeenCalled()
  })

  it('restarts playlist scheduling when playlist preferences change', async () => {
    const restartPlaylistScheduler = vi.fn(async () => {})
    const app = createApp(makeDeps({ restartPlaylistScheduler }))
    const res = await authedJson(app, '/api/v1/settings', 'PATCH', {
      preferences: { playlistEnabled: true },
    })
    expect(res.status).toBe(200)
    expect(restartPlaylistScheduler).toHaveBeenCalledOnce()
  })

  it('restarts library maintenance scheduling when the sync interval is updated', async () => {
    const restartLibraryMaintenanceScheduler = vi.fn()
    const app = createApp(makeDeps({ restartLibraryMaintenanceScheduler }))
    const res = await authedJson(app, '/api/v1/settings', 'PATCH', { librarySyncIntervalHours: 12 })

    expect(res.status).toBe(200)
    expect(restartLibraryMaintenanceScheduler).toHaveBeenCalledWith(12)
  })

  it('rejects duplicate notification channel IDs before saving preferences', async () => {
    const deps = makeDeps()
    const channel = {
      id: 'duplicate',
      type: 'webhook',
      enabled: true,
      events: ['digest'],
      url: 'https://hooks.example.com/notify',
    }
    const res = await authedJson(createApp(deps), '/api/v1/settings', 'PATCH', {
      preferences: { channels: [channel, { ...channel, enabled: false }] },
    })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('Notification channel IDs must be unique')
    expect(deps.updateSettings).not.toHaveBeenCalled()
  })

  it.each(['top-level', 'preferences'])(
    'prevents editing digest positions through %s settings',
    async (placement) => {
      const deps = makeDeps({
        getSettings: vi.fn(
          async () =>
            ({
              ...mockSettings,
              digestDeliveryPositions: { w1: '2024-01-01T00:00:00.000Z' },
            }) as unknown as SettingsRow,
        ),
      })
      const positions = { w1: '2099-01-01T00:00:00.000Z' }
      const body =
        placement === 'top-level'
          ? { digestDeliveryPositions: positions, preferences: { digestCron: '0 6 * * *' } }
          : { preferences: { digestDeliveryPositions: positions } }
      const res = await authedJson(createApp(deps), '/api/v1/settings', 'PATCH', body)
      if (placement === 'preferences') {
        expect(res.status).toBe(400)
        expect(deps.updateSettings).not.toHaveBeenCalled()
      } else {
        expect(res.status).toBe(200)
        expect(deps.updateSettings).toHaveBeenCalledWith({
          preferences: { digestCron: '0 6 * * *' },
        })
        expect(await res.json()).not.toHaveProperty('digestDeliveryPositions')
      }
    },
  )

  it('restarts the digest notifier when digestCron is updated', async () => {
    const restartDigestNotifier = vi.fn(async () => {})
    const app = createApp(makeDeps({ restartDigestNotifier }))
    const res = await authedJson(app, '/api/v1/settings', 'PATCH', {
      preferences: { digestCron: '0 6 * * 1' },
    })
    expect(res.status).toBe(200)
    expect(restartDigestNotifier).toHaveBeenCalledOnce()
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
            netNewAlbumDiscovery: true,
            subscriptionMode: 'active',
          },
        }) as unknown as SettingsRow,
    )
    const app = createApp(makeDeps({ updateSettings, getSettings }))

    const res = await authedJson(app, '/api/v1/settings', 'PATCH', {
      preferences: { subscriptionMode: 'ai-only' },
    })

    expect(res.status).toBe(200)
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: {
          scoreThreshold: 0.72,
          rejectionCooldownDays: 45,
          netNewAlbumDiscovery: true,
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
        getUserById: vi.fn(async () => makeUser({ id: 7, username: 'user7' })),
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
        embyLibraryId: null,
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
        embyLibraryId: null,
      }),
    )
  })

  it('binds a selected Plex account to the server identity and canonical account name', async () => {
    mockUpdateUserConnections.mockClear()
    mockCreatePlexClient.mockClear()
    mockGetUserConnections
      .mockResolvedValueOnce(defaultUserConnections)
      .mockResolvedValueOnce(defaultUserConnections)
    const app = createApp(makeDeps())

    const res = await authedJson(app, '/api/v1/settings', 'PATCH', {
      plexUrl: 'http://plex:32400',
      plexToken: 'plex-token',
      plexSectionId: 'music-1',
      plexAccountId: 7,
    })

    expect(res.status).toBe(200)
    expect(mockUpdateUserConnections).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({
        plexUrl: 'http://plex:32400',
        plexToken: 'plex-token',
        plexSectionId: 'music-1',
        plexAccountId: 7,
        plexAccountName: 'Listener',
        plexMachineIdentifier: 'machine-1',
      }),
    )
  })

  it('clears a stale Plex account binding when the server changes without a new selection', async () => {
    mockUpdateUserConnections.mockClear()
    mockCreatePlexClient.mockClear()
    const currentPlex = {
      ...defaultUserConnections,
      plexUrl: 'http://old-plex:32400',
      plexToken: 'plex-token',
      plexSectionId: 'music-1',
      plexAccountId: 7,
      plexAccountName: 'Listener',
      plexMachineIdentifier: 'old-machine',
    }
    mockGetUserConnections.mockResolvedValueOnce(currentPlex).mockResolvedValueOnce(currentPlex)
    const app = createApp(makeDeps())

    const res = await authedJson(app, '/api/v1/settings', 'PATCH', {
      plexUrl: 'http://new-plex:32400',
    })

    expect(res.status).toBe(200)
    expect(mockUpdateUserConnections).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({
        plexUrl: 'http://new-plex:32400',
        plexAccountId: null,
        plexAccountName: null,
        plexMachineIdentifier: null,
      }),
    )
    expect(mockCreatePlexClient).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/settings/test/:service', () => {
  it.each([
    { body: {}, expected: 7 },
    { body: { accountId: null }, expected: null },
    { body: { accountId: 8 }, expected: 8 },
  ])('uses the explicit Plex probe selection $expected', async ({ body, expected }) => {
    const current = {
      ...defaultUserConnections,
      plexUrl: 'http://plex:32400',
      plexToken: 'token',
      plexAccountId: 7,
    }
    mockGetUserConnections.mockResolvedValueOnce(current)
    mockCreatePlexClient.mockClear()
    const app = createApp(makeDeps())
    const res = await authedJson(app, '/api/v1/settings/test/plex', 'POST', body)
    expect(res.status).toBe(200)
    expect(mockCreatePlexClient).toHaveBeenCalledWith(
      'http://plex:32400',
      'token',
      expect.objectContaining({ accountId: expected }),
    )
  })

  it('requires admin access for global settings test services', async () => {
    await clearAllSessions()
    await createSession(7, 'non-admin-settings-test-token')

    const app = createApp(
      makeDeps({
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => makeUser({ id: 7, username: 'user7' })),
      }),
    )

    const services = [
      'lidarr',
      'listenbrainz',
      'lastfm',
      'ai',
      'jellyfin',
      'emby',
      'discogs',
      'subsonic',
      'spotify',
      'oidc',
      'tidal',
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

  it('lets a non-admin enumerate accounts only through their own Plex credentials', async () => {
    await clearAllSessions()
    await createSession(7, 'non-admin-plex-test-token')
    mockGetUserConnections.mockResolvedValueOnce({
      ...defaultUserConnections,
      plexUrl: 'http://stored-plex:32400',
      plexToken: 'stored-user-token',
    })
    const app = createApp(
      makeDeps({
        getUserById: vi.fn(async () =>
          makeUser({
            id: 7,
            username: 'user7',
            ...defaultUserConnections,
            plexUrl: 'http://stored-plex:32400',
            plexToken: 'stored-user-token',
          }),
        ),
      }),
    )

    const res = await app.request('/api/v1/settings/test/plex', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer non-admin-plex-test-token',
      },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      machineIdentifier: 'machine-1',
      accounts: [{ id: 7, name: 'Listener' }],
    })
    expect(mockCreatePlexClient).toHaveBeenCalledWith(
      'http://stored-plex:32400',
      'stored-user-token',
      { sectionId: null, accountId: null },
    )
  })

  it('allows admins to test private HTTP service URLs', async () => {
    const app = createApp(makeDeps())
    const res = await authedJson(app, '/api/v1/settings/test/emby', 'POST', {
      url: 'http://127.0.0.1:8096',
      apiKey: 'key',
      userId: 'user-1',
    })

    expect(res.status).toBe(200)
    expect(mockCreateEmbyClient).toHaveBeenCalledWith('http://127.0.0.1:8096', 'key', 'user-1', {
      skipTlsVerify: false,
      libraryId: null,
    })
  })

  it.each([
    ['explicit', { sectionId: 'music-1' }, 'music-1'],
    ['empty', { sectionId: '' }, ''],
    ['omitted', {}, 'stored-music'],
  ])('passes the %s Plex library selection to the client', async (_case, selection, expected) => {
    mockCreatePlexClient.mockClear()
    mockGetUserConnections.mockResolvedValueOnce({
      ...defaultUserConnections,
      plexSectionId: 'stored-music',
    })
    const app = createApp(makeDeps())

    const res = await authedJson(app, '/api/v1/settings/test/plex', 'POST', {
      url: 'http://plex:32400',
      token: 'plex-token',
      ...selection,
    })

    expect(res.status).toBe(200)
    expect(mockCreatePlexClient).toHaveBeenCalledWith('http://plex:32400', 'plex-token', {
      sectionId: expected,
      accountId: null,
    })
  })

  it.each([
    ['explicit', { libraryId: 'music-1' }, 'music-1'],
    ['empty', { libraryId: '' }, ''],
    ['omitted', {}, 'stored-music'],
  ])(
    'passes the %s Jellyfin library selection to the client',
    async (_case, selection, expected) => {
      mockCreateJellyfinClient.mockClear()
      mockGetUserConnections.mockResolvedValueOnce({
        ...defaultUserConnections,
        jellyfinLibraryId: 'stored-music',
      })
      const app = createApp(makeDeps())

      const res = await authedJson(app, '/api/v1/settings/test/jellyfin', 'POST', {
        url: 'http://jellyfin:8096',
        apiKey: 'jellyfin-key',
        userId: 'user-1',
        ...selection,
      })

      expect(res.status).toBe(200)
      expect(mockCreateJellyfinClient).toHaveBeenCalledWith(
        'http://jellyfin:8096',
        'jellyfin-key',
        'user-1',
        { skipTlsVerify: false, libraryId: expected },
      )
    },
  )

  it.each([
    ['explicit', { libraryId: 'music-1' }, 'music-1'],
    ['empty', { libraryId: '' }, ''],
    ['omitted', {}, 'stored-music'],
  ])('passes the %s Emby library selection to the client', async (_case, selection, expected) => {
    mockCreateEmbyClient.mockClear()
    mockGetUserConnections.mockResolvedValueOnce({
      ...defaultUserConnections,
      embyLibraryId: 'stored-music',
    })
    const app = createApp(makeDeps())

    const res = await authedJson(app, '/api/v1/settings/test/emby', 'POST', {
      url: 'http://emby:8096',
      apiKey: 'emby-key',
      userId: 'user-1',
      ...selection,
    })

    expect(res.status).toBe(200)
    expect(mockCreateEmbyClient).toHaveBeenCalledWith('http://emby:8096', 'emby-key', 'user-1', {
      skipTlsVerify: false,
      libraryId: expected,
    })
  })

  it('surfaces failed probe detail with secrets redacted', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 })
    const providerRegistry = {
      create: vi.fn(async () => ({
        testConnection: vi.fn(async () => ({
          success: false,
          message: `models/llama3 is not found for key sk-abcdefgh12345678\n${'x'.repeat(400)}`,
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
    // Upstream detail is surfaced so admins can act on it (missing model,
    // malformed field), but credential-shaped substrings are redacted and the
    // whole detail is capped.
    expect(body.detail).toContain('models/llama3 is not found')
    expect(body.detail).not.toContain('sk-abcdefgh12345678')
    expect(body.detail).toContain('[redacted]')
    expect(body.detail.length).toBeLessThanOrEqual(300)
  })

  it('falls back to the localized unknown-error detail when the probe message is empty', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 })
    const providerRegistry = {
      create: vi.fn(async () => ({
        testConnection: vi.fn(async () => ({ success: false, message: '' })),
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
    expect(body.detail).toBe('Unbekannter Fehler')
  })

  it.each([
    { service: 'lidarr', body: { url: 'http://invalid-lidarr:9999', apiKey: 'key' } },
    { service: 'listenbrainz', body: { username: 'testuser', token: 'token123' } },
    { service: 'lastfm', body: { username: 'testuser', apiKey: 'lfmkey' } },
    {
      service: 'ai',
      body: {
        provider: 'ollama',
        apiKey: null,
        model: 'llama3',
        baseUrl: 'http://ollama.example.com:11434',
      },
    },
    { service: 'emby', body: { url: 'http://invalid-emby:9999', apiKey: 'key', userId: 'user-1' } },
  ])('returns a message or probe problem for $service', async ({ service, body: input }) => {
    vi.mocked(lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 })
    const res = await authedJson(
      createApp(makeDeps()),
      `/api/v1/settings/test/${service}`,
      'POST',
      input,
    )
    expect([200, 502]).toContain(res.status)
    const body = await res.json()
    if (res.status === 200) expect(typeof body.message).toBe('string')
    else expect(body.type).toBe('/problems/probe-failed')
  })

  it('includes optional probe metadata on successful connection tests', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 })
    const providerRegistry = {
      create: vi.fn(async () => ({
        testConnection: vi.fn(async () => ({
          success: true,
          message: 'Connected to test provider',
          details: { version: '1.2.3' },
        })),
      })),
    }
    const app = createApp(makeDeps({ providerRegistry: providerRegistry as never }))

    const res = await authedJson(app, '/api/v1/settings/test/ai', 'POST', {
      provider: 'ollama',
      model: 'llama3',
      baseUrl: 'http://ollama.example.com:11434',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      message: 'Connected to test provider',
      version: '1.2.3',
    })
    expect(body.latencyMs).toEqual(expect.any(Number))
    expect(body.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('tests subsonic and invokes the client with the provided credentials', async () => {
    const app = createApp(makeDeps())
    const res = await authedJson(app, '/api/v1/settings/test/subsonic', 'POST', {
      url: 'http://127.0.0.1:4533',
      username: 'admin',
      password: 'pw',
    })

    expect(res.status).toBe(200)
    expect(mockCreateSubsonicClient).toHaveBeenCalledWith('http://127.0.0.1:4533', 'admin', 'pw', {
      skipTlsVerify: false,
    })
    const body = await res.json()
    expect(body.message).toBe('Connected to Subsonic')
  })

  it.each([
    ['subsonic', { url: 'http://127.0.0.1:4533', username: 'admin' }],
    ['tidal', { clientId: 'tidal-id' }],
  ])('rejects incomplete %s credentials', async (service, input) => {
    const res = await authedJson(
      createApp(makeDeps()),
      `/api/v1/settings/test/${service}`,
      'POST',
      input,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).type).toBe('/problems/probe-missing-input')
  })

  it('tests tidal and invokes the client with the provided credentials', async () => {
    const app = createApp(makeDeps())
    const res = await authedJson(app, '/api/v1/settings/test/tidal', 'POST', {
      clientId: 'tidal-id',
      clientSecret: 'tidal-secret',
    })

    expect(res.status).toBe(200)
    expect(mockCreateTidalClient).toHaveBeenCalledWith({
      clientId: 'tidal-id',
      clientSecret: 'tidal-secret',
    })
    const body = await res.json()
    expect(body.message).toBe('Connected to TIDAL - API responding')
  })

  it('falls back to stored TIDAL credentials when the request omits them', async () => {
    const app = createApp(
      makeDeps({
        getSettings: vi.fn(
          async () =>
            ({
              ...mockSettings,
              tidalClientId: 'stored-id',
              tidalClientSecret: 'stored-secret',
            }) as unknown as SettingsRow,
        ),
      }),
    )
    const res = await authedJson(app, '/api/v1/settings/test/tidal', 'POST', {})

    expect(res.status).toBe(200)
    expect(mockCreateTidalClient).toHaveBeenCalledWith({
      clientId: 'stored-id',
      clientSecret: 'stored-secret',
    })
  })

  it('returns 400 for unknown service', async () => {
    const app = createApp(makeDeps())
    const res = await authedJson(app, '/api/v1/settings/test/unknown', 'POST', {})
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
        getUserById: vi.fn(async () => makeUser({ id: 7, username: 'user7' })),
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
        getUserById: vi.fn(async () => makeUser({ id: 7, username: 'user7' })),
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
    const res = await authedJson(app, '/api/v1/settings/test/oidc', 'POST', {
      issuerUrl: 'https://issuer.example',
      clientId: 'client-id',
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
      ...defaultUserConnections,
      embyUrl: 'http://emby:8096',
      embyApiKey: 'secret',
      embyUserId: 'user-1',
    })

    const app = createApp(
      makeDeps({
        getUserById: vi.fn(async () =>
          makeUser({
            id: 7,
            username: 'user7',
            embyUrl: 'http://emby:8096',
            embyApiKey: 'secret',
            embyUserId: 'user-1',
          }),
        ),
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

describe('POST /api/v1/settings/test-webhook', () => {
  function appWithWebhook() {
    return createApp(
      makeDeps({
        getSettings: vi.fn(
          async () =>
            ({
              ...mockSettings,
              preferences: { webhookUrl: 'http://hooks.internal:9000/notify' },
            }) as unknown as SettingsRow,
        ),
      }),
    )
  }

  it('returns 204 when the dispatched channel succeeds', async () => {
    const { dispatch } = await import('@/core/notifications')
    vi.mocked(dispatch).mockResolvedValueOnce([{ id: 'legacy-webhook', type: 'webhook', ok: true }])

    const res = await authedRequest(appWithWebhook(), '/api/v1/settings/test-webhook', {
      method: 'POST',
    })
    expect(res.status).toBe(204)
  })

  it('returns 502 with a redacted detail when the channel fails', async () => {
    const { dispatch } = await import('@/core/notifications')
    // A dispatch error may carry a secret-bearing URL; the route must redact
    // it before echoing it in the problem+json detail (defense-in-depth).
    vi.mocked(dispatch).mockResolvedValueOnce([
      {
        id: 'legacy-webhook',
        type: 'webhook',
        ok: false,
        error: 'POST failed: https://hooks.example.com/notify?token=SUPERSECRET123 returned 500',
      },
    ])

    const res = await authedRequest(appWithWebhook(), '/api/v1/settings/test-webhook', {
      method: 'POST',
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { detail?: string }
    const serialized = JSON.stringify(body)
    // The raw secret token must not leak into the response.
    expect(serialized).not.toContain('SUPERSECRET123')
    expect(body.detail).toContain('[redacted]')
  })

  it('returns 400 when an inline channel body fails schema validation', async () => {
    const res = await authedJson(appWithWebhook(), '/api/v1/settings/test-webhook', 'POST', {
      id: 'bad',
      type: 'telegram',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when no notification channel is configured', async () => {
    const app = createApp(
      makeDeps({
        getSettings: vi.fn(
          async () => ({ ...mockSettings, preferences: {} }) as unknown as SettingsRow,
        ),
      }),
    )
    const res = await authedRequest(app, '/api/v1/settings/test-webhook', { method: 'POST' })
    expect(res.status).toBe(400)
  })
})

describe('AudioMuse admin settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    initEncryption(undefined)
  })

  it('encrypts, masks, preserves, and clears the optional token in existing preferences', async () => {
    initEncryption('settings-test-key')
    const { deps, read } = makePreferenceFixture({
      audiomuseUrl: 'https://audiomuse.example',
      primaryGenres: ['rock'],
    })
    const app = createApp(deps)
    const patch = (preferences: Record<string, unknown>) =>
      authedJson(app, '/api/v1/settings', 'PATCH', { preferences })
    const saved = await patch({ audiomuseToken: 'private-token', audiomuseSkipTlsVerify: true })
    expect(saved.status).toBe(200)
    expect((await saved.json()).preferences.audiomuseToken).toBe('***')
    const encrypted = read().preferences?.audiomuseToken
    expect(encrypted).toMatch(/^enc:v1:/)
    expect(decryptField(encrypted)).toBe('private-token')
    expect(read().preferences?.primaryGenres).toEqual(['rock'])
    expect((await patch({ audiomuseToken: '***' })).status).toBe(200)
    expect(read().preferences?.audiomuseToken).toBe(encrypted)
    expect((await patch({ audiomuseToken: '' })).status).toBe(200)
    expect(read().preferences?.audiomuseToken).toBe('')
  })

  it('hides the connection from members and rejects their writes and probes', async () => {
    const { deps } = makePreferenceFixture({
      audiomuseUrl: 'https://audiomuse.example',
      audiomuseToken: 'secret',
      audiomuseSkipTlsVerify: true,
    })
    deps.getUserById = vi.fn(async () => ({ id: 1, isAdmin: false }) as never)
    const app = createApp(deps)
    const response = await authedRequest(app, '/api/v1/settings')
    expect(JSON.stringify(await response.json())).not.toMatch(
      /audiomuseUrl|audiomuseToken|audiomuseSkipTlsVerify|secret/,
    )
    for (const [path, body] of [
      ['/api/v1/settings', { preferences: { audiomuseUrl: 'https://other.example' } }],
      ['/api/v1/settings/test/audiomuse', {}],
    ] as const) {
      const res = await authedJson(app, path, path.includes('/test/') ? 'POST' : 'PATCH', body)
      expect(res.status).toBe(403)
    }
    expect(deps.updateSettings).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { token: '***' },
    { url: 'https://draft.example', token: '', skipTlsVerify: false },
  ])('probes saved credentials or explicit overrides: %j', async (body) => {
    initEncryption('probe-test-key')
    const { deps } = makePreferenceFixture({
      audiomuseUrl: 'https://saved.example',
      audiomuseToken: 'secret-token',
      audiomuseSkipTlsVerify: true,
    })
    const fetch = vi.fn().mockResolvedValue(Response.json({ app_version: 'v3.6.4' }))
    vi.stubGlobal('fetch', fetch)
    const response = await authedJson(
      createApp(deps),
      '/api/v1/settings/test/audiomuse',
      'POST',
      body,
    )
    expect(response.status).toBe(200)
    expect((await response.json()).version).toBe('v3.6.4')
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(`${'url' in body ? body.url : 'https://saved.example'}/api/version`)
    expect(init.headers.get('Authorization')).toBe('url' in body ? null : 'Bearer secret-token')
    expect(init.tls).toEqual('url' in body ? undefined : { rejectUnauthorized: false })
    expect(deps.updateSettings).not.toHaveBeenCalled()
  })

  it.each([{}, { token: '***' }])(
    'returns a probe error for an unreadable saved token: %j',
    async (body) => {
      initEncryption('original-key')
      const token = encryptField('private-token')
      initEncryption('restored-key')
      const { deps } = makePreferenceFixture({
        audiomuseUrl: 'https://saved.example',
        audiomuseToken: token ?? undefined,
      })
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)

      const response = await authedJson(
        createApp(deps),
        '/api/v1/settings/test/audiomuse',
        'POST',
        body,
      )

      expect(response.status).toBe(502)
      const result = await response.json()
      expect(result.type).toContain('probe-failed')
      expect(result.detail).toBe('AudioMuse-AI token unreadable, re-enter it')
      expect(JSON.stringify(result)).not.toContain('private-token')
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each([{ skipTlsVerify: 'true' }, { url: 'file:///etc/passwd' }, { url: '' }, { token: 12 }])(
    'rejects invalid probe input before any request: %j',
    async (body) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      const res = await authedJson(
        createApp(makeDeps()),
        '/api/v1/settings/test/audiomuse',
        'POST',
        body,
      )
      expect(res.status).toBe(400)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('returns an actionable probe failure without upstream secrets', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error_code: 1005, error: 'private-token' }, { status: 401 }),
      )
    vi.stubGlobal('fetch', fetch)
    const res = await authedJson(createApp(makeDeps()), '/api/v1/settings/test/audiomuse', 'POST', {
      url: 'https://audiomuse.example',
      token: 'private-token',
    })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.detail).toBe('AudioMuse-AI: authentication_required')
    expect(JSON.stringify(body)).not.toContain('private-token')
  })
})
