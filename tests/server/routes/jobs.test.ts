// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jobRoutes } from '@/server/routes/jobs'
import type { HonoEnv } from '@/server/types'

// Mock getSession so auth middleware doesn't block us
vi.mock('@/core/sessions', () => ({
  getSession: vi.fn().mockResolvedValue({
    userId: 1,
    token: 'tok',
    expiresAt: new Date(Date.now() + 86400000),
  }),
}))

function makeMockDeps(overrides: Record<string, unknown> = {}) {
  return {
    getUserById: vi.fn().mockResolvedValue({ id: 1, isAdmin: true }),
    scheduler: { nextRun: null as Date | null },
    jobQueries: {
      listJobs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getJobById: vi.fn().mockResolvedValue(null),
      getJobHealth: vi.fn().mockResolvedValue({
        pipeline: { status: 'ok', lastRun: null, nextRun: null },
        subscriptions: { status: 'ok', healthy: 0, total: 0 },
        playlists: { status: 'ok', lastRun: null },
        sources: {},
      }),
    },
    ...overrides,
  }
}

function createApp(deps: ReturnType<typeof makeMockDeps>) {
  const app = new Hono<HonoEnv>()
  // Simulate auth middleware setting userId
  app.use('*', async (c, next) => {
    c.set('userId', 1)
    return next()
  })
  app.route('/', jobRoutes(deps as never))
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/jobs', () => {
  it('returns paginated job list', async () => {
    const deps = makeMockDeps()
    deps.jobQueries.listJobs.mockResolvedValue({
      items: [{ id: 1, type: 'pipeline', status: 'completed' }],
      total: 1,
    })
    const app = createApp(deps)
    const res = await app.request('/api/jobs')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('passes filter params to listJobs', async () => {
    const deps = makeMockDeps()
    const app = createApp(deps)
    await app.request('/api/jobs?type=pipeline&status=failed&limit=10&offset=5')
    expect(deps.jobQueries.listJobs).toHaveBeenCalledWith({
      type: 'pipeline',
      status: 'failed',
      limit: 10,
      offset: 5,
    })
  })

  it('caps limit at 100', async () => {
    const deps = makeMockDeps()
    const app = createApp(deps)
    await app.request('/api/jobs?limit=999')
    expect(deps.jobQueries.listJobs).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }))
  })

  it('clamps limit to 1 and offset to 0 for negative values', async () => {
    const deps = makeMockDeps()
    const app = createApp(deps)
    await app.request('/api/jobs?limit=-10&offset=-5')
    expect(deps.jobQueries.listJobs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1, offset: 0 }),
    )
  })

  it('accepts library_sync as a valid job type filter', async () => {
    const deps = makeMockDeps()
    const app = createApp(deps)
    await app.request('/api/jobs?type=library_sync')
    expect(deps.jobQueries.listJobs).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'library_sync' }),
    )
  })

  it('returns 400 for an invalid type filter', async () => {
    const deps = makeMockDeps()
    const app = createApp(deps)
    const res = await app.request('/api/jobs?type=bogus')
    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid status filter', async () => {
    const deps = makeMockDeps()
    const app = createApp(deps)
    const res = await app.request('/api/jobs?status=bogus')
    expect(res.status).toBe(400)
  })

  it('returns 403 for non-admin', async () => {
    const deps = makeMockDeps({
      getUserById: vi.fn().mockResolvedValue({ id: 2, isAdmin: false }),
    })
    const app = createApp(deps)
    const res = await app.request('/api/jobs')
    expect(res.status).toBe(403)
  })
})

describe('GET /api/jobs/health', () => {
  it('returns health summary', async () => {
    const deps = makeMockDeps()
    const app = createApp(deps)
    const res = await app.request('/api/jobs/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pipeline).toBeDefined()
    expect(body.sources).toBeDefined()
  })

  it('passes scheduler.nextRun to getJobHealth', async () => {
    const nextRun = new Date('2026-04-06T00:00:00Z')
    const deps = makeMockDeps({ scheduler: { nextRun } })
    const app = createApp(deps)
    await app.request('/api/jobs/health')
    expect(deps.jobQueries.getJobHealth).toHaveBeenCalledWith(nextRun)
  })
})

describe('GET /api/jobs/:id', () => {
  it('returns 404 for unknown job', async () => {
    const deps = makeMockDeps()
    const app = createApp(deps)
    const res = await app.request('/api/jobs/999')
    expect(res.status).toBe(404)
  })

  it('returns job when found', async () => {
    const deps = makeMockDeps()
    deps.jobQueries.getJobById.mockResolvedValue({ id: 1, type: 'pipeline', status: 'completed' })
    const app = createApp(deps)
    const res = await app.request('/api/jobs/1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(1)
  })

  it('returns 400 for non-numeric id', async () => {
    const deps = makeMockDeps()
    const app = createApp(deps)
    const res = await app.request('/api/jobs/abc')
    expect(res.status).toBe(400)
  })
})
