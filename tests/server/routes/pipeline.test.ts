// @vitest-environment node

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptField, initEncryption } from '@/core/crypto'
import { resolve } from '@/core/pipeline/resolve'
import { store } from '@/core/pipeline/store'
import { createSession } from '@/core/sessions'
import type { ResolvedArtist } from '@/core/types'

const mocks = vi.hoisted(() => ({
  audiodbClient: { getArtistImages: vi.fn(), searchArtistByName: vi.fn() },
  fanartClient: { getArtistImages: vi.fn() },
  lidarrClient: { lookupArtist: vi.fn() },
  musicBrainzClient: { lookupArtist: vi.fn(), searchArtist: vi.fn() },
  musicinfoClient: { lookupArtistImages: vi.fn() },
  fetchArtistImage: vi.fn(),
  upsertArtist: vi.fn(),
}))

vi.mock('@/core/clients/audiodb', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/clients/audiodb')>()
  return { ...original, createAudiodbClient: vi.fn(() => mocks.audiodbClient) }
})

vi.mock('@/core/clients/fanart', () => ({
  createFanartClient: vi.fn(() => mocks.fanartClient),
}))

vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(() => mocks.lidarrClient),
}))

vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(() => mocks.musicBrainzClient),
}))

vi.mock('@/core/clients/musicinfo', () => ({
  createMusicinfoClient: vi.fn(() => mocks.musicinfoClient),
}))

vi.mock('@/core/pipeline/resolve', () => ({
  resolve: vi.fn(async () => []),
  fetchArtistImage: mocks.fetchArtistImage,
}))

vi.mock('@/core/pipeline/store', () => ({
  store: vi.fn(async () => {}),
}))

vi.mock('@/db/queries/users', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/queries/users')>()
  return {
    ...original,
    getUserConnections: vi.fn(async () => null),
  }
})

vi.mock('@/db/queries/artists', () => ({
  upsertArtist: mocks.upsertArtist,
}))

import type { SettingsRow } from '@/db/queries/settings'
import { DEFAULT_PREFERENCES } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'
import { makeDeps as makeSharedDeps } from '../../helpers/test-app'

beforeEach(async () => {
  vi.clearAllMocks()
  const { clearAllSessions } = await import('@/core/sessions')
  await clearAllSessions()
})

afterEach(async () => {
  initEncryption(undefined)
  const { clearAllSessions } = await import('@/core/sessions')
  await clearAllSessions()
})

function makeMockOrchestrator(isRunning = false) {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    isRunning,
    run: vi.fn(async () => ({ batchId: 1 })),
    enqueue: vi.fn(() =>
      isRunning ? { status: 'queued', position: 1 } : { status: 'started', position: 0 },
    ),
    cancel: vi.fn(() => ({ cancelled: isRunning })),
    queueLength: isRunning ? 1 : 0,
    queuePositionFor: vi.fn(() => 0),
    currentUserId: isRunning ? 1 : undefined,
    stage: isRunning ? 'resolve' : null,
    stageMessage: null,
  })
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return makeSharedDeps({
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: makeMockOrchestrator() as unknown as AppDependencies['orchestrator'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {
      create: vi.fn().mockResolvedValue({ getRecommendations: vi.fn(), testConnection: vi.fn() }),
      register: vi.fn(),
      has: vi.fn().mockReturnValue(true),
      availableIds: vi.fn().mockReturnValue(['anthropic', 'openai', 'ollama']),
    } as unknown as AppDependencies['providerRegistry'],
    getSettings: vi.fn(
      async () =>
        ({
          id: 1,
          lidarrUrl: 'http://lidarr:8686',
          lidarrApiKey: 'key',
          preferences: null,
        }) as SettingsRow,
    ),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 0),
    ...overrides,
  })
}

const SESSION_TOKEN = 'pipeline-session-token'

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

