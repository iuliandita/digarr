// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { createReleaseGroupCache } from '@/core/clients/release-group-cache'
import { createAlbumCoverageService } from '@/core/library/album-coverage'

vi.mock('p-queue', () => ({
  default: class {
    add(fn: () => unknown) {
      return fn()
    }
  },
}))

const catalog = ['Album', 'EP', 'Single'].map((type) => ({
  id: `rg-${type}`,
  title: type,
  'primary-type': type,
  'secondary-types': [],
}))
const response = (groups = catalog) =>
  new Response(
    JSON.stringify({
      'release-groups': groups,
      'release-group-count': groups.length,
      'release-group-offset': 0,
    }),
  )
const upstream = vi.fn()
beforeEach(() => {
  upstream.mockReset().mockImplementation(async () => response())
  vi.stubGlobal('fetch', upstream)
})

afterEach(() => vi.useRealTimers())

describe('shared release-group catalog cache', () => {
  it('hits across clients within TTL, expires at 24 hours, and isolates returned objects', async () => {
    let now = 0
    const cache = createReleaseGroupCache({ now: () => now })
    const a = createMusicBrainzClient({ releaseGroupCache: cache })
    const b = createMusicBrainzClient({ releaseGroupCache: cache })
    const first = await a.getReleaseGroups('artist')
    if (first[0]) first[0].title = 'mutated'
    expect((await b.getReleaseGroups('artist'))[0]?.title).toBe('Album')
    expect(upstream).toHaveBeenCalledTimes(1)
    now = 24 * 60 * 60 * 1000
    await b.getReleaseGroups('artist')
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('shares the default superset with album-only coverage while ownership stays per user', async () => {
    const client = createMusicBrainzClient({ releaseGroupCache: createReleaseGroupCache() })
    const listOwnedAlbumsForArtist = vi.fn(async () => [])
    const coverage = createAlbumCoverageService({
      mbClient: client,
      store: { listOwnedAlbumsForArtist },
    })
    expect((await coverage.getCoverageForArtist(1, 'artist')).totalCount).toBe(1)
    expect((await client.getReleaseGroups('artist')).map((group) => group.type)).toEqual([
      'Album',
      'EP',
      'Single',
    ])
    await coverage.getCoverageForArtist(2, 'artist')
    expect(listOwnedAlbumsForArtist.mock.calls).toEqual([
      [1, 'artist'],
      [2, 'artist'],
    ])
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(new URL(upstream.mock.calls[0]?.[0]).searchParams.get('type')).toBe('album|ep|single')
  })

  it('coalesces concurrent callers with different requested types', async () => {
    const cache = createReleaseGroupCache()
    const [albums, all] = await Promise.all([
      createMusicBrainzClient({ releaseGroupCache: cache }).getReleaseGroups('artist', ['album']),
      createMusicBrainzClient({ releaseGroupCache: cache }).getReleaseGroups('artist'),
    ])
    expect(albums).toHaveLength(1)
    expect(all).toHaveLength(3)
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it.each(['404', '503', 'timeout', 'partial', 'malformed'])(
    'does not cache %s results',
    async (failure) => {
      const client = createMusicBrainzClient({ releaseGroupCache: createReleaseGroupCache() })
      if (failure === '404') upstream.mockResolvedValueOnce(new Response('', { status: 404 }))
      if (failure === '503' || failure === 'timeout') {
        vi.useFakeTimers()
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (failure === '503') upstream.mockResolvedValueOnce(new Response('', { status: 503 }))
          else upstream.mockRejectedValueOnce(new DOMException('request timed out', 'AbortError'))
        }
      }
      if (failure === 'partial') {
        upstream.mockResolvedValueOnce(
          new Response(JSON.stringify({ 'release-groups': catalog, 'release-group-count': 4 })),
        )
        upstream.mockResolvedValueOnce(
          new Response(JSON.stringify({ 'release-groups': [], 'release-group-count': 4 })),
        )
      }
      if (failure === 'malformed') upstream.mockResolvedValueOnce(new Response('{}'))
      if (failure === 'malformed') expect(await client.getReleaseGroups('artist')).toEqual([])
      else {
        const assertion = expect(client.getReleaseGroups('artist')).rejects.toThrow()
        if (failure === '503' || failure === 'timeout') await vi.runAllTimersAsync()
        await assertion
      }
      if (failure === '503' || failure === 'timeout') expect(upstream).toHaveBeenCalledTimes(4)
      const before = upstream.mock.calls.length
      expect(await client.getReleaseGroups('artist')).toHaveLength(3)
      expect(upstream).toHaveBeenCalledTimes(before + 1)
    },
  )

  it('bypasses cached entries for forced reads and unsupported types', async () => {
    const client = createMusicBrainzClient({ releaseGroupCache: createReleaseGroupCache() })
    await client.getReleaseGroups('artist')
    await client.getReleaseGroups('artist', undefined, { bypassCache: true })
    await client.getReleaseGroups('artist', ['broadcast'])
    await client.getReleaseGroups('artist', ['broadcast'])
    expect(upstream).toHaveBeenCalledTimes(4)
    expect(new URL(upstream.mock.calls[2]?.[0]).searchParams.get('type')).toBe('broadcast')
  })

  it('evicts the least recently used artist at its entry limit', async () => {
    const client = createMusicBrainzClient({
      releaseGroupCache: createReleaseGroupCache({ maxEntries: 2 }),
    })
    for (const artist of ['a', 'b', 'a', 'c', 'a', 'b']) await client.getReleaseGroups(artist)
    expect(upstream).toHaveBeenCalledTimes(4)
  })

  it('reduces upstream requests for two simulated Discover loads of eight artists', async () => {
    const artists = Array.from({ length: 8 }, (_, i) => `artist-${i}`)
    const uncached = createMusicBrainzClient({
      releaseGroupCache: createReleaseGroupCache({ maxEntries: 0 }),
    })
    const cached = createMusicBrainzClient({ releaseGroupCache: createReleaseGroupCache() })
    const load = async (client: ReturnType<typeof createMusicBrainzClient>) => {
      for (const artist of artists) {
        await client.getReleaseGroups(artist, ['album'])
        await client.getReleaseGroups(artist)
      }
    }
    await load(uncached)
    await load(uncached)
    expect(upstream).toHaveBeenCalledTimes(32)
    upstream.mockClear()
    await load(cached)
    expect(upstream).toHaveBeenCalledTimes(8)
    await load(cached)
    expect(upstream).toHaveBeenCalledTimes(8)
  })
})
