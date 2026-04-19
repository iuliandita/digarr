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

function releaseRadarSnapshot() {
  return {
    hasListenBrainz: false,
    hasSpotify: false,
    hasLastfm: true,
    hasDiscogs: false,
    hasLibrarySync: false,
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
      getDiscoveryConnectionSnapshot: vi.fn().mockResolvedValue(releaseRadarSnapshot()),
      subscriptionQueries: {
        createSubscription,
        getSubscription: vi.fn(async () => null),
        getSubscriptionsByUser: vi.fn(async () => []),
        getEnabledSubscriptions: vi.fn(async () => []),
        updateSubscription: vi.fn(),
        deleteSubscription: vi.fn(),
      },
    })

    const res = await app.request('/api/v1/subscriptions', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Weekly Label Hunt',
        sourceType: 'discovery-mode',
        sourceProvider: 'release-radar',
        sourceConfig: {
          modeId: 'release-radar',
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
        sourceProvider: 'release-radar',
        sourceConfig: {
          modeId: 'release-radar',
          settingsMode: 'advanced',
          settings: { seedArtists: ['Broadcast'], depth: 2 },
          providerContext: { providerPath: ['lastfm'] },
          fallbackPolicy: 'allow-fallback',
        },
      }),
    )
  })

  it('canonicalizes discovery mode modeId whitespace before create persistence', async () => {
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
      getDiscoveryConnectionSnapshot: vi.fn().mockResolvedValue(releaseRadarSnapshot()),
      subscriptionQueries: {
        createSubscription,
        getSubscription: vi.fn(async () => null),
        getSubscriptionsByUser: vi.fn(async () => []),
        getEnabledSubscriptions: vi.fn(async () => []),
        updateSubscription: vi.fn(),
        deleteSubscription: vi.fn(),
      },
    })

    const res = await app.request('/api/v1/subscriptions', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Whitespace Labels',
        sourceType: 'discovery-mode',
        sourceProvider: 'release-radar',
        sourceConfig: {
          modeId: ' release-radar ',
          settingsMode: 'advanced',
          settings: { seedArtists: ['Broadcast'] },
        },
        cron: '0 8 * * 1',
      }),
    })

    expect(res.status).toBe(201)
    expect(createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceConfig: expect.objectContaining({
          modeId: 'release-radar',
          providerContext: { providerPath: ['lastfm'] },
          fallbackPolicy: 'allow-fallback',
        }),
      }),
    )
  })

  it('rejects unshipped discovery mode subscriptions even when the mode exists in the registry', async () => {
    const createSubscription = vi.fn()
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

    const res = await app.request('/api/v1/subscriptions', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Label Hunt',
        sourceType: 'discovery-mode',
        sourceProvider: 'labels',
        sourceConfig: {
          modeId: 'labels',
          settingsMode: 'advanced',
          settings: { seedArtists: ['Broadcast'] },
        },
        cron: '0 8 * * 1',
      }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'This mode is not implemented yet.' })
    expect(createSubscription).not.toHaveBeenCalled()
  })

  it('rejects malformed discovery mode subscriptions that omit mode-specific config', async () => {
    const createSubscription = vi.fn()
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

    const res = await app.request('/api/v1/subscriptions', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Broken Label Hunt',
        sourceType: 'discovery-mode',
        sourceProvider: 'labels',
        sourceConfig: {
          settingsMode: 'advanced',
          settings: { seedArtists: ['Broadcast'] },
        },
        cron: '0 8 * * 1',
      }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'discovery-mode sourceConfig.modeId is required' })
    expect(createSubscription).not.toHaveBeenCalled()
  })

  it('rejects discovery mode subscriptions with an unknown modeId', async () => {
    const createSubscription = vi.fn()
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

    const res = await app.request('/api/v1/subscriptions', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Unknown Mode Hunt',
        sourceType: 'discovery-mode',
        sourceProvider: 'labels',
        sourceConfig: {
          modeId: 'not-a-real-mode',
          settingsMode: 'advanced',
          settings: { seedArtists: ['Broadcast'] },
        },
        cron: '0 8 * * 1',
      }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "Unknown discovery mode 'not-a-real-mode'",
    })
    expect(createSubscription).not.toHaveBeenCalled()
  })

  it('revalidates discovery mode sourceConfig on patch', async () => {
    const updateSubscription = vi.fn()
    const { app } = createTestApp({
      getDiscoveryConnectionSnapshot: vi.fn().mockResolvedValue(releaseRadarSnapshot()),
      subscriptionQueries: {
        createSubscription: vi.fn(),
        getSubscription: vi.fn(
          async () =>
            ({
              id: 1,
              userId: 1,
              name: 'Weekly Label Hunt',
              enabled: true,
              sourceType: 'discovery-mode',
              sourceProvider: 'release-radar',
              sourceConfig: {
                modeId: 'release-radar',
                settingsMode: 'advanced',
                settings: { seedArtists: ['Broadcast'] },
                providerContext: { providerPath: ['lastfm'] },
                fallbackPolicy: 'allow-fallback',
              },
              maxArtistsPerRun: 20,
              listenerRange: null,
              cron: '0 8 * * 1',
              action: 'add_to_recommendations',
              scoreThreshold: null,
              scoringWeightPreset: null,
              scoringWeightOverrides: null,
              lastRunAt: null,
              lastResultCount: null,
              lastError: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }) as never,
        ),
        getSubscriptionsByUser: vi.fn(async () => []),
        getEnabledSubscriptions: vi.fn(async () => []),
        updateSubscription,
        deleteSubscription: vi.fn(),
      },
    })

    const res = await app.request('/api/v1/subscriptions/1', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({
        sourceConfig: {
          modeId: 'release-radar',
          settingsMode: 'advanced',
        },
      }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'discovery-mode sourceConfig.settings is required',
    })
    expect(updateSubscription).not.toHaveBeenCalled()
  })

  it('canonicalizes discovery mode modeId whitespace on patch before persistence', async () => {
    const updateSubscription = vi.fn()
    const { app } = createTestApp({
      getDiscoveryConnectionSnapshot: vi.fn().mockResolvedValue(releaseRadarSnapshot()),
      subscriptionQueries: {
        createSubscription: vi.fn(),
        getSubscription: vi.fn(
          async () =>
            ({
              id: 1,
              userId: 1,
              name: 'Weekly Label Hunt',
              enabled: true,
              sourceType: 'discovery-mode',
              sourceProvider: 'release-radar',
              sourceConfig: {
                modeId: 'release-radar',
                settingsMode: 'advanced',
                settings: { seedArtists: ['Broadcast'] },
                providerContext: { providerPath: ['lastfm'] },
                fallbackPolicy: 'allow-fallback',
              },
              maxArtistsPerRun: 20,
              listenerRange: null,
              cron: '0 8 * * 1',
              action: 'add_to_recommendations',
              scoreThreshold: null,
              scoringWeightPreset: null,
              scoringWeightOverrides: null,
              lastRunAt: null,
              lastResultCount: null,
              lastError: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }) as never,
        ),
        getSubscriptionsByUser: vi.fn(async () => []),
        getEnabledSubscriptions: vi.fn(async () => []),
        updateSubscription,
        deleteSubscription: vi.fn(),
      },
    })

    const res = await app.request('/api/v1/subscriptions/1', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({
        sourceConfig: {
          modeId: ' release-radar ',
          settingsMode: 'advanced',
          settings: { seedArtists: ['Broadcast'] },
        },
      }),
    })

    expect(res.status).toBe(204)
    expect(updateSubscription).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        sourceConfig: expect.objectContaining({
          modeId: 'release-radar',
          providerContext: { providerPath: ['lastfm'] },
          fallbackPolicy: 'allow-fallback',
        }),
      }),
    )
  })

  it('lists discovery mode as an available adapter type', async () => {
    const { app } = createTestApp()

    const res = await app.request('/api/v1/subscriptions/adapter-types', {
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