describe('POST /api/v1/pipeline/run', () => {
  it('returns 202 when pipeline is not running', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.message).toBe('Pipeline started')
  })

  it.each(['direct', 'auto_approve'] as const)(
    'captures %s policy once for a 1000-item run',
    async (approvalPolicy) => {
      const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
      const getUserById = vi.fn(async () => ({
        id: 1,
        approvalPolicy,
        approvalThreshold: 0.8,
        isAdmin: false,
        preferences: null,
      })) as unknown as AppDependencies['getUserById']
      const app = createApp(makeDeps({ orchestrator, getUserById }))
      const response = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
      expect(response.status).toBe(202)
      const run = vi.mocked(orchestrator.enqueue).mock.calls[0]?.[0]
      const canApprove = run?.autoApproveDeps?.canApprove
      if (approvalPolicy === 'direct') expect(canApprove).toBeUndefined()
      else {
        for (let i = 0; i < 1000; i++) expect(await canApprove?.(0.9)).toBe(true)
        expect(await canApprove?.(0.7)).toBe(false)
      }
      expect(getUserById).toHaveBeenCalledOnce()
    },
  )

  it('passes the job recorder into the auto-approve deps', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const deps = makeDeps({ orchestrator })
    const app = createApp(deps)
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(202)
    const run = vi.mocked(orchestrator.enqueue).mock.calls[0]?.[0]
    expect(run?.autoApproveDeps?.jobRecorder).toBe(deps.jobRecorder)
  })

  it('queues the run (202) when a pipeline is already running', async () => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.queued).toBe(true)
    expect(body.position).toBe(1)
  })

  it('keeps the admin AudioMuse connection when resolving personal preferences', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const personalPreferences = { ...DEFAULT_PREFERENCES, scoreThreshold: 0.7 }
    const app = createApp(
      makeDeps({
        orchestrator,
        getSettings: vi.fn().mockResolvedValue({
          id: 1,
          preferences: {
            ...DEFAULT_PREFERENCES,
            audiomuseUrl: 'https://audiomuse:8000',
            audiomuseToken: 'admin-token',
            audiomuseSkipTlsVerify: true,
          },
        }),
        getUserById: vi.fn().mockResolvedValue({
          id: 1,
          isAdmin: false,
          preferences: personalPreferences,
        }),
      }),
    )

    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })

    expect(res.status).toBe(202)
    expect(orchestrator.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          preferences: personalPreferences,
          audiomuse: {
            url: 'https://audiomuse:8000',
            token: 'admin-token',
            skipTlsVerify: true,
          },
        }),
      }),
    )
  })

  it('starts a run with AudioMuse skipped when the saved token uses a different encryption key', async () => {
    initEncryption('original-key')
    const token = encryptField('private-token')
    initEncryption('restored-key')
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const app = createApp(
      makeDeps({
        orchestrator,
        getSettings: vi.fn().mockResolvedValue({
          id: 1,
          preferences: {
            ...DEFAULT_PREFERENCES,
            audiomuseUrl: 'https://audiomuse:8000',
            audiomuseToken: token,
          },
        }),
      }),
    )

    const response = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })

    expect(response.status).toBe(202)
    expect(orchestrator.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          audiomuse: expect.objectContaining({ skipReason: 'token_unreadable' }),
        }),
      }),
    )
    expect(JSON.stringify(vi.mocked(orchestrator.enqueue).mock.calls)).not.toContain(
      'private-token',
    )
  })

  it('reports duplicate (not queued) when the same user re-submits during their in-flight run', async () => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    // Same-user re-submit: enqueue returns a no-op duplicate at position 0.
    orchestrator.enqueue = vi.fn(() => ({ status: 'duplicate', position: 0 })) as never
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    // Must NOT be reported as a fresh queue at position 0 (silent no-op as success).
    expect(body.status).toBe('duplicate')
    expect(body.queued).toBe(false)
  })

  it('returns 400 when settings are missing', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const app = createApp(
      makeDeps({
        orchestrator,
        getSettings: vi.fn(async () => null),
      }),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('passes the resolved response locale into manual pipeline runs', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const app = createApp(
      makeDeps({
        orchestrator,
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: 1,
          username: 'test',
          isAdmin: false,
          preferredLocale: 'de',
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
        })),
      }),
    )

    const { createSession } = await import('@/core/sessions')
    await createSession(1, 'session-token')

    const res = await authedRequest(app, '/api/v1/pipeline/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
        'X-Digarr-Locale': 'fr',
      },
    })

    expect(res.status).toBe(202)
    expect(orchestrator.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        responseLocale: 'fr',
        promptLocale: null,
      }),
    )
  })

  it('passes librarySync into the orchestrator (regression: GH #105)', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const librarySync = { syncForUser: vi.fn() } as unknown as AppDependencies['librarySync']
    const app = createApp(makeDeps({ orchestrator, librarySync }))
    const res = await authedRequest(app, '/api/v1/pipeline/run', { method: 'POST' })
    expect(res.status).toBe(202)
    expect(orchestrator.enqueue).toHaveBeenCalledWith(expect.objectContaining({ librarySync }))
  })
})

