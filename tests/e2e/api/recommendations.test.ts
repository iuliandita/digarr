// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { makeRecommendation } from '../../helpers/factories'
import { createTestApp } from '../../helpers/test-app'

vi.mock('@/core/sessions', () => ({
  getSession: vi.fn().mockResolvedValue({
    userId: 1,
    token: 'tok',
    expiresAt: new Date(Date.now() + 86400000),
  }),
}))

describe('E2E: recommendations list', () => {
  it('returns paginated recommendations', async () => {
    const rec = makeRecommendation({ status: 'pending' })
    const { app } = createTestApp({
      listRecommendations: vi.fn(async () => ({ items: [rec], total: 1 })) as never,
    })

    const res = await app.request('/api/recommendations', {
      headers: { Authorization: 'Bearer tok' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
  })
})

describe('E2E: approve/reject', () => {
  it('rejects a recommendation', async () => {
    const rec = makeRecommendation({ id: 2, status: 'pending' })
    const { app, deps } = createTestApp({
      getRecommendation: vi.fn(async () => rec) as never,
      filterOwnedIds: vi.fn(async (ids: number[]) => ids),
    })

    const res = await app.request('/api/recommendations/2', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok',
      },
      body: JSON.stringify({ status: 'rejected' }),
    })
    expect(res.status).toBe(200)
    // Rejection calls updateRecommendationStatus with only (id, status) -- no extra arg
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(2, 'rejected')
  })

  it('returns 400 for invalid status', async () => {
    const { app } = createTestApp()

    const res = await app.request('/api/recommendations/1', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok',
      },
      body: JSON.stringify({ status: 'invalid_status' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 when recommendation does not exist', async () => {
    const { app } = createTestApp({
      getRecommendation: vi.fn(async () => null),
    })

    const res = await app.request('/api/recommendations/999', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok',
      },
      body: JSON.stringify({ status: 'rejected' }),
    })
    expect(res.status).toBe(404)
  })
})
