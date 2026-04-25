// @vitest-environment node

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createSession } from '@/core/sessions'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'

function makeMockOrchestrator() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, { isRunning: false, run: vi.fn(async () => ({ batchId: 1 })) })
}

function makeDeps(
  overrides: Partial<AppDependencies> = {},
  settings: Partial<SettingsRow> = {},
): AppDependencies {
  return {
    db: {} as unknown as AppDependencies['db'],
    storeDb: {} as unknown as AppDependencies['storeDb'],
    orchestrator: makeMockOrchestrator() as unknown as AppDependencies['orchestrator'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    isSetupComplete: async () => true,
    getSettings: vi.fn(
      async () => ({ id: 1, audiodbProxyImages: false, ...settings }) as SettingsRow,
    ),
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
    createUser: vi.fn(async () => ({}) as never),
    getUserByUsername: vi.fn(async () => null),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 1),
    updatePassword: vi.fn(async () => {}),
    updateUserPreferredLocale: vi.fn(async () => {}),
    genreService: {} as unknown as AppDependencies['genreService'],
    libraryHealth: {} as unknown as AppDependencies['libraryHealth'],
    librarySync: {} as unknown as AppDependencies['librarySync'],
    librarySyncStore: {} as unknown as AppDependencies['librarySyncStore'],
    targetQueries: {} as unknown as AppDependencies['targetQueries'],
    testTargetConnection: vi.fn(async () => ({ success: true, message: 'ok' })),
    getEnabledTargetsForUser: vi.fn(async () => []),
    subscriptionQueries: {} as unknown as AppDependencies['subscriptionQueries'],
    runSubscription: vi.fn(async () => {}),
    getOidcService: vi.fn(async () => null),
    getUserByOidcSubject: vi.fn(async () => null),
    getUserByEmail: vi.fn(async () => null),
    updateUser: vi.fn(async () => {}),
    listUsers: vi.fn(async () => []),
    deleteUser: vi.fn(async () => {}),
    getFeedbackHistory: vi.fn(async () => new Map()),
    dashboardQueries: {} as unknown as AppDependencies['dashboardQueries'],
    jobRecorder: {
      start: vi.fn().mockResolvedValue(1),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      markStuck: vi.fn().mockResolvedValue(0),
    },
    jobQueries: {} as unknown as AppDependencies['jobQueries'],
    ...overrides,
  }
}

const SESSION = 'media-proxy-session'

async function authedReq(app: ReturnType<typeof createApp>, url: string): Promise<Response> {
  await createSession(1, SESSION)
  return app.request(url, { headers: { Authorization: `Bearer ${SESSION}` } })
}

describe('GET /api/v1/media/image-proxy', () => {
  it('returns 404 when audiodbProxyImages=false (feature gated)', async () => {
    const app = createApp(makeDeps({}, { audiodbProxyImages: false }))
    const res = await authedReq(
      app,
      '/api/v1/media/image-proxy?src=https://img.theaudiodb.com/x.jpg',
    )
    expect(res.status).toBe(404)
  })

  it('rejects host not on allowlist', async () => {
    const app = createApp(makeDeps({}, { audiodbProxyImages: true }))
    const res = await authedReq(app, '/api/v1/media/image-proxy?src=https://evil.example.com/x.jpg')
    expect(res.status).toBe(400)
  })

  it('rejects private IP target', async () => {
    const app = createApp(makeDeps({}, { audiodbProxyImages: true }))
    const res = await authedReq(app, '/api/v1/media/image-proxy?src=http://169.254.169.254/meta')
    expect(res.status).toBe(400)
  })

  it('rejects non-http protocol', async () => {
    const app = createApp(makeDeps({}, { audiodbProxyImages: true }))
    const res = await authedReq(app, '/api/v1/media/image-proxy?src=file:///etc/passwd')
    expect(res.status).toBe(400)
  })

  it('returns 400 when src missing', async () => {
    const app = createApp(makeDeps({}, { audiodbProxyImages: true }))
    const res = await authedReq(app, '/api/v1/media/image-proxy')
    expect(res.status).toBe(400)
  })
})
