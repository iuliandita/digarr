import { describe, expect, it, vi } from 'vitest'
import { dismissUnaddableAlbums } from '@/core/pipeline/dismiss-unaddable-albums'
import type { DestinationTarget } from '@/core/targets/types'

const pending = [
  { id: 1, artistMbid: 'a1', releaseGroupMbid: 'rg-comp' },
  { id: 2, artistMbid: 'a1', releaseGroupMbid: 'rg-studio' },
  { id: 3, artistMbid: 'a1', releaseGroupMbid: 'rg-unknown' },
  { id: 4, artistMbid: 'a1', releaseGroupMbid: 'rg-error' },
]

const types = { primaryType: 'Album', secondaryTypes: ['Compilation'] }

function lidarr(rejected: string[], id = 'lidarr-1'): DestinationTarget {
  return {
    id,
    name: 'Lidarr',
    type: 'lidarr',
    capabilities: ['addArtist', 'addAlbum'],
    lookupAlbumTypes: vi.fn(async (rg: string) => {
      if (rg === 'rg-unknown') return null
      if (rg === 'rg-error') throw new Error('HTTP 503')
      return types
    }),
    unaddableAlbums: vi.fn(async () => new Set(rejected)),
    albumProfileMessage: vi.fn(async () => 'Compilation releases are not allowed'),
    testConnection: vi.fn(),
  }
}

function setup(rows = pending, markResult = true) {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return {
    listPendingAlbumRecommendations: vi.fn(async () => rows),
    markRecommendationUnaddable: vi.fn(async () => markResult),
  }
}

describe('dismissUnaddableAlbums', () => {
  it('dismisses profile-rejected albums and keeps unknown-type and lookup-error rows', async () => {
    const db = setup()
    const target = lidarr(['rg-comp'])
    const count = await dismissUnaddableAlbums(db, 7, async () => [target])
    expect(count).toBe(1)
    expect(db.listPendingAlbumRecommendations).toHaveBeenCalledWith(7, 200)
    expect(db.markRecommendationUnaddable).toHaveBeenCalledExactlyOnceWith(
      1,
      'Compilation releases are not allowed',
    )
    expect(target.unaddableAlbums).toHaveBeenCalledWith([
      { artistMbid: 'a1', releaseGroupMbid: 'rg-comp', types },
      { artistMbid: 'a1', releaseGroupMbid: 'rg-studio', types },
    ])
  })

  it('keeps an album that another Lidarr target can add', async () => {
    const db = setup()
    const count = await dismissUnaddableAlbums(db, 7, async () => [
      lidarr(['rg-comp'], 'a'),
      lidarr([], 'b'),
    ])
    expect(count).toBe(0)
    expect(db.markRecommendationUnaddable).not.toHaveBeenCalled()
  })

  it.each([
    ['no target loader', undefined],
    ['no Lidarr target', async () => [] as DestinationTarget[]],
    ['a failing target loader', async () => Promise.reject(new Error('db'))],
    [
      'a failing profile check',
      async () => [{ ...lidarr([]), unaddableAlbums: vi.fn().mockRejectedValue(new Error('x')) }],
    ],
  ])('leaves everything pending with %s', async (_label, getTargets) => {
    const db = setup()
    expect(await dismissUnaddableAlbums(db, 7, getTargets)).toBe(0)
    expect(db.markRecommendationUnaddable).not.toHaveBeenCalled()
  })

  it('does not count a row that was acted on before the guarded update', async () => {
    const db = setup(pending, false)
    expect(await dismissUnaddableAlbums(db, 7, async () => [lidarr(['rg-comp'])])).toBe(0)
    expect(db.markRecommendationUnaddable).toHaveBeenCalledTimes(1)
  })
})
