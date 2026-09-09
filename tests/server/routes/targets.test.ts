// @vitest-environment node

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HonoEnv } from '@/server/types'

const mockDeps = {
  targetQueries: {
    createTarget: vi.fn().mockResolvedValue({ id: 1 }),
    getTargetsByUser: vi.fn().mockResolvedValue([]),
    getAllTargets: vi.fn().mockResolvedValue([]),
    getTarget: vi.fn().mockResolvedValue(null),
    updateTarget: vi.fn().mockResolvedValue(undefined),
    deleteTarget: vi.fn().mockResolvedValue(undefined),
  },
  getUserById: vi.fn().mockResolvedValue({ isAdmin: true }),
  testTargetConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
}

const { targetRoutes } = await import('@/server/routes/targets')

function createTestApp(userId = 1) {
  const app = new Hono<HonoEnv>()
  // Simulate auth middleware setting userId
  app.use('*', async (c, next) => {
    c.set('userId', userId)
    await next()
  })
  app.route('/', targetRoutes(mockDeps as never))
  return app
}

describe('target routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks wipes call history but not implementations; re-assert the
    // admin default so a per-test isAdmin:false override does not leak forward
    // into the adminGuard-protected mutation tests.
    mockDeps.getUserById.mockResolvedValue({ isAdmin: true })
    mockDeps.targetQueries.getTarget.mockResolvedValue(null)
    mockDeps.targetQueries.getAllTargets.mockResolvedValue([])
    mockDeps.targetQueries.getTargetsByUser.mockResolvedValue([])
  })

  it('GET /api/v1/targets returns all targets with ownership flag', async () => {
    mockDeps.targetQueries.getAllTargets.mockResolvedValue([
      {
        id: 1,
        type: 'lidarr',
        name: 'My Lidarr',
        enabled: true,
        userId: 1,
        config: { url: 'http://lidarr:8686', apiKey: 'secret' },
      },
      {
        id: 2,
        type: 'lidarr',
        name: 'Other Lidarr',
        enabled: true,
        userId: 2,
        config: { url: 'http://lidarr2:8686', apiKey: 'other' },
      },
    ])
    const app = createTestApp()
    const res = await app.request('/api/v1/targets')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].type).toBe('lidarr')
    expect(body[0].config.apiKey).toBe('***')
    expect(body[0].owned).toBe(true)
    expect(body[1].owned).toBe(false)
  })

  it('GET /api/v1/targets scopes a non-admin to their own targets only', async () => {
    // The non-admin caller (userId 2) must never receive another user's target.
    mockDeps.getUserById.mockResolvedValue({ isAdmin: false })
    mockDeps.targetQueries.getTargetsByUser.mockResolvedValue([
      {
        id: 2,
        type: 'lidarr',
        name: 'My Own Lidarr',
        enabled: true,
        userId: 2,
        config: { url: 'http://mine:8686', apiKey: 'mine-secret' },
      },
    ])
    // If the handler ever calls getAllTargets for a non-admin, this leak payload
    // would surface in the response and fail the regression assertions below.
    mockDeps.targetQueries.getAllTargets.mockResolvedValue([
      {
        id: 99,
        type: 'lidarr',
        name: 'Admin Secret Lidarr',
        enabled: true,
        userId: 1,
        config: { url: 'http://other-user-host:8686', apiKey: 'leak' },
      },
    ])
    const app = createTestApp(2)
    const res = await app.request('/api/v1/targets')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].userId).toBe(2)
    expect(body[0].owned).toBe(true)
    expect(mockDeps.targetQueries.getTargetsByUser).toHaveBeenCalledWith(2)
    expect(mockDeps.targetQueries.getAllTargets).not.toHaveBeenCalled()
    // Regression guard: no field from another user's target may serialize.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('other-user-host')
    expect(raw).not.toContain('Admin Secret Lidarr')
    expect(raw).not.toContain('leak')
  })

  it('GET /api/v1/targets masks secrets in the non-admin owned list', async () => {
    mockDeps.getUserById.mockResolvedValue({ isAdmin: false })
    mockDeps.targetQueries.getTargetsByUser.mockResolvedValue([
      {
        id: 2,
        type: 'lidarr',
        name: 'My Own Lidarr',
        enabled: true,
        userId: 2,
        config: { url: 'http://mine:8686', apiKey: 'mine-secret' },
      },
    ])
    const app = createTestApp(2)
    const res = await app.request('/api/v1/targets')
    const body = await res.json()
    expect(body[0].config.apiKey).toBe('***')
    expect(JSON.stringify(body)).not.toContain('mine-secret')
  })

  it('POST /api/v1/targets creates a target', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'lidarr',
        name: 'My Lidarr',
        config: { url: 'http://lidarr:8686', apiKey: 'abc' },
      }),
    })
    expect(res.status).toBe(201)
    expect(mockDeps.targetQueries.createTarget).toHaveBeenCalled()
  })

  it('POST /api/v1/targets assigns a target to an existing user', async () => {
    mockDeps.getUserById.mockImplementation(async (id: number) => ({ isAdmin: id === 1 }))
    const res = await createTestApp().request('/api/v1/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'lidarr', name: 'Assigned', config: {}, userId: 2 }),
    })
    expect(res.status).toBe(201)
    expect(mockDeps.targetQueries.createTarget).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 2 }),
    )
  })

  it('POST /api/v1/targets rejects an unknown assigned user', async () => {
    mockDeps.getUserById.mockImplementation(async (id: number) =>
      id === 1 ? { isAdmin: true } : null,
    )
    const res = await createTestApp().request('/api/v1/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'lidarr', name: 'Assigned', config: {}, userId: 99 }),
    })
    expect(res.status).toBe(404)
    expect(mockDeps.targetQueries.createTarget).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { id: 12, type: 'lidarr', enabled: true, userId: 1 },
    { id: 12, type: 'lidarr', enabled: false, userId: 2 },
    { id: 12, type: 'slskd', enabled: true, userId: 2 },
  ])('rejects an invalid assigned slskd Lidarr link on create: %j', async (linked) => {
    mockDeps.targetQueries.getTarget.mockResolvedValue(linked)
    const res = await createTestApp().request('/api/v1/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'slskd',
        name: 'Assigned',
        userId: 2,
        config: { lidarrTargetId: 12 },
      }),
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'errors.target.notFound' })
    expect(mockDeps.targetQueries.createTarget).not.toHaveBeenCalled()
  })

  it('allows an assigned slskd target linked to its owner enabled Lidarr', async () => {
    mockDeps.targetQueries.getTarget.mockResolvedValue({
      id: 12,
      type: 'lidarr',
      enabled: true,
      userId: 2,
    })
    const res = await createTestApp().request('/api/v1/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'slskd',
        name: 'Assigned',
        userId: 2,
        config: { lidarrTargetId: 12 },
      }),
    })
    expect(res.status).toBe(201)
  })

  it.each([{ userId: 2 }, { config: { lidarrTargetId: 13 } }])(
    'rejects slskd patches that leave a cross-user linkage: %j',
    async (patch) => {
      mockDeps.targetQueries.getTarget.mockImplementation(
        async (id: number) =>
          ({
            71: { id: 71, type: 'slskd', userId: 1, config: { lidarrTargetId: 12 } },
            12: { id: 12, type: 'lidarr', userId: 1, enabled: true },
            13: { id: 13, type: 'lidarr', userId: 2, enabled: true },
          })[id] ?? null,
      )
      const res = await createTestApp().request('/api/v1/targets/71', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      expect(res.status).toBe(404)
      expect(mockDeps.targetQueries.updateTarget).not.toHaveBeenCalled()
    },
  )

  it('POST /api/v1/targets validates required fields', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No type' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/v1/targets validates type is known', async () => {
    const app = createTestApp()
    const res = await app.request('/api/v1/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'unknown', name: 'Bad', config: {} }),
    })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/v1/targets/:id deletes a target', async () => {
    mockDeps.targetQueries.getTarget.mockResolvedValue({
      id: 1,
      userId: 1,
      type: 'lidarr',
    })
    const app = createTestApp()
    const res = await app.request('/api/v1/targets/1', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(mockDeps.targetQueries.deleteTarget).toHaveBeenCalledWith(1)
  })

  it('DELETE /api/v1/targets/:id returns 404 for missing target', async () => {
    mockDeps.targetQueries.getTarget.mockResolvedValue(null)
    const app = createTestApp()
    const res = await app.request('/api/v1/targets/999', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  it("allows an admin to delete another user's target", async () => {
    mockDeps.targetQueries.getTarget.mockImplementation(async (id: number) =>
      id === 1 ? { id: 1, userId: 1, type: 'lidarr' } : null,
    )

    const missing = await createTestApp(1).request('/api/v1/targets/999', { method: 'DELETE' })
    const crossUser = await createTestApp(2).request('/api/v1/targets/1', { method: 'DELETE' })

    expect(missing.status).toBe(404)
    expect(crossUser.status).toBe(204)
    expect(missing.headers.get('content-type')).toContain('application/problem+json')
    expect(mockDeps.targetQueries.deleteTarget).toHaveBeenCalledWith(1)
  })

  it('POST /api/v1/targets/:id/test tests connection', async () => {
    mockDeps.targetQueries.getTarget.mockResolvedValue({
      id: 1,
      userId: 1,
      type: 'lidarr',
      config: { url: 'http://lidarr:8686', apiKey: 'abc' },
    })
    const app = createTestApp()
    const res = await app.request('/api/v1/targets/1/test', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('allows an admin to update, delete, and test an assigned target', async () => {
    mockDeps.targetQueries.getTarget.mockResolvedValue({
      id: 1,
      userId: 2,
      type: 'lidarr',
      config: { apiKey: 'saved' },
    })
    const app = createTestApp()
    const update = await app.request('/api/v1/targets/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    })
    const test = await app.request('/api/v1/targets/1/test', { method: 'POST' })
    const remove = await app.request('/api/v1/targets/1', { method: 'DELETE' })
    expect(update.status).toBe(204)
    expect(test.status).toBe(200)
    expect(remove.status).toBe(204)
  })

  it('denies non-admin mutations and testing for another user target', async () => {
    mockDeps.getUserById.mockResolvedValue({ isAdmin: false })
    mockDeps.targetQueries.getTarget.mockResolvedValue({ id: 1, userId: 1, type: 'lidarr' })
    const app = createTestApp(2)
    const update = await app.request('/api/v1/targets/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    })
    const remove = await app.request('/api/v1/targets/1', { method: 'DELETE' })
    const test = await app.request('/api/v1/targets/1/test', { method: 'POST' })
    expect(update.status).toBe(403)
    expect(remove.status).toBe(403)
    expect(test.status).toBe(404)
  })

  it('PATCH /api/v1/targets/:id updates a target', async () => {
    mockDeps.targetQueries.getTarget.mockResolvedValue({
      id: 1,
      userId: 1,
      type: 'lidarr',
    })
    const app = createTestApp()
    const res = await app.request('/api/v1/targets/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Lidarr' }),
    })
    expect(res.status).toBe(204)
    expect(mockDeps.targetQueries.updateTarget).toHaveBeenCalledWith(1, { name: 'Updated Lidarr' })
  })

  it('PATCH /api/v1/targets/:id preserves masked and omitted secrets', async () => {
    mockDeps.targetQueries.getTarget.mockResolvedValue({
      id: 1,
      userId: 1,
      type: 'lidarr',
      config: { url: 'http://lidarr:8686', apiKey: 'saved-secret', token: 'saved-token' },
    })
    const res = await createTestApp().request('/api/v1/targets/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { url: 'http://new-lidarr:8686', apiKey: '***' } }),
    })
    expect(res.status).toBe(204)
    expect(mockDeps.targetQueries.updateTarget).toHaveBeenCalledWith(1, {
      config: {
        url: 'http://new-lidarr:8686',
        apiKey: 'saved-secret',
        token: 'saved-token',
      },
    })
  })
})
