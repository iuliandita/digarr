// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
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
    isSetupComplete: async () => true,
    getSettings: vi.fn(async () => mockSettings as Record<string, unknown>),
    updateSettings: vi.fn(async () => {}),
    completeSetup: vi.fn(async () => ({ id: 1, setupComplete: true })),
    getLastBatch: vi.fn(async () => null),
    listRecommendations: vi.fn(async () => ({ items: [], total: 0 })),
    getRecommendation: vi.fn(async () => null),
    updateRecommendationStatus: vi.fn(async () => {}),
    bulkUpdateStatus: vi.fn(async () => {}),
    listBatches: vi.fn(async () => []),
    getBatch: vi.fn(async () => null),
    getArtistById: vi.fn(async () => null),
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
    const getSettings = vi.fn(async () => updatedSettings as Record<string, unknown>)
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
