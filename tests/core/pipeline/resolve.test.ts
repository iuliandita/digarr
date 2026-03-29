// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { MBArtist } from '@/core/clients/musicbrainz'
import { resolve } from '@/core/pipeline/resolve'
import type { DiscoveredArtist } from '@/core/types'

function makeMbArtist(overrides: Partial<MBArtist> = {}): MBArtist {
  return {
    id: 'mbid-default',
    name: 'Test Artist',
    disambiguation: undefined,
    tags: [{ name: 'rock', count: 5 }],
    relations: [
      {
        type: 'streaming music',
        url: { resource: 'https://open.spotify.com/artist/abc' },
      },
    ],
    ...overrides,
  }
}

function makeMb(
  lookupResult?: MBArtist,
  searchResult?: { artists: Array<{ id: string; name: string; score: number }> },
) {
  return {
    lookupArtist: vi.fn().mockResolvedValue(lookupResult ?? makeMbArtist()),
    searchArtist: vi
      .fn()
      .mockResolvedValue(
        searchResult ?? { artists: [{ id: 'mbid-found', name: 'Found Artist', score: 90 }] },
      ),
    extractStreamingUrls: vi
      .fn()
      .mockImplementation((relations: Array<{ type: string; url?: { resource: string } }>) => {
        const result: Record<string, string> = {}
        for (const rel of relations) {
          if (rel.url?.resource?.includes('spotify')) {
            result.spotify = rel.url.resource
          }
        }
        return result
      }),
    getReleaseGroups: undefined as
      | ((
          artistMbid: string,
        ) => Promise<Array<{ id: string; title: string; type: string; firstReleaseDate?: string }>>)
      | undefined,
  }
}

