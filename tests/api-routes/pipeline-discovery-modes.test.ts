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

  it('normalizes the request and starts a discovery mode run', async () => {
    const runDiscoveryMode = vi.fn(async () => ({ batchId: 123 }))
    const discoveryModeRegistry = new DiscoveryModeRegistry()
    discoveryModeRegistry.register({
      id: 'labels',
      label: 'Labels',
      description: 'Label-based discovery',
      availability: 'strict',
      easyFields: [],
      advancedFields: [],
      executor: vi.fn(async () => ({ candidates: [] })),
    })

    const { app } = createTestApp({
      discoveryModeRegistry,
      runDiscoveryMode,
    } as never)

    const res = await app.request('/api/discovery-modes/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modeId: 'labels',
        settingsMode: 'easy',
        rawUserSettings: { seedArtists: ['Broadcast'] },
        normalizedSettings: { seedArtists: ['Broadcast'] },
        providerContext: { providerPath: ['discogs', 'labels'] },
        fallbackPolicy: 'allow-fallback',
      }),
    })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ batchId: 123 })
    expect(runDiscoveryMode).toHaveBeenCalledWith(
      expect.objectContaining({
        modeId: 'labels',
        userId: 1,
        triggerType: 'manual',
      }),
    )
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

  it('returns 500 when discovery mode execution fails', async () => {
    const runDiscoveryMode = vi.fn(async () => {
      throw new Error('execution failed')
    })
    const discoveryModeRegistry = new DiscoveryModeRegistry()
    discoveryModeRegistry.register({
      id: 'labels',
      label: 'Labels',
      description: 'Label-based discovery',
      availability: 'strict',
      easyFields: [],
      advancedFields: [],
      executor: vi.fn(async () => ({ candidates: [] })),
    })

    const { app } = createTestApp({
      discoveryModeRegistry,
      runDiscoveryMode,
    } as never)

    const res = await app.request('/api/discovery-modes/run', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modeId: 'labels',
        settingsMode: 'easy',
        rawUserSettings: { seedArtists: ['Broadcast'] },
        normalizedSettings: { seedArtists: ['Broadcast'] },
        providerContext: { providerPath: ['discogs', 'labels'] },
        fallbackPolicy: 'allow-fallback',
      }),
    })

    expect(res.status).toBe(500)
  })
})
