// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

const mockDeps = {
  listRecommendations: vi.fn().mockResolvedValue({
    items: [
      {
        id: 1,
        score: 0.92,
        status: 'pending',
        aiReasoning: 'Good match',
        createdAt: '2026-03-20T00:00:00Z',
        recommendedReleaseGroupTitle: null,
        artist: {
          name: 'Radiohead',
          mbid: 'mbid-rh',
          genres: ['rock'],
          imageUrl: null,
          streamingUrls: {},
        },
      },
    ],
    total: 1,
  }),
}

const { exportRoutes } = await import('@/server/routes/exports')

function createTestApp() {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    c.set('userId', 1)
    await next()
  })
  app.route('/', exportRoutes(mockDeps as never))
  return app
}

describe('export routes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /api/v1/exports/json returns JSON with correct content-type', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/exports/json')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const body = await res.json()
    expect(body).toHaveLength(1)
  })

  it('GET /api/v1/exports/csv returns CSV with correct content-type', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/exports/csv')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    const text = await res.text()
    expect(text).toContain('artist,mbid')
  })

  it('GET /api/v1/exports/m3u returns M3U with correct content-type', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/exports/m3u')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/x-mpegurl')
    const text = await res.text()
    expect(text).toContain('#EXTM3U')
  })

  it('GET /api/v1/exports/xspf returns XSPF with correct content-type', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/exports/xspf')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/xspf+xml')
    const text = await res.text()
    expect(text).toContain('<?xml')
    expect(text).toContain('xspf.org')
  })

  it('returns 400 for unknown format', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/exports/xml')
    expect(res.status).toBe(400)
  })

  it('supports status filter query param', async () => {
    const app = createTestApp()
    await app.request('/api/v1/exports/json?status=approved')
    expect(mockDeps.listRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' }),
    )
  })

  it('supports batchId filter query param', async () => {
    const app = createTestApp()
    await app.request('/api/v1/exports/json?batchId=5')
    expect(mockDeps.listRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 5 }),
    )
  })

  it('returns 400 for an invalid batchId filter', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/exports/json?batchId=not-a-number')

    expect(res.status).toBe(400)
    expect(mockDeps.listRecommendations).not.toHaveBeenCalled()
  })
})
