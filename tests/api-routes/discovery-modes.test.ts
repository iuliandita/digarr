// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultDiscoveryModeRegistry,
  DiscoveryModeRegistry,
} from '@/core/discovery-modes/registry'
import type { DiscoveryModeDefinition } from '@/core/discovery-modes/types'
import { createTestApp } from '../helpers/test-app'

vi.mock('@/core/sessions', () => ({
  getSession: vi.fn().mockResolvedValue({
    userId: 1,
    token: 'test-token',
    expiresAt: new Date(Date.now() + 86400000),
  }),
}))

function fakeDiscoveryRegistry() {
  const registry = new DiscoveryModeRegistry()

  const modes: DiscoveryModeDefinition[] = [
    {
      id: 'listenbrainz',
      label: 'ListenBrainz',
      description: 'Discover from ListenBrainz activity.',
      availability: 'strict',
      easyFields: [],
      advancedFields: [],
      executor: async () => ({ candidates: [] }),
    },
  ]

  for (const mode of modes) {
    registry.register(mode)
  }

  return registry
}

describe('API routes: discovery modes', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = createTestApp({
      discoveryModeRegistry: fakeDiscoveryRegistry(),
    })

    const res = await app.request('/api/discovery-modes')

    expect(res.status).toBe(401)
  })

  it('lists discovery modes with availability metadata', async () => {
    const { app } = createTestApp({
      discoveryModeRegistry: fakeDiscoveryRegistry(),
      getDiscoveryConnectionSnapshot: vi.fn().mockResolvedValue({
        hasListenBrainz: false,
        hasSpotify: true,
        hasLastfm: false,
        hasDiscogs: true,
        hasLibrarySync: true,
      }),
    })

    const res = await app.request('/api/discovery-modes', {
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.modes[0].availability).toMatchObject({ enabled: false })
  })

  it('surfaces shipped ListenBrainz radio modes as enabled when ListenBrainz is connected', async () => {
    const { app } = createTestApp({
      discoveryModeRegistry: createDefaultDiscoveryModeRegistry(),
      getDiscoveryConnectionSnapshot: vi.fn().mockResolvedValue({
        hasListenBrainz: true,
        hasSpotify: false,
        hasLastfm: false,
        hasDiscogs: false,
        hasLibrarySync: false,
      }),
    })

    const res = await app.request('/api/discovery-modes', {
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    const byId = Object.fromEntries(
      body.modes.map((mode: { id: string; availability: { enabled: boolean } }) => [mode.id, mode]),
    )

    for (const modeId of [
      'lb-artist-radio',
      'lb-user-radio',
      'similar-users-deep',
      'lb-tag-radio',
    ]) {
      expect(byId[modeId].availability.enabled).toBe(true)
    }
  })

  it('uses the shipped discovery mode registry by default', async () => {
    const { app } = createTestApp({
      discoveryModeRegistry: createDefaultDiscoveryModeRegistry(),
    })

    const res = await app.request('/api/discovery-modes', {
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.modes.length).toBeGreaterThan(0)
    expect(body.modes.some((mode: { id: string }) => mode.id === 'labels')).toBe(true)
  })
})
