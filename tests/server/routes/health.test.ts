import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
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
    isSetupComplete: async () => true,
    getSettings: vi.fn(async () => null),
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

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})

describe('setup guard', () => {
  it('blocks /api/* with 403 when setup is not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/api/something')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Setup not complete')
    expect(body.redirect).toBe('/setup')
  })

  it('allows /api/setup/* through when setup is not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/api/setup/status')
    expect(res.status).not.toBe(403)
  })

  it('allows /health through when setup is not complete', async () => {
    const app = createApp(makeDeps({ isSetupComplete: async () => false }))
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })

  it('allows /api/* through when setup is complete', async () => {
    const app = createApp(makeDeps())
    // No route registered for this path -- expect 404, not 403
    const res = await app.request('/api/something')
    expect(res.status).not.toBe(403)
  })
})
