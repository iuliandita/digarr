// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { DiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import { createTestApp } from '../helpers/test-app'

vi.mock('@/core/sessions', () => ({
  getSession: vi.fn().mockResolvedValue({
    userId: 1,
    token: 'test-token',
    expiresAt: new Date(Date.now() + 86400000),
  }),
}))

describe('API routes: discovery mode pipeline runs', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp()

    const res = await app.request('/api/discovery-modes/run', {
      method: 'POST',
      body: JSON.stringify({ modeId: 'labels' }),
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(401)
  })

  it('normalizes the request and starts a background discovery mode run', async () => {
    let resolveRun: (() => void) | undefined
    const runDiscoveryMode = vi.fn(
      () =>
        new Promise<{ batchId: number }>((resolve) => {
          resolveRun = () => resolve({ batchId: 123 })
        }),
    )
    const discoveryModeRegistry = new DiscoveryModeRegistry()
    discoveryModeRegistry.register({
      id: 'release-radar',
      label: 'Release Radar',
      description: 'Release-based discovery',
      availability: 'strict',
      easyFields: [],
      advancedFields: [],
      executor: vi.fn(async () => ({ candidates: [] })),
    })

    const { app } = createTestApp({
      discoveryModeRegistry,
      getDiscoveryConnectionSnapshot: vi.fn().mockResolvedValue({
        hasListenBrainz: false,
        hasSpotify: false,
        hasLastfm: true,
        hasDiscogs: false,
        hasLibrarySync: false,
      }),
      runDiscoveryMode,
    } as never)

    const res = await app.request('/api/discovery-modes/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modeId: 'release-radar',
        settingsMode: 'easy',
        rawUserSettings: { seedArtists: ['Broadcast'] },
        normalizedSettings: { seedArtists: ['Broadcast'] },
        providerContext: { providerPath: ['spotify'] },
        fallbackPolicy: 'strict',
      }),
    })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ message: 'Discovery run started' })
    expect(runDiscoveryMode).toHaveBeenCalledWith(
      expect.objectContaining({
        modeId: 'release-radar',
        userId: 1,
        triggerType: 'manual',
        providerContext: { providerPath: ['lastfm'] },
        fallbackPolicy: 'allow-fallback',
      }),
    )

    resolveRun?.()
  })

  it('rejects discovery modes that are currently unavailable', async () => {
    const { app } = createTestApp()

    const res = await app.request('/api/discovery-modes/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modeId: 'labels',
        settingsMode: 'easy',
      }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'This mode is not shipped yet.' })
  })

  it('returns 400 for request validation failures', async () => {
    const discoveryModeRegistry = new DiscoveryModeRegistry()
    const { app } = createTestApp({
      discoveryModeRegistry,
    } as never)

    const res = await app.request('/api/discovery-modes/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settingsMode: 'easy',
      }),
    })

    expect(res.status).toBe(400)
  })

  it('returns 202 immediately and logs background failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runDiscoveryMode = vi.fn(async () => {
      throw new Error('execution failed')
    })
    const discoveryModeRegistry = new DiscoveryModeRegistry()
    discoveryModeRegistry.register({
      id: 'release-radar',
      label: 'Release Radar',
      description: 'Release-based discovery',
      availability: 'strict',
      easyFields: [],
      advancedFields: [],
      executor: vi.fn(async () => ({ candidates: [] })),
    })

    const { app } = createTestApp({
      discoveryModeRegistry,
      getDiscoveryConnectionSnapshot: vi.fn().mockResolvedValue({
        hasListenBrainz: false,
        hasSpotify: false,
        hasLastfm: true,
        hasDiscogs: false,
        hasLibrarySync: false,
      }),
      runDiscoveryMode,
    } as never)

    const res = await app.request('/api/discovery-modes/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modeId: 'release-radar',
        settingsMode: 'easy',
        rawUserSettings: { seedArtists: ['Broadcast'] },
        normalizedSettings: { seedArtists: ['Broadcast'] },
        providerContext: { providerPath: ['spotify'] },
        fallbackPolicy: 'strict',
      }),
    })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ message: 'Discovery run started' })
    await Promise.resolve()
    expect(consoleError).toHaveBeenCalledWith(
      'Discovery mode run failed:',
      expect.objectContaining({ message: 'execution failed' }),
    )
    consoleError.mockRestore()
  })
})