describe('GET /api/v1/pipeline/status', () => {
  it('returns running: false when not running', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/pipeline/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.running).toBe(false)
    expect(body.lastRun).toBeUndefined()
  })

  it('returns running: true when orchestrator is running', async () => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.running).toBe(true)
  })

  it('hides other users runs and queue from non-admins, shows them to admins', async () => {
    const mock = makeMockOrchestrator(true)
    mock.currentUserId = 2
    mock.queueLength = 3
    const orchestrator = mock as unknown as AppDependencies['orchestrator']
    const lastBatch = { id: 42, createdAt: new Date('2024-06-01'), status: 'completed' }
    const getLastBatch = vi.fn(async () => lastBatch)

    const user = createApp(makeDeps({ orchestrator, getLastBatch }))
    const userBody = await (await authedRequest(user, '/api/v1/pipeline/status')).json()
    expect(userBody).toMatchObject({ running: false, stage: null, queueLength: 0 })
    expect(userBody.lastRun).toBeUndefined()

    const admin = createApp(
      makeDeps({
        orchestrator,
        getLastBatch,
        getUserById: vi.fn(async () => ({ id: 1, isAdmin: true })) as never,
      }),
    )
    const adminBody = await (await authedRequest(admin, '/api/v1/pipeline/status')).json()
    expect(adminBody).toMatchObject({ running: true, stage: 'resolve', queueLength: 3 })
    expect(adminBody.lastRun.batchId).toBe(42)
  })

  it('includes lastRun when a batch exists', async () => {
    const lastBatch = { id: 42, createdAt: new Date('2024-06-01'), status: 'completed' }
    const app = createApp(
      makeDeps({
        getLastBatch: vi.fn(async () => lastBatch),
        getUserById: vi.fn(async () => ({ id: 1, isAdmin: true })) as never,
      }),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lastRun).toBeDefined()
    expect(body.lastRun.batchId).toBe(42)
    expect(body.lastRun.status).toBe('completed')
  })
})

describe('POST /api/v1/pipeline/cancel', () => {
  it('cancels the in-flight run and returns 202', async () => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/cancel', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.cancelled).toBe(true)
    expect(orchestrator.cancel).toHaveBeenCalledOnce()
  })

  it('returns cancelled: false (202) when nothing is running', async () => {
    const orchestrator = makeMockOrchestrator(false) as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/cancel', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.cancelled).toBe(false)
  })
  it('returns a finishing response when completion has committed', async () => {
    const mock = makeMockOrchestrator(true)
    mock.cancel.mockReturnValue({ cancelled: false })
    const orchestrator = mock as unknown as AppDependencies['orchestrator']
    const app = createApp(makeDeps({ orchestrator }))
    const res = await authedRequest(app, '/api/v1/pipeline/cancel', { method: 'POST' })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ cancelled: false, message: 'Pipeline finishing' })
  })

  it.each([false, true])('passes the caller and admin=%s to the orchestrator', async (isAdmin) => {
    const orchestrator = makeMockOrchestrator(true) as unknown as AppDependencies['orchestrator']
    const getUserById = vi.fn(async () => ({ id: 1, isAdmin })) as never
    const app = createApp(makeDeps({ orchestrator, getUserById }))
    await authedRequest(app, '/api/v1/pipeline/cancel', { method: 'POST' })
    expect(orchestrator.cancel).toHaveBeenCalledWith(1, { canStopOthers: isAdmin })
  })

  it("returns 403 when the caller may not stop another user's run", async () => {
    const mock = makeMockOrchestrator(true)
    mock.cancel.mockReturnValue({ cancelled: false, dequeued: 0, forbidden: true } as never)
    const app = createApp(
      makeDeps({ orchestrator: mock as unknown as AppDependencies['orchestrator'] }),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/cancel', { method: 'POST' })
    expect(res.status).toBe(403)
  })
})
describe('GET /api/v1/pipeline/events', () => {
  it('returns text/event-stream content type', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/pipeline/events')
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })
})

