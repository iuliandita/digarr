// @vitest-environment node

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppDependencies } from '@/server'
import { batchRoutes } from '@/server/routes/batches'

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    listBatches: vi.fn(async () => []),
    getBatch: vi.fn(async () => null),
    ...overrides,
  } as unknown as AppDependencies
}

function makeApp(deps: AppDependencies) {
  const app = new Hono()
  app.route('/', batchRoutes(deps))
  return app
}

describe('GET /api/v1/batches/:id', () => {
  it('rejects fractional ids before querying', async () => {
    const getBatch = vi.fn(async () => null)
    const app = makeApp(makeDeps({ getBatch }))

    const res = await app.request('/api/v1/batches/1.5')

    expect(res.status).toBe(400)
    expect(getBatch).not.toHaveBeenCalled()
  })
})
