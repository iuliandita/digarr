// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createTestApp } from '../helpers/test-app'

vi.mock('@/core/sessions', () => ({
  getSession: vi.fn().mockResolvedValue({
    userId: 1,
    token: 'tok',
    expiresAt: new Date(Date.now() + 86400000),
  }),
}))

function authHeaders() {
  return {
    Authorization: 'Bearer tok',
    'Content-Type': 'application/json',
  }
}

describe('API routes: discovery mode subscriptions', () => {
  it('creates a discovery mode subscription with saved easy or advanced state', async () => {
    const createSubscription = vi.fn(async (data: Record<string, unknown>) => ({
      id: 1,
      ...data,
      enabled: true,
      maxArtistsPerRun: null,
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

    const res = await app.request('/api/subscriptions', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Weekly Label Hunt',
        sourceType: 'discovery-mode',
        sourceProvider: 'labels',
        sourceConfig: {
          modeId: 'labels',
          settingsMode: 'advanced',
          settings: { seedArtists: ['Broadcast'], depth: 2 },
        },
        cron: '0 8 * * 1',
      }),
    })

    expect(res.status).toBe(201)
    expect(createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'discovery-mode',
        sourceProvider: 'labels',
        sourceConfig: {
          modeId: 'labels',
          settingsMode: 'advanced',
          settings: { seedArtists: ['Broadcast'], depth: 2 },
        },
      }),
    )
  })

  it('lists discovery mode as an available adapter type', async () => {
    const { app } = createTestApp()

    const res = await app.request('/api/subscriptions/adapter-types', {
      headers: { Authorization: 'Bearer tok' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'discovery-mode',
          label: 'Discovery Mode',
          configFields: [],
        }),
      ]),
    )
  })
})