describe('POST /api/v1/pipeline/quick-discover', () => {
  it.each([1, 2])(
    'passes the resolved response locale and cooldown owner for user %s',
    async (userId) => {
      const getRecommendations = vi
        .fn()
        .mockResolvedValue([
          { artistName: 'Similar Artist', confidence: 0.8, reasoning: 'Shared style' },
        ])
      const getRejectedMbids = vi.fn(async () => new Set<string>())
      const deps = makeDeps({
        getUserCount: vi.fn(async () => 1),
        getUserById: vi.fn(async () => ({
          id: userId,
          username: 'test',
          isAdmin: false,
          preferredLocale: 'de',
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
        })),
        providerRegistry: {
          create: vi.fn().mockResolvedValue({
            getRecommendations,
            testConnection: vi.fn(),
          }),
          register: vi.fn(),
          has: vi.fn().mockReturnValue(true),
          availableIds: vi.fn().mockReturnValue(['anthropic', 'openai', 'ollama']),
        } as unknown as AppDependencies['providerRegistry'],
        getSettings: vi.fn(
          async () =>
            ({
              id: 1,
              lidarrUrl: null,
              lidarrApiKey: null,
              aiProvider: 'openai',
              aiModel: 'gpt-4o-mini',
              aiApiKey: 'test-key',
              aiBaseUrl: null,
              preferences: null,
            }) as SettingsRow,
        ),
        storeDb: {
          getExistingRecommendationMbids: vi.fn(async () => new Set<string>()),
          getRejectedMbids,
          getBlockedMbids: vi.fn(async () => new Set<string>()),
          getFeedbackHistory: vi.fn(async () => new Map()),
        } as unknown as AppDependencies['storeDb'],
      })
      const app = createApp(deps)

      const { createSession } = await import('@/core/sessions')
      await createSession(userId, 'session-token')

      const res = await authedRequest(app, '/api/v1/pipeline/quick-discover', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer session-token',
          'Content-Type': 'application/json',
          'X-Digarr-Locale': 'fr',
        },
        body: JSON.stringify({ artistName: 'Boards of Canada' }),
      })

      expect(res.status).toBe(200)
      await vi.waitFor(() => {
        expect(getRecommendations).toHaveBeenCalledWith(
          expect.objectContaining({
            responseLocale: 'fr',
            promptLocale: null,
          }),
        )
      })
      await vi.waitFor(() => expect(deps.jobRecorder?.complete).toHaveBeenCalledOnce())
      expect(deps.jobRecorder?.fail).not.toHaveBeenCalled()
      expect(getRejectedMbids).toHaveBeenCalledExactlyOnceWith(
        DEFAULT_PREFERENCES.rejectionCooldownDays,
        userId,
      )
    },
  )

  it('does not let an ambiguous latin-script artist name override the resolved locale', async () => {
    const getRecommendations = vi.fn().mockResolvedValue([])
    const deps = makeDeps({
      getUserCount: vi.fn(async () => 1),
      getUserById: vi.fn(async () => ({
        id: 1,
        username: 'test',
        isAdmin: false,
        preferredLocale: 'de',
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
      })),
      providerRegistry: {
        create: vi.fn().mockResolvedValue({
          getRecommendations,
          testConnection: vi.fn(),
        }),
        register: vi.fn(),
        has: vi.fn().mockReturnValue(true),
        availableIds: vi.fn().mockReturnValue(['anthropic', 'openai', 'ollama']),
      } as unknown as AppDependencies['providerRegistry'],
      getSettings: vi.fn(
        async () =>
          ({
            id: 1,
            lidarrUrl: null,
            lidarrApiKey: null,
            aiProvider: 'openai',
            aiModel: 'gpt-4o-mini',
            aiApiKey: 'test-key',
            aiBaseUrl: null,
            preferences: null,
          }) as SettingsRow,
      ),
      storeDb: {
        getExistingRecommendationMbids: vi.fn(async () => new Set<string>()),
        getRejectedMbids: vi.fn(async () => new Set<string>()),
        getBlockedMbids: vi.fn(async () => new Set<string>()),
        getFeedbackHistory: vi.fn(async () => new Map()),
      } as unknown as AppDependencies['storeDb'],
    })
    const app = createApp(deps)

    const { createSession } = await import('@/core/sessions')
    await createSession(1, 'session-token')

    const res = await authedRequest(app, '/api/v1/pipeline/quick-discover', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
        'X-Digarr-Locale': 'fr',
      },
      body: JSON.stringify({ artistName: 'Mañana' }),
    })

    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(getRecommendations).toHaveBeenCalledWith(
        expect.objectContaining({
          responseLocale: 'fr',
          promptLocale: null,
        }),
      )
    })
    await vi.waitFor(() => expect(deps.jobRecorder?.complete).toHaveBeenCalledOnce())
    expect(deps.jobRecorder?.fail).not.toHaveBeenCalled()
  })

  it('keeps responseLocale on the resolved UI locale when promptLocale differs', async () => {
    const getRecommendations = vi.fn().mockResolvedValue([])
    const deps = makeDeps({
      getUserCount: vi.fn(async () => 1),
      getUserById: vi.fn(async () => ({
        id: 1,
        username: 'test',
        isAdmin: false,
        preferredLocale: 'de',
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
      })),
      providerRegistry: {
        create: vi.fn().mockResolvedValue({
          getRecommendations,
          testConnection: vi.fn(),
        }),
        register: vi.fn(),
        has: vi.fn().mockReturnValue(true),
        availableIds: vi.fn().mockReturnValue(['anthropic', 'openai', 'ollama']),
      } as unknown as AppDependencies['providerRegistry'],
      getSettings: vi.fn(
        async () =>
          ({
            id: 1,
            lidarrUrl: null,
            lidarrApiKey: null,
            aiProvider: 'openai',
            aiModel: 'gpt-4o-mini',
            aiApiKey: 'test-key',
            aiBaseUrl: null,
            preferences: null,
          }) as SettingsRow,
      ),
      storeDb: {
        getExistingRecommendationMbids: vi.fn(async () => new Set<string>()),
        getRejectedMbids: vi.fn(async () => new Set<string>()),
        getBlockedMbids: vi.fn(async () => new Set<string>()),
        getFeedbackHistory: vi.fn(async () => new Map()),
      } as unknown as AppDependencies['storeDb'],
    })
    const app = createApp(deps)

    const { createSession } = await import('@/core/sessions')
    await createSession(1, 'session-token')

    const res = await authedRequest(app, '/api/v1/pipeline/quick-discover', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
        'X-Digarr-Locale': 'fr',
      },
      body: JSON.stringify({ artistName: 'jazz nocturno' }),
    })

    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(getRecommendations).toHaveBeenCalledWith(
        expect.objectContaining({
          responseLocale: 'fr',
          promptLocale: 'es',
        }),
      )
    })
    await vi.waitFor(() => expect(deps.jobRecorder?.complete).toHaveBeenCalledOnce())
    expect(deps.jobRecorder?.fail).not.toHaveBeenCalled()
  })
})

