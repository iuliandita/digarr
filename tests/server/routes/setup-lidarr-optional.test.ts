// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

const mockDeps = {
  isSetupComplete: vi.fn().mockResolvedValue(false),
  completeSetup: vi.fn().mockResolvedValue(undefined),
  targetQueries: {
    createTarget: vi.fn().mockResolvedValue({ id: 1 }),
    getTargetsByUser: vi.fn().mockResolvedValue([]),
    getAllTargets: vi.fn().mockResolvedValue([]),
    getTarget: vi.fn().mockResolvedValue(null),
    updateTarget: vi.fn().mockResolvedValue(undefined),
    deleteTarget: vi.fn().mockResolvedValue(undefined),
  },
}

const { setupRoutes } = await import('@/server/routes/setup')

function createTestApp() {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    c.set('userId', 1)
    await next()
  })
  app.route('/', setupRoutes(mockDeps as never))
  return app
}

describe('Lidarr-optional setup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts setup without Lidarr when listening source + AI are provided', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        aiApiKey: 'sk-test',
        listenbrainzUsername: 'user',
        listenbrainzToken: 'token',
      }),
    })
    expect(res.status).toBe(204)
    expect(mockDeps.completeSetup).toHaveBeenCalled()
    // No Lidarr target should be created
    expect(mockDeps.targetQueries.createTarget).not.toHaveBeenCalled()
  })

  it('still requires AI provider and model', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listenbrainzUsername: 'user',
        listenbrainzToken: 'token',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts setup without listening sources', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        aiApiKey: 'sk-test',
      }),
    })
    expect(res.status).toBe(204)
  })

  it('rejects partial Lidarr config (url without apiKey)', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        listenbrainzUsername: 'user',
        listenbrainzToken: 'token',
        lidarrUrl: 'http://lidarr:8686',
        // Missing lidarrApiKey
      }),
    })
    expect(res.status).toBe(400)
  })

  it('creates Lidarr target when Lidarr config provided', async () => {
    const app = createTestApp()
    await app.request('/api/v1/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        listenbrainzUsername: 'user',
        listenbrainzToken: 'token',
        lidarrUrl: 'http://lidarr:8686',
        lidarrApiKey: 'abc123',
      }),
    })
    expect(mockDeps.targetQueries.createTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lidarr',
        config: expect.objectContaining({ url: 'http://lidarr:8686' }),
      }),
    )
  })
})
