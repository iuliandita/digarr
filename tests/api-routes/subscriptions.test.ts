// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { makeSubscription } from '../helpers/factories'
import { createTestApp } from '../helpers/test-app'

vi.mock('@/core/sessions', () => ({
  getSession: vi.fn().mockResolvedValue({
    userId: 1,
    token: 'tok',
    expiresAt: new Date(Date.now() + 86400000),
  }),
}))

describe('API routes: subscription CRUD', () => {
  it('creates a subscription', async () => {
    const createSubscription = vi.fn(async (data: Record<string, unknown>) => ({
      id: 1,
      ...data,
      enabled: true,
      maxArtistsPerRun: 20,
      lastRunAt: null,
      lastResultCount: null,
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })) as never
    const { app } = createTestApp({
      subscriptionQueries: {
        createSubscription,
        getSubscription: vi.fn(async () => null),
        getSubscriptionsByUser: vi.fn(async () => []),
        getEnabledSubscriptions: vi.fn(async () => []),
        updateSubscription: vi.fn(),
        deleteSubscription: vi.fn(),
      },
    })

    const createRes = await app.request('/api/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok',
      },
      body: JSON.stringify({
        name: 'Test Sub',
        sourceType: 'lastfm',
        sourceProvider: 'lastfm',
        sourceConfig: { username: 'test' },
        cron: '0 0 * * 0',
      }),
    })
    expect(createRes.status).toBe(201)
    expect(createSubscription).toHaveBeenCalled()
  })

  it('returns 400 for missing required fields', async () => {
    const { app } = createTestApp()

    const res = await app.request('/api/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok',
      },
      body: JSON.stringify({ name: 'Incomplete' }),
    })
    expect(res.status).toBe(400)
  })

  it('lists subscriptions for user', async () => {
    const sub = makeSubscription({ userId: 1 })
    const { app } = createTestApp({
      subscriptionQueries: {
        createSubscription: vi.fn(),
        getSubscription: vi.fn(async () => null),
        getSubscriptionsByUser: vi.fn(async () => [sub] as never),
        getEnabledSubscriptions: vi.fn(async () => []),
        updateSubscription: vi.fn(),
        deleteSubscription: vi.fn(),
      },
    })

    const listRes = await app.request('/api/v1/subscriptions', {
      headers: { Authorization: 'Bearer tok' },
    })
    expect(listRes.status).toBe(200)
    const body = await listRes.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
  })
})

describe('API routes: subscription run', () => {
  it('triggers subscription run', async () => {
    const sub = makeSubscription({ id: 1, userId: 1 })
    const runSubscription = vi.fn(async () => {})
    const { app } = createTestApp({
      subscriptionQueries: {
        createSubscription: vi.fn(),
        getSubscription: vi.fn(async () => sub as never),
        getSubscriptionsByUser: vi.fn(async () => [sub] as never),
        getEnabledSubscriptions: vi.fn(async () => [sub] as never),
        updateSubscription: vi.fn(),
        deleteSubscription: vi.fn(),
      },
      runSubscription,
    })

    const runRes = await app.request('/api/v1/subscriptions/1/run', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
    expect([200, 202]).toContain(runRes.status)
    expect(runSubscription).toHaveBeenCalledWith(1)
  })

  it('returns 404 when subscription does not exist', async () => {
    const { app } = createTestApp({
      subscriptionQueries: {
        createSubscription: vi.fn(),
        getSubscription: vi.fn(async () => null),
        getSubscriptionsByUser: vi.fn(async () => []),
        getEnabledSubscriptions: vi.fn(async () => []),
        updateSubscription: vi.fn(),
        deleteSubscription: vi.fn(),
      },
    })

    const runRes = await app.request('/api/v1/subscriptions/999/run', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
    expect(runRes.status).toBe(404)
  })
})