describe('quick-discover seed policy and completed storage counts', () => {
  const seedMbid = 'seed-mbid'

  beforeEach(async () => {
    const actual =
      await vi.importActual<typeof import('@/core/pipeline/store')>('@/core/pipeline/store')
    vi.mocked(store).mockImplementation(actual.store)
    vi.mocked(resolve).mockImplementation(async (artists) =>
      artists.map((artist) => ({
        mbid: artist.name === 'Seed Artist' ? seedMbid : artist.name,
        name: artist.name,
        tags: [],
        genres: [],
        streamingUrls: {},
        discoveries: [artist],
      })),
    )
  })

  afterEach(() => {
    vi.mocked(store).mockReset().mockResolvedValue(1)
    vi.mocked(resolve).mockReset().mockResolvedValue([])
  })

  function fixture(similarNames: string[] = [], userId = 1) {
    const existing = new Set<string>()
    const batches = new Map<number, { added: number }>()
    const storeDb = {
      getExistingRecommendationMbids: vi.fn(async () => new Set(existing)),
      getLibraryArtistsForUser: vi.fn(async () => []),
      getRejectedMbids: vi.fn(async () => new Set<string>()),
      getBlockedMbids: vi.fn(async () => new Set<string>()),
      getFeedbackHistory: vi.fn(async () => new Map()),
      insertBatch: vi.fn(async () => ({ id: batches.size + 1 })),
      completeBatch: vi.fn(async (id: number, stats: { added: number }) => {
        batches.set(id, stats)
      }),
      failBatch: vi.fn(async () => {}),
      upsertArtistAndRecommendation: vi.fn(async (artist: ResolvedArtist) => {
        existing.add(artist.mbid)
      }),
    }
    const getRecommendations = vi.fn(async () =>
      similarNames.map((artistName) => ({ artistName, confidence: 0.8, reasoning: 'Similar' })),
    )
    const deps = makeDeps({
      getUserCount: vi.fn(async () => 1),
      getUserById: vi.fn(
        async () =>
          ({
            id: userId,
            preferences: {
              rejectionCooldownDays: 17,
              scoreThreshold: 0.6,
              scoringWeights: {
                ...DEFAULT_PREFERENCES.scoringWeights,
                similarity: 1,
                consensus: 0,
                genreOverlap: 0,
                aiConfidence: 0,
                feedbackBoost: 0,
                popularity: 0,
              },
            },
          }) as never,
      ),
      getSettings: vi.fn(
        async () =>
          ({
            id: 1,
            aiProvider: 'openai',
            aiModel: 'test-model',
            preferences: {
              rejectionCooldownDays: 99,
              scoreThreshold: 1,
            },
          }) as SettingsRow,
      ),
      providerRegistry: {
        create: vi.fn(async () => ({ getRecommendations })),
      } as unknown as AppDependencies['providerRegistry'],
      storeDb: storeDb as unknown as AppDependencies['storeDb'],
      getBatch: vi.fn(async (id) => ({ id, status: 'completed', stats: batches.get(id) }) as never),
    })
    return { deps, storeDb, existing }
  }

  async function run(deps: AppDependencies, failed = false, userId = 1) {
    await createSession(userId, SESSION_TOKEN)
    const response = await createApp(deps).request('/api/v1/pipeline/quick-discover', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistName: 'Seed Artist' }),
    })
    expect(response.status).toBe(200)
    await vi.waitFor(() =>
      expect(failed ? deps.jobRecorder?.fail : deps.jobRecorder?.complete).toHaveBeenCalledOnce(),
    )
    expect(failed ? deps.jobRecorder?.complete : deps.jobRecorder?.fail).not.toHaveBeenCalled()
  }

  it.each(['library', 'existing recommendation', 'block', 'owned cooldown'])(
    'does not store a seed excluded by %s and reads the owner policy',
    async (policy) => {
      const { deps, storeDb, existing } = fixture()
      if (policy === 'library')
        storeDb.getLibraryArtistsForUser.mockResolvedValue([{ mbid: seedMbid } as never])
      if (policy === 'existing recommendation') existing.add(seedMbid)
      if (policy === 'block') storeDb.getBlockedMbids.mockResolvedValue(new Set([seedMbid]))
      if (policy === 'owned cooldown')
        storeDb.getRejectedMbids.mockResolvedValue(new Set([seedMbid]))
      await run(deps)
      expect(storeDb.upsertArtistAndRecommendation).not.toHaveBeenCalled()
      expect(storeDb.getLibraryArtistsForUser).toHaveBeenCalledWith(1, { onlyReconciled: true })
      expect(storeDb.getRejectedMbids).toHaveBeenCalledExactlyOnceWith(17, 1)
      expect(storeDb.getBlockedMbids).toHaveBeenCalledExactlyOnceWith(1)
      expect(storeDb.getExistingRecommendationMbids).toHaveBeenCalledWith(1, {
        rejectionCooldownDays: 17,
      })
      expect(deps.jobRecorder?.complete).toHaveBeenCalledWith(1, {
        metadata: { seedArtist: 'Seed Artist', artistsDiscovered: 0, artistsStored: 0 },
      })
    },
  )

  it.each([
    { names: [], stored: 1 },
    { names: ['Similar Artist'], stored: 2 },
    { names: ['Seed Artist', 'Similar Artist'], stored: 2 },
    { names: ['Below Threshold'], stored: 1 },
  ])(
    'counts eligible writes and keeps direct-add confidence for $names',
    async ({ names, stored }) => {
      const { deps, storeDb } = fixture(names)
      if (names.includes('Below Threshold')) {
        vi.mocked(resolve).mockImplementation(async (artists) =>
          artists.map((artist) => ({
            mbid: artist.name === 'Seed Artist' ? seedMbid : artist.name,
            name: artist.name,
            tags: [],
            genres: [],
            streamingUrls: {},
            discoveries: [{ ...artist, similarityScore: 0.1 }],
          })),
        )
      }
      await run(deps)
      expect(storeDb.upsertArtistAndRecommendation).toHaveBeenCalledTimes(stored)
      expect(storeDb.upsertArtistAndRecommendation).toHaveBeenCalledWith(
        expect.objectContaining({ mbid: seedMbid }),
        expect.objectContaining({ score: 1, userId: 1 }),
      )
      expect(vi.mocked(resolve).mock.calls[0]).toHaveLength(2)
      expect(deps.jobRecorder?.complete).toHaveBeenCalledWith(1, {
        metadata: {
          seedArtist: 'Seed Artist',
          artistsDiscovered: names.length,
          artistsStored: stored,
        },
      })
      expect(deps.getBatch).toHaveBeenCalledTimes(stored === 1 ? 1 : 2)
    },
  )

  it.each([0, 1])('reports %s successful writes when candidate writes fail', async (successful) => {
    const { deps, storeDb } = fixture(['Similar Artist', 'Other Artist'])
    storeDb.upsertArtistAndRecommendation.mockImplementation(async (artist) => {
      if (successful === 0 || artist.name !== 'Similar Artist') throw new Error('write failed')
    })
    await run(deps)
    expect(storeDb.upsertArtistAndRecommendation).toHaveBeenCalledTimes(3)
    expect(deps.jobRecorder?.complete).toHaveBeenCalledWith(1, {
      metadata: { seedArtist: 'Seed Artist', artistsDiscovered: 2, artistsStored: successful },
    })
  })

  it.each([1, 2])(
    'uses only user %s cooldown rather than another user rejection',
    async (userId) => {
      const { deps, storeDb } = fixture([], userId)
      vi.mocked(deps.storeDb.getRejectedMbids).mockImplementation(
        async (_days, owner) => new Set(owner === 1 ? [seedMbid] : []),
      )
      await run(deps, false, userId)
      expect(storeDb.getRejectedMbids).toHaveBeenCalledExactlyOnceWith(17, userId)
      expect(storeDb.upsertArtistAndRecommendation).toHaveBeenCalledTimes(userId === 1 ? 0 : 1)
    },
  )

  it.each([
    'seed policy read',
    'seed batch insert',
    'batch completion',
    'batch read',
    'missing batch',
    'missing stats',
    'negative count',
    'fractional count',
    'string count',
    'infinite count',
    'excess count',
    'unfinished batch',
  ])('fails the job for %s instead of reporting success', async (failure) => {
    const { deps, storeDb } = fixture()
    if (failure === 'seed policy read')
      storeDb.getExistingRecommendationMbids.mockRejectedValue(new Error('read failed'))
    if (failure === 'seed batch insert')
      storeDb.insertBatch.mockRejectedValue(new Error('insert failed'))
    if (failure === 'batch completion')
      storeDb.completeBatch.mockRejectedValue(new Error('completion failed'))
    if (failure === 'batch read')
      vi.mocked(deps.getBatch).mockRejectedValue(new Error('batch read failed'))
    if (failure === 'missing batch') vi.mocked(deps.getBatch).mockResolvedValue(null)
    const invalid = {
      'missing stats': undefined,
      'negative count': { added: -1 },
      'fractional count': { added: 0.5 },
      'string count': { added: '1' },
      'infinite count': { added: Number.POSITIVE_INFINITY },
      'excess count': { added: 2 },
    }
    if (failure in invalid)
      vi.mocked(deps.getBatch).mockResolvedValue({
        status: 'completed',
        stats: invalid[failure as keyof typeof invalid],
      } as never)
    if (failure === 'unfinished batch')
      vi.mocked(deps.getBatch).mockResolvedValue({
        status: 'running',
        stats: { added: 1 },
      } as never)
    await run(deps, true)
  })
})

