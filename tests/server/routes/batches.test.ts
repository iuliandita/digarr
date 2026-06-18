// @vitest-environment node

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppDependencies } from '@/server'
import { batchRoutes } from '@/server/routes/batches'
import type { HonoEnv } from '@/server/types'

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    listBatches: vi.fn(async () => []),
    getBatch: vi.fn(async () => null),
    getUserById: vi.fn(async (id: number) => ({ id, isAdmin: id === 1 })),
    ...overrides,
  } as unknown as AppDependencies
}

function makeApp(deps: AppDependencies, opts: { userId?: number; authSkipped?: boolean } = {}) {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    if (opts.userId !== undefined) c.set('userId', opts.userId)
    if (opts.authSkipped) c.set('authSkipped', true)
    await next()
  })
  app.route('/', batchRoutes(deps))
  return app
}

describe('GET /api/v1/batches', () => {
  it('returns 403 for non-admin user', async () => {
    const app = makeApp(makeDeps(), { userId: 2 })
    const res = await app.request('/api/v1/batches')
    expect(res.status).toBe(403)
  })

  it('returns 403 for unauthenticated caller', async () => {
    const app = makeApp(makeDeps())
    const res = await app.request('/api/v1/batches')
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/batches/:id', () => {
  it('rejects fractional ids before querying', async () => {
    const getBatch = vi.fn(async () => null)
    const app = makeApp(makeDeps({ getBatch }), { userId: 1 })

    const res = await app.request('/api/v1/batches/1.5')

    expect(res.status).toBe(400)
    expect(getBatch).not.toHaveBeenCalled()
  })
})
