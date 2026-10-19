import { describe, expect, it, vi } from 'vitest'
import { dropUnaddableAlbums } from '@/core/pipeline/album-profile-filter'
import type { DestinationTarget } from '@/core/targets/types'
import type { ResolvedArtist } from '@/core/types'

function candidate(overrides: Partial<ResolvedArtist>): ResolvedArtist {
  return {
    mbid: 'a1',
    name: 'Artist',
    tags: [],
    genres: [],
    streamingUrls: {},
    discoveries: [],
    ...overrides,
  }
}

const compilation = candidate({
  kind: 'album',
  releaseGroupMbid: 'rg-comp',
  releaseGroupTypes: { primaryType: 'Album', secondaryTypes: ['Compilation'] },
})
const studio = candidate({
  kind: 'album',
  releaseGroupMbid: 'rg-studio',
  releaseGroupTypes: { primaryType: 'Album', secondaryTypes: [] },
})
const untyped = candidate({ kind: 'album', releaseGroupMbid: 'rg-unknown' })
const artist = candidate({ mbid: 'a2' })
const all = [compilation, studio, untyped, artist]

function lidarr(unaddable: Promise<Set<string>>): DestinationTarget {
  return {
    id: 'lidarr-1',
    name: 'Lidarr',
    type: 'lidarr',
    capabilities: ['addArtist', 'addAlbum'],
    unaddableAlbums: vi.fn(() => unaddable),
    testConnection: vi.fn(),
  }
}

describe('dropUnaddableAlbums', () => {
  it('drops albums the Lidarr target reports as unaddable and only sends typed albums', async () => {
    const target = lidarr(Promise.resolve(new Set(['rg-comp'])))
    const kept = await dropUnaddableAlbums(all, async () => [target])
    expect(kept).toEqual([studio, untyped, artist])
    expect(target.unaddableAlbums).toHaveBeenCalledWith([
      { artistMbid: 'a1', releaseGroupMbid: 'rg-comp', types: compilation.releaseGroupTypes },
      { artistMbid: 'a1', releaseGroupMbid: 'rg-studio', types: studio.releaseGroupTypes },
    ])
  })

  it.each([
    ['no target loader', undefined],
    ['no Lidarr target', async () => [] as DestinationTarget[]],
    [
      'a failing target loader',
      async (): Promise<DestinationTarget[]> => Promise.reject(new Error('db')),
    ],
    ['a failing profile check', async () => [lidarr(Promise.reject(new Error('HTTP 503')))]],
  ])('keeps every candidate with %s', async (_label, getTargets) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await dropUnaddableAlbums(all, getTargets)).toEqual(all)
  })

  it('keeps an album that another Lidarr target can add', async () => {
    const kept = await dropUnaddableAlbums(all, async () => [
      lidarr(Promise.resolve(new Set(['rg-comp']))),
      lidarr(Promise.resolve(new Set<string>())),
    ])
    expect(kept).toEqual(all)
  })
})