describe('POST /api/v1/pipeline/rescan', () => {
  const mbid = '00000000-0000-0000-0000-000000000470'

  beforeEach(() => {
    mocks.fetchArtistImage.mockReset()
    mocks.musicBrainzClient.lookupArtist.mockReset()
    mocks.upsertArtist.mockReset()
  })

  function rescanDeps(
    artist: Record<string, unknown>,
    settings: Partial<SettingsRow> = {},
  ): AppDependencies {
    return makeDeps({
      storeDb: {
        tryConsumeRateLimit: vi.fn(async () => true),
      } as unknown as AppDependencies['storeDb'],
      getSettings: vi.fn(
        async () =>
          ({
            id: 1,
            lidarrUrl: 'http://lidarr:8686',
            lidarrApiKey: 'key',
            audiodbApiKey: 'audiodb-key',
            preferences: {
              fanartApiKey: 'fanart-key',
              metadataFallbackUrl: 'https://metadata.example.test',
            },
            ...settings,
          }) as SettingsRow,
      ),
      listRecommendations: vi.fn(async () => ({
        items: [{ artist }],
        total: 1,
      })) as unknown as AppDependencies['listRecommendations'],
      getUserById: vi.fn(async () => ({ isAdmin: true, preferences: null }) as never),
    })
  }

  it('rejects non-admin users before shared artist metadata can be changed', async () => {
    const deps = rescanDeps({
      mbid,
      name: 'Shared Artist',
      imageUrl: null,
      imageFailedAt: null,
    })
    deps.getUserById = vi.fn(async () => ({ isAdmin: false }) as never)
    const app = createApp(deps)

    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(403)
    expect(mocks.fetchArtistImage).not.toHaveBeenCalled()
  })

  it('rejects a concurrent rescan while one is already running', async () => {
    let releaseLookup: (() => void) | undefined
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    mocks.fetchArtistImage.mockImplementation(async () => {
      await lookupGate
      return { failed: true }
    })
    mocks.upsertArtist.mockResolvedValue({})
    const app = createApp(
      rescanDeps({
        mbid,
        name: 'Slow Artist',
        imageUrl: null,
        imageFailedAt: null,
        disambiguation: 'already present',
      }),
    )

    const first = authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })
    await vi.waitFor(() => expect(mocks.fetchArtistImage).toHaveBeenCalledTimes(1))
    const second = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(second.status).toBe(409)
    releaseLookup?.()
    expect((await first).status).toBe(200)
  })

  it('rate-limits repeated rescans from the same admin', async () => {
    mocks.fetchArtistImage.mockResolvedValue({ failed: false })
    const app = createApp(
      rescanDeps({
        mbid,
        name: 'Repeated Rescan Artist',
        imageUrl: null,
        imageFailedAt: null,
        disambiguation: 'already present',
      }),
    )

    const first = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })
    const second = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })
    const third = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(third.status).toBe(429)
  })

  it('uses the configured image fallback chain and refreshes disambiguation', async () => {
    mocks.fetchArtistImage.mockResolvedValue({
      url: 'https://images.example.test/artist.jpg',
      logoUrl: 'https://images.example.test/logo.png',
      failed: false,
    })
    mocks.musicBrainzClient.lookupArtist.mockResolvedValue({
      id: mbid,
      name: 'Fallback Artist',
      disambiguation: 'Berlin electronic duo',
    })
    mocks.upsertArtist.mockResolvedValue({})

    const app = createApp(
      rescanDeps({
        mbid,
        name: 'Fallback Artist',
        imageUrl: null,
        imageFailedAt: null,
        disambiguation: null,
      }),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(mocks.fetchArtistImage).toHaveBeenCalledWith(
      mbid,
      'Fallback Artist',
      mocks.audiodbClient,
      mocks.lidarrClient,
      mocks.fanartClient,
      mocks.musicinfoClient,
    )
    expect(mocks.upsertArtist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mbid,
        imageUrl: 'https://images.example.test/artist.jpg',
        logoUrl: 'https://images.example.test/logo.png',
        disambiguation: 'Berlin electronic duo',
      }),
    )
    expect(await res.json()).toEqual({ attempted: 1, updated: 1, failed: 0, total: 1 })
  })

  it('negative-caches a complete image miss without blocking disambiguation', async () => {
    mocks.fetchArtistImage.mockResolvedValue({ failed: true })
    mocks.musicBrainzClient.lookupArtist.mockResolvedValue({
      id: mbid,
      name: 'Missing Image',
      disambiguation: 'Canadian post-rock band',
    })
    mocks.upsertArtist.mockResolvedValue({})

    const app = createApp(
      rescanDeps(
        {
          mbid,
          name: 'Missing Image',
          imageUrl: null,
          imageFailedAt: null,
          disambiguation: null,
        },
        { preferences: DEFAULT_PREFERENCES },
      ),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(mocks.upsertArtist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mbid,
        disambiguation: 'Canadian post-rock band',
        imageFailed: true,
      }),
    )
    expect(await res.json()).toEqual({ attempted: 1, updated: 0, failed: 1, total: 1 })
  })

  it('does not share a negative cache across user-scoped provider configurations', async () => {
    mocks.fetchArtistImage.mockResolvedValue({ failed: false })
    const recentFailure = new Date().toISOString()

    const app = createApp(
      rescanDeps({
        mbid,
        name: 'User Provider Artist',
        imageUrl: null,
        imageFailedAt: recentFailure,
        disambiguation: 'already present',
      }),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(mocks.fetchArtistImage).toHaveBeenCalledTimes(1)
    expect(mocks.upsertArtist).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ attempted: 1, updated: 0, failed: 1, total: 1 })
  })

  it('reports unexpected per-artist failures without aborting the rescan', async () => {
    mocks.fetchArtistImage.mockRejectedValue(new Error('unexpected image failure'))

    const app = createApp(
      rescanDeps({
        mbid,
        name: 'Retry Later',
        imageUrl: null,
        imageFailedAt: null,
        disambiguation: 'already present',
      }),
    )
    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ attempted: 1, updated: 0, failed: 1, total: 1 })
  })

  it('attempts each artist once when multiple recommendations reference it', async () => {
    mocks.fetchArtistImage.mockResolvedValue({ failed: true })
    mocks.upsertArtist.mockResolvedValue({})
    const artist = {
      mbid,
      name: 'Repeated Artist',
      imageUrl: null,
      imageFailedAt: null,
      disambiguation: 'already present',
    }
    const deps = rescanDeps(artist)
    deps.listRecommendations = vi.fn(async () => ({
      items: [{ artist }, { artist }],
      total: 2,
    })) as unknown as AppDependencies['listRecommendations']
    const app = createApp(deps)

    const res = await authedRequest(app, '/api/v1/pipeline/rescan', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(mocks.fetchArtistImage).toHaveBeenCalledTimes(1)
    expect(await res.json()).toEqual({ attempted: 1, updated: 0, failed: 1, total: 1 })
  })
})