describe('resolve()', () => {
  it('passes through artists that already have MBIDs', async () => {
    const discovered: DiscoveredArtist[] = [
      { name: 'Radiohead', mbid: 'mbid-rh', similarityScore: 0.9, source: 'listenbrainz' },
    ]
    const mb = makeMb(makeMbArtist({ id: 'mbid-rh', name: 'Radiohead' }))

    const result = await resolve(discovered, mb)

    expect(result).toHaveLength(1)
    expect(result[0]?.mbid).toBe('mbid-rh')
    expect(mb.lookupArtist).toHaveBeenCalledWith('mbid-rh')
    expect(mb.searchArtist).not.toHaveBeenCalled()
  })

  it('searches MB for artists without MBIDs', async () => {
    const discovered: DiscoveredArtist[] = [
      { name: 'Burial', similarityScore: 0.85, source: 'lastfm' },
    ]
    const mb = makeMb(makeMbArtist({ id: 'mbid-found', name: 'Burial' }), {
      artists: [{ id: 'mbid-found', name: 'Burial', score: 95 }],
    })

    const result = await resolve(discovered, mb)

    expect(mb.searchArtist).toHaveBeenCalledWith('Burial')
    expect(mb.lookupArtist).toHaveBeenCalledWith('mbid-found')
    expect(result).toHaveLength(1)
    expect(result[0]?.mbid).toBe('mbid-found')
  })

  it('drops artists that cannot be resolved (lookupArtist throws)', async () => {
    const discovered: DiscoveredArtist[] = [
      { name: 'Ghost Artist', mbid: 'mbid-bad', similarityScore: 0.5, source: 'ai' },
    ]
    const mb = makeMb()
    mb.lookupArtist.mockRejectedValue(new Error('Not found'))

    const result = await resolve(discovered, mb)

    expect(result).toHaveLength(0)
  })

  it('drops artists where search returns no results', async () => {
    const discovered: DiscoveredArtist[] = [
      { name: 'Nonexistent Band', similarityScore: 0.4, source: 'lastfm' },
    ]
    const mb = makeMb(undefined, { artists: [] })

    const result = await resolve(discovered, mb)

    expect(result).toHaveLength(0)
  })

  it('extracts streaming URLs from MB relations', async () => {
    const discovered: DiscoveredArtist[] = [
      { name: 'Radiohead', mbid: 'mbid-rh', similarityScore: 0.9, source: 'listenbrainz' },
    ]
    const mb = makeMb(
      makeMbArtist({
        id: 'mbid-rh',
        name: 'Radiohead',
        relations: [
          {
            type: 'streaming music',
            url: { resource: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' },
          },
        ],
      }),
    )

    const result = await resolve(discovered, mb)

    expect(result[0]?.streamingUrls).toHaveProperty('spotify')
  })

  it('deduplicates artists with the same MBID from multiple discoveries', async () => {
    const discovered: DiscoveredArtist[] = [
      { name: 'Radiohead', mbid: 'mbid-rh', similarityScore: 0.9, source: 'listenbrainz' },
      { name: 'Radiohead', mbid: 'mbid-rh', similarityScore: 0.8, source: 'lastfm' },
    ]
    const mb = makeMb(makeMbArtist({ id: 'mbid-rh', name: 'Radiohead' }))

    const result = await resolve(discovered, mb)

    // Both discoveries should be attached to one result
    expect(result).toHaveLength(1)
    expect(result[0]?.discoveries).toHaveLength(2)
  })

  it('emits progress events via callback', async () => {
    const discovered: DiscoveredArtist[] = [
      { name: 'Radiohead', mbid: 'mbid-rh', similarityScore: 0.9, source: 'listenbrainz' },
    ]
    const mb = makeMb(makeMbArtist({ id: 'mbid-rh', name: 'Radiohead' }))
    const onProgress = vi.fn()

    await resolve(discovered, mb, onProgress)

    expect(onProgress).toHaveBeenCalled()
    // Should have received at least one progress event with stage 'resolve'
    expect(onProgress.mock.calls.some((call) => call[0].stage === 'resolve')).toBe(true)
  })

  it('builds tags and genres from MB tags', async () => {
    const discovered: DiscoveredArtist[] = [
      { name: 'Radiohead', mbid: 'mbid-rh', similarityScore: 0.9, source: 'listenbrainz' },
    ]
    const mb = makeMb(
      makeMbArtist({
        id: 'mbid-rh',
        name: 'Radiohead',
        tags: [
          { name: 'alternative rock', count: 10 },
          { name: 'art rock', count: 8 },
        ],
      }),
    )

    const result = await resolve(discovered, mb)

    expect(result[0]?.tags).toContain('alternative rock')
    expect(result[0]?.genres).toContain('art rock')
  })

  describe('MBID disambiguation', () => {
    it('picks MB result with best genre overlap when AI provides genres', async () => {
      const discovered: DiscoveredArtist[] = [
        {
          name: 'Burial',
          similarityScore: 0.85,
          source: 'ai',
          aiReasoning: 'UK dubstep artist',
          genres: ['dubstep', 'electronic', 'uk garage'],
        },
      ]

      const wrongArtist = makeMbArtist({
        id: 'mbid-wrong',
        name: 'Burial',
        tags: [
          { name: 'black metal', count: 10 },
          { name: 'death metal', count: 5 },
        ],
      })
      const rightArtist = makeMbArtist({
        id: 'mbid-right',
        name: 'Burial',
        tags: [
          { name: 'electronic', count: 10 },
          { name: 'dubstep', count: 8 },
        ],
      })

      const mb = makeMb()
      mb.searchArtist = vi.fn().mockResolvedValue({
        artists: [
          { id: 'mbid-wrong', name: 'Burial', score: 100 },
          { id: 'mbid-right', name: 'Burial', score: 95 },
        ],
      })
      mb.lookupArtist = vi.fn().mockImplementation((mbid: string) => {
        if (mbid === 'mbid-wrong') return Promise.resolve(wrongArtist)
        if (mbid === 'mbid-right') return Promise.resolve(rightArtist)
        return Promise.reject(new Error('not found'))
      })

      const result = await resolve(discovered, mb)

      expect(result).toHaveLength(1)
      expect(result[0]?.mbid).toBe('mbid-right')
    })

    it('falls back to first MB result when no genre data available', async () => {
      const discovered: DiscoveredArtist[] = [
        { name: 'SomeArtist', similarityScore: 0.8, source: 'lastfm' },
      ]
      const mb = makeMb(makeMbArtist({ id: 'mbid-first', name: 'SomeArtist' }))

      const result = await resolve(discovered, mb)

      expect(result).toHaveLength(1)
      expect(result[0]?.mbid).toBe('mbid-first')
      // Only one lookup call (the first hit)
      expect(mb.lookupArtist).toHaveBeenCalledTimes(1)
    })
  })

  describe('imageFailed flag', () => {
    it('sets imageFailed when Lidarr lookup returns no images', async () => {
      const discovered: DiscoveredArtist[] = [
        { name: 'Obscure Artist', mbid: 'mbid-obscure', similarityScore: 0.7, source: 'ai' },
      ]
      const mb = makeMb(makeMbArtist({ id: 'mbid-obscure', name: 'Obscure Artist' }))
      const mockLidarr = {
        lookupArtist: vi.fn().mockResolvedValue([{ images: [] }]),
      }

      const result = await resolve(discovered, mb, undefined, mockLidarr)

      expect(result).toHaveLength(1)
      expect(result[0]?.imageUrl).toBeUndefined()
      expect(result[0]?.imageFailed).toBe(true)
    })

    it('does not set imageFailed when image is found', async () => {
      const discovered: DiscoveredArtist[] = [
        { name: 'Famous Artist', mbid: 'mbid-famous', similarityScore: 0.9, source: 'ai' },
      ]
      const mb = makeMb(makeMbArtist({ id: 'mbid-famous', name: 'Famous Artist' }))
      const mockLidarr = {
        lookupArtist: vi
          .fn()
          .mockResolvedValue([
            { images: [{ coverType: 'poster', remoteUrl: 'https://example.com/img.jpg' }] },
          ]),
      }

      const result = await resolve(discovered, mb, undefined, mockLidarr)

      expect(result).toHaveLength(1)
      expect(result[0]?.imageUrl).toBe('https://example.com/img.jpg')
      expect(result[0]?.imageFailed).toBeFalsy()
    })
  })

  describe('suggestedAlbum resolution', () => {
    it('exact album title match -> gets releaseGroupId', async () => {
      const discovered: DiscoveredArtist[] = [
        {
          name: 'Radiohead',
          mbid: 'mbid-rh',
          similarityScore: 0.9,
          source: 'ai',
          suggestedAlbum: 'OK Computer',
        },
      ]
      const mb = makeMb(makeMbArtist({ id: 'mbid-rh', name: 'Radiohead' }))
      mb.getReleaseGroups = vi.fn().mockResolvedValue([
        { id: 'rg-okc', title: 'OK Computer', type: 'Album', firstReleaseDate: '1997-06-16' },
        { id: 'rg-kid', title: 'Kid A', type: 'Album', firstReleaseDate: '2000-10-02' },
      ])

      const result = await resolve(discovered, mb)

      expect(result[0]?.suggestedAlbum).toEqual({
        releaseGroupId: 'rg-okc',
        title: 'OK Computer',
        type: 'Album',
      })
    })

    it('normalized match strips parenthetical suffix -> gets releaseGroupId', async () => {
      const discovered: DiscoveredArtist[] = [
        {
          name: 'Radiohead',
          mbid: 'mbid-rh',
          similarityScore: 0.9,
          source: 'ai',
          suggestedAlbum: 'OK Computer',
        },
      ]
      const mb = makeMb(makeMbArtist({ id: 'mbid-rh', name: 'Radiohead' }))
      mb.getReleaseGroups = vi.fn().mockResolvedValue([
        {
          id: 'rg-okc-deluxe',
          title: 'OK Computer (Deluxe Edition)',
          type: 'Album',
          firstReleaseDate: '1997-06-16',
        },
      ])

      const result = await resolve(discovered, mb)

      expect(result[0]?.suggestedAlbum).toEqual({
        releaseGroupId: 'rg-okc-deluxe',
        title: 'OK Computer (Deluxe Edition)',
        type: 'Album',
      })
    })

    it('unmatched album -> stored as free text without releaseGroupId', async () => {
      const discovered: DiscoveredArtist[] = [
        {
          name: 'Radiohead',
          mbid: 'mbid-rh',
          similarityScore: 0.9,
          source: 'ai',
          suggestedAlbum: 'Nonexistent Album',
        },
      ]
      const mb = makeMb(makeMbArtist({ id: 'mbid-rh', name: 'Radiohead' }))
      mb.getReleaseGroups = vi
        .fn()
        .mockResolvedValue([{ id: 'rg-okc', title: 'OK Computer', type: 'Album' }])

      const result = await resolve(discovered, mb)

      expect(result[0]?.suggestedAlbum).toEqual({ title: 'Nonexistent Album' })
      expect(result[0]?.suggestedAlbum?.releaseGroupId).toBeUndefined()
    })

    it('no suggestedAlbum -> result has no suggestedAlbum', async () => {
      const discovered: DiscoveredArtist[] = [
        { name: 'Radiohead', mbid: 'mbid-rh', similarityScore: 0.9, source: 'ai' },
      ]
      const mb = makeMb(makeMbArtist({ id: 'mbid-rh', name: 'Radiohead' }))
      mb.getReleaseGroups = vi.fn()

      const result = await resolve(discovered, mb)

      expect(result[0]?.suggestedAlbum).toBeUndefined()
      expect(mb.getReleaseGroups).not.toHaveBeenCalled()
    })

    it('getReleaseGroups not available -> falls back to free text', async () => {
      const discovered: DiscoveredArtist[] = [
        {
          name: 'Radiohead',
          mbid: 'mbid-rh',
          similarityScore: 0.9,
          source: 'ai',
          suggestedAlbum: 'OK Computer',
        },
      ]
      // makeMb() does not include getReleaseGroups by default
      const mb = makeMb(makeMbArtist({ id: 'mbid-rh', name: 'Radiohead' }))

      const result = await resolve(discovered, mb)

      expect(result[0]?.suggestedAlbum).toEqual({ title: 'OK Computer' })
    })

    it('getReleaseGroups throws -> falls back to free text', async () => {
      const discovered: DiscoveredArtist[] = [
        {
          name: 'Radiohead',
          mbid: 'mbid-rh',
          similarityScore: 0.9,
          source: 'ai',
          suggestedAlbum: 'OK Computer',
        },
      ]
      const mb = makeMb(makeMbArtist({ id: 'mbid-rh', name: 'Radiohead' }))
      mb.getReleaseGroups = vi.fn().mockRejectedValue(new Error('MB rate limited'))

      const result = await resolve(discovered, mb)

      expect(result[0]?.suggestedAlbum).toEqual({ title: 'OK Computer' })
    })
  })

  describe('life-span era data', () => {
    it('attaches beginYear and endYear from MB life-span', async () => {
      const discovered: DiscoveredArtist[] = [
        { name: 'The Beatles', mbid: 'mbid-beatles', similarityScore: 0.9, source: 'ai' },
      ]
      const mb = makeMb(
        makeMbArtist({
          id: 'mbid-beatles',
          name: 'The Beatles',
          'life-span': { begin: '1960-08-17', end: '1970-04-10', ended: true },
        }),
      )

      const result = await resolve(discovered, mb)

      expect(result[0]?.beginYear).toBe(1960)
      expect(result[0]?.endYear).toBe(1970)
    })

    it('attaches only beginYear when end is absent (active artist)', async () => {
      const discovered: DiscoveredArtist[] = [
        { name: 'Active Band', mbid: 'mbid-active', similarityScore: 0.8, source: 'ai' },
      ]
      const mb = makeMb(
        makeMbArtist({
          id: 'mbid-active',
          name: 'Active Band',
          'life-span': { begin: '1994', ended: false },
        }),
      )

      const result = await resolve(discovered, mb)

      expect(result[0]?.beginYear).toBe(1994)
      expect(result[0]?.endYear).toBeUndefined()
    })

    it('leaves beginYear and endYear undefined when life-span is absent', async () => {
      const discovered: DiscoveredArtist[] = [
        { name: 'No Dates', mbid: 'mbid-nodates', similarityScore: 0.7, source: 'ai' },
      ]
      const mb = makeMb(
        makeMbArtist({
          id: 'mbid-nodates',
          name: 'No Dates',
        }),
      )

      const result = await resolve(discovered, mb)

      expect(result[0]?.beginYear).toBeUndefined()
      expect(result[0]?.endYear).toBeUndefined()
    })
  })
})
