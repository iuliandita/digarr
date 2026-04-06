// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LibrarySourceRegistry } from '@/core/library/sources/registry'
import type { LibrarySource } from '@/core/library/sources/types'

function makeSource(id: string, mbidQuality: 'high' | 'low' = 'high'): LibrarySource {
  return {
    id,
    name: id,
    capabilities: ['listArtists'],
    userId: null,
    mbidQuality,
    listArtists: async () => [],
    testConnection: async () => ({ success: true, message: 'ok' }),
  }
}

describe('LibrarySourceRegistry', () => {
  it('registers and retrieves sources by id', () => {
    const reg = new LibrarySourceRegistry()
    const lidarr = makeSource('lidarr')
    reg.register(lidarr)
    expect(reg.get('lidarr')).toBe(lidarr)
  })

  it('returns all sources sorted by mbidQuality desc (high first)', () => {
    const reg = new LibrarySourceRegistry()
    reg.register(makeSource('plex', 'low'))
    reg.register(makeSource('lidarr', 'high'))
    reg.register(makeSource('jellyfin', 'high'))
    const ordered = reg.allOrdered()
    expect(ordered.map((s) => s.id)).toEqual(['lidarr', 'jellyfin', 'plex'])
  })

  it('returns empty array when no sources registered', () => {
    const reg = new LibrarySourceRegistry()
    expect(reg.allOrdered()).toEqual([])
  })

  it('clear removes all sources', () => {
    const reg = new LibrarySourceRegistry()
    reg.register(makeSource('lidarr'))
    reg.clear()
    expect(reg.allOrdered()).toEqual([])
  })
})
