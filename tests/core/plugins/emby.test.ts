// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/core/clients/emby', () => ({
  createEmbyClient: vi.fn(() => ({
    getTopArtists: vi.fn().mockResolvedValue([{ name: 'Autechre', playCount: 14 }]),
    getFavoriteArtists: vi.fn().mockResolvedValue([]),
    getRecentlyPlayed: vi
      .fn()
      .mockResolvedValue([
        { artistName: 'Autechre', trackName: 'Gantz Graf', datePlayed: '2025-01-01T00:00:00.000Z' },
      ]),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  })),
}))

const { createEmbySource } = await import('@/core/plugins/emby')

describe('createEmbySource', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes topArtists and recentListening capabilities', async () => {
    const source = createEmbySource('http://emby:8096', 'key', 'user-1')
    expect(source.capabilities).toEqual(['topArtists', 'recentListening'])
    await expect(source.getTopArtists(10)).resolves.toHaveLength(1)
    await expect(source.getRecentListening?.(5)).resolves.toHaveLength(1)
  })
})
