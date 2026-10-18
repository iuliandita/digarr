// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { RateLimitedError } from '@/core/clients/audiodb'
import type { MBArtist } from '@/core/clients/musicbrainz'
import { PipelineCancelledError } from '@/core/pipeline/cancel'
import { fetchArtistImage, resolve } from '@/core/pipeline/resolve'
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

type ReleaseGroup = { id: string; title: string; type: string; firstReleaseDate?: string }

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
          if (rel.url?.resource?.includes('spotify')) result.spotify = rel.url.resource
        }
        return result
      }),
    getReleaseGroups: undefined as ((artistMbid: string) => Promise<ReleaseGroup[]>) | undefined,
  }
}

const radiohead = (overrides: Partial<DiscoveredArtist> = {}): DiscoveredArtist => ({
  name: 'Radiohead',
  mbid: 'mbid-rh',
  similarityScore: 0.9,
  source: 'ai',
  ...overrides,
})
const radioheadMb = (overrides: Partial<MBArtist> = {}) =>
  makeMb(makeMbArtist({ id: 'mbid-rh', name: 'Radiohead', ...overrides }))

function resolveWith(
  discovered: DiscoveredArtist[],
  mb: ReturnType<typeof makeMb>,
  opts: { netNewAlbums?: boolean; signal?: AbortSignal } = {},
) {
  return resolve(
    discovered,
    mb,
    undefined,
    null,
    null,
    null,
    undefined,
    null,
    opts.netNewAlbums ?? false,
    opts.signal,
  )
}

describe('resolve()', () => {
  it.each(['89ad4ac3-39f7-470e-963a-56509c546377', '125ec42a-7229-4250-afc5-e057484327fe'])(
    'excludes special-purpose artist %s by ID, album, and search',
    async (mbid) => {
      const mb = makeMb(makeMbArtist({ id: mbid }), {
        artists: [{ id: mbid, name: 'Test Artist', score: 100 }],
      })
      mb.getReleaseGroups = vi.fn()
      const common = { name: 'Test Artist', similarityScore: 1, source: 'listenbrainz' as const }
      expect(
        await resolve(
          [
            { ...common, mbid },
            { ...common, mbid, releaseGroupMbid: 'release-1', suggestedAlbum: 'Album' },
            common,
          ],
          mb,
        ),
      ).toEqual([])
      expect(mb.lookupArtist).not.toHaveBeenCalled()
      expect(mb.getReleaseGroups).not.toHaveBeenCalled()
    },
  )

  it('looks up a known MBID directly and maps streaming URLs, tags, genres, and progress', async () => {
    const mb = radioheadMb({
      tags: [
        { name: 'alternative rock', count: 10 },
        { name: 'art rock', count: 8 },
      ],
    })
    const onProgress = vi.fn()

    const result = await resolve([radiohead({ source: 'listenbrainz' })], mb, onProgress)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      mbid: 'mbid-rh',
      streamingUrls: { spotify: 'https://open.spotify.com/artist/abc' },
    })
    expect(result[0]?.tags).toContain('alternative rock')
    expect(result[0]?.genres).toContain('art rock')
    expect(mb.lookupArtist).toHaveBeenCalledWith('mbid-rh')
    expect(mb.searchArtist).not.toHaveBeenCalled()
    expect(onProgress.mock.calls.some(([event]) => event.stage === 'resolve')).toBe(true)
  })

  it('throws PipelineCancelledError when the abort signal is already aborted', async () => {
    const mb = radioheadMb()
    const controller = new AbortController()
    controller.abort()

    await expect(
      resolveWith([radiohead()], mb, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(PipelineCancelledError)
    expect(mb.lookupArtist).not.toHaveBeenCalled()
  })

  it('searches MB for artists without MBIDs', async () => {
    const mb = makeMb(makeMbArtist({ id: 'mbid-found', name: 'Burial' }), {
      artists: [{ id: 'mbid-found', name: 'Burial', score: 95 }],
    })

    const result = await resolve([{ name: 'Burial', similarityScore: 0.85, source: 'lastfm' }], mb)

    expect(mb.searchArtist).toHaveBeenCalledWith('Burial')
    expect(mb.lookupArtist).toHaveBeenCalledWith('mbid-found')
    expect(result.map((r) => r.mbid)).toEqual(['mbid-found'])
  })

  it.each([
    ['lookupArtist throws', { name: 'Ghost', mbid: 'mbid-bad' }, 'lookup'],
    ['search returns no results', { name: 'Nonexistent Band' }, 'search'],
  ] as const)('drops artists when %s', async (_name, artist, failing) => {
    const mb = makeMb(undefined, { artists: [] })
    if (failing === 'lookup') mb.lookupArtist.mockRejectedValue(new Error('Not found'))
    expect(await resolve([{ ...artist, similarityScore: 0.5, source: 'ai' }], mb)).toEqual([])
  })

  it('deduplicates artists with the same MBID from multiple discoveries', async () => {
    const result = await resolve(
      [
        radiohead({ source: 'listenbrainz' }),
        radiohead({ similarityScore: 0.8, source: 'lastfm' }),
      ],
      radioheadMb(),
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.discoveries).toHaveLength(2)
  })

  describe('MBID disambiguation', () => {
    function burialSearch(tagsById: Record<string, string[]>) {
      const mb = makeMb()
      mb.searchArtist.mockResolvedValue({
        artists: Object.keys(tagsById).map((id, i) => ({ id, name: 'Burial', score: 100 - i })),
      })
      mb.lookupArtist.mockImplementation(async (id: string) =>
        makeMbArtist({
          id,
          name: 'Burial',
          tags: (tagsById[id] ?? []).map((name) => ({ name, count: 1 })),
        }),
      )
      return mb
    }
    const aiBurial = (genres?: string[]): DiscoveredArtist => ({
      name: 'Burial',
      source: 'ai',
      similarityScore: 0.8,
      genres,
    })

    it('picks the MB result with genre overlap over a higher-scored mismatch', async () => {
      const mb = burialSearch({
        'mbid-wrong': ['black metal', 'death metal'],
        'mbid-right': ['electronic', 'dubstep'],
      })
      const result = await resolve([aiBurial(['dubstep', 'electronic', 'uk garage'])], mb)
      expect(result.map((r) => r.mbid)).toEqual(['mbid-right'])
    })

    it.each([
      ['drops a sole candidate with zero genre overlap', ['hip hop', 'rap', 'funk'], []],
      ['accepts a sole candidate with no MB tags', [], ['mbid-only']],
    ])('%s', async (_name, tags, expected) => {
      const mb = burialSearch({ 'mbid-only': tags })
      const result = await resolve([aiBurial(['rock', 'experimental', 'art rock'])], mb)
      expect(result.map((r) => r.mbid)).toEqual(expected)
    })

    it('accepts a unique name match with no genre data using one lookup', async () => {
      const mb = makeMb(makeMbArtist({ id: 'mbid-first', name: 'SomeArtist' }), {
        artists: [{ id: 'mbid-first', name: 'SomeArtist', score: 100 }],
      })

      const result = await resolve(
        [{ name: 'SomeArtist', similarityScore: 0.8, source: 'lastfm' }],
        mb,
      )

      expect(result.map((r) => r.mbid)).toEqual(['mbid-first'])
      expect(mb.lookupArtist).toHaveBeenCalledTimes(1)
    })

    it('selects the uniquely best genre match and leaves tied identities unresolved', async () => {
      const candidate = aiBurial(['electronic', 'dubstep'])
      expect(
        (
          await resolve(
            [candidate],
            burialSearch({ partial: ['electronic'], best: ['electronic', 'dubstep'] }),
          )
        )[0]?.mbid,
      ).toBe('best')
      const tied = burialSearch({ a: ['electronic'], b: ['electronic'] })
      expect(await resolve([candidate], tied)).toEqual([])
      expect(await resolve([aiBurial()], tied)).toEqual([])
      expect(await resolve([candidate], burialSearch({ a: [], b: [] }))).toEqual([])
    })
  })

  describe('name identity', () => {
    it('does not attach Slowdive prose or an album to an unrelated genre-compatible hit', async () => {
      const discovered: DiscoveredArtist = {
        name: 'Slowdive',
        source: 'ai',
        similarityScore: 0.9,
        genres: ['shoegaze'],
        aiReasoning: 'Slowdive make shoegaze.',
        suggestedAlbum: 'Souvlaki',
      }
      const unrelated = makeMbArtist({
        id: 'simon',
        name: 'Simon Scott',
        tags: [{ name: 'shoegaze', count: 1 }],
      })
      const exact = makeMbArtist({
        id: 'slowdive',
        name: 'Slowdive',
        tags: [{ name: 'shoegaze', count: 1 }],
      })
      const mb = makeMb()
      mb.lookupArtist.mockImplementation(async (id: string) => (id === 'simon' ? unrelated : exact))
      mb.searchArtist.mockResolvedValue({
        artists: [
          { id: 'simon', name: 'Simon Scott', score: 100 },
          { id: 'slowdive', name: 'Slowdive', score: 90 },
        ],
      })
      const result = await resolve([discovered], mb)
      expect(result.map((artist) => artist.name)).toEqual(['Slowdive'])
      expect(result[0]?.discoveries[0]?.aiReasoning).toBe(discovered.aiReasoning)
      mb.searchArtist.mockResolvedValue({
        artists: [{ id: 'simon', name: 'Simon Scott', score: 100 }],
      })
      expect(await resolve([discovered], mb)).toEqual([])
    })

    it('uses catalog aliases and Unicode normalization without guessing punctuation or accents', async () => {
      const mb = makeMb(
        makeMbArtist({
          id: 'ichiko',
          name: '青葉市子',
          aliases: [{ name: 'Ichiko Aoba' }],
          tags: [],
        }),
        { artists: [{ id: 'ichiko', name: '青葉市子', score: 100 }] },
      )
      expect(
        (await resolve([{ name: '  ICHIKO   AOBA ', source: 'ai', similarityScore: 0.8 }], mb))[0]
          ?.name,
      ).toBe('青葉市子')
      mb.lookupArtist.mockResolvedValue(makeMbArtist({ id: 'bjork', name: 'Björk', tags: [] }))
      expect(
        (await resolve([{ name: 'Björk', source: 'ai', similarityScore: 0.8 }], mb))[0]?.name,
      ).toBe('Björk')
      expect(await resolve([{ name: 'Bjork', source: 'ai', similarityScore: 0.8 }], mb)).toEqual([])
      mb.lookupArtist.mockResolvedValue(makeMbArtist({ id: 'acdc', name: 'AC/DC', tags: [] }))
      expect(await resolve([{ name: 'ACDC', source: 'ai', similarityScore: 0.8 }], mb)).toEqual([])
    })

    it('finds a later exact name without genres and never inspects beyond five hits', async () => {
      const hits = Array.from({ length: 6 }, (_, i) => ({
        id: `hit-${i}`,
        name: i === 4 ? 'Tool' : 'Related artist',
        score: 100 - i,
      }))
      const mb = makeMb(undefined, { artists: hits })
      mb.lookupArtist.mockImplementation(async (id: string) =>
        makeMbArtist({ id, name: hits.find((hit) => hit.id === id)?.name ?? '', tags: [] }),
      )
      expect(
        (await resolve([{ name: 'Tool', source: 'lastfm', similarityScore: 0.7 }], mb))[0]?.name,
      ).toBe('Tool')
      expect(mb.lookupArtist).not.toHaveBeenCalledWith('hit-5')
    })
  })

  it.each([
    ['no images', [], { imageUrl: undefined, imageFailed: true }],
    [
      'a poster',
      [{ coverType: 'poster', remoteUrl: 'https://example.com/img.jpg' }],
      { imageUrl: 'https://example.com/img.jpg', imageFailed: false },
    ],
  ])('sets image fields when Lidarr returns %s', async (_name, images, expected) => {
    const lidarr = { lookupArtist: vi.fn().mockResolvedValue([{ images }]) }
    const [result] = await resolve([radiohead()], radioheadMb(), undefined, lidarr)
    expect(result?.imageUrl).toBe(expected.imageUrl)
    expect(Boolean(result?.imageFailed)).toBe(expected.imageFailed)
  })

  describe('suggestedAlbum resolution', () => {
    const okc = {
      id: 'rg-okc',
      title: 'OK Computer',
      type: 'Album',
      firstReleaseDate: '1997-06-16',
    }

    it.each<[string, ((id: string) => Promise<ReleaseGroup[]>) | undefined, object]>([
      [
        'exact title match',
        async () => [okc, { id: 'rg-kid', title: 'Kid A', type: 'Album' }],
        {
          releaseGroupId: 'rg-okc',
          title: 'OK Computer',
          type: 'Album',
          firstReleaseDate: '1997-06-16',
        },
      ],
      [
        'parenthetical suffix stripped',
        async () => [{ ...okc, id: 'rg-deluxe', title: 'OK Computer (Deluxe Edition)' }],
        {
          releaseGroupId: 'rg-deluxe',
          title: 'OK Computer (Deluxe Edition)',
          type: 'Album',
          firstReleaseDate: '1997-06-16',
        },
      ],
      [
        'no matching release group',
        async () => [{ id: 'rg-kid', title: 'Kid A', type: 'Album' }],
        { title: 'OK Computer' },
      ],
      ['getReleaseGroups unavailable', undefined, { title: 'OK Computer' }],
      [
        'getReleaseGroups throws',
        async () => {
          throw new Error('MB rate limited')
        },
        { title: 'OK Computer' },
      ],
    ])('%s', async (_name, getReleaseGroups, expected) => {
      const mb = radioheadMb()
      mb.getReleaseGroups = getReleaseGroups
      const [result] = await resolve([radiohead({ suggestedAlbum: 'OK Computer' })], mb)
      expect(result?.suggestedAlbum).toEqual(expected)
    })

    it('leaves suggestedAlbum unset without calling MB when none was suggested', async () => {
      const mb = radioheadMb()
      mb.getReleaseGroups = vi.fn()
      const [result] = await resolve([radiohead()], mb)
      expect(result?.suggestedAlbum).toBeUndefined()
      expect(mb.getReleaseGroups).not.toHaveBeenCalled()
    })

    it.each([
      [
        'matched with the gate on',
        [okc],
        true,
        { kind: 'album', releaseGroupMbid: 'rg-okc', releaseDate: '1997-06-16' },
      ],
      ['matched with the gate off', [okc], false, { kind: undefined }],
      ['unmatched with the gate on', [], true, { kind: undefined }],
    ])(
      'promotes an AI suggestedAlbum to album-kind only when %s',
      async (_name, groups, gate, expected) => {
        const mb = radioheadMb()
        mb.getReleaseGroups = vi.fn().mockResolvedValue(groups)
        const [result] = await resolveWith([radiohead({ suggestedAlbum: 'OK Computer' })], mb, {
          netNewAlbums: gate,
        })
        expect(result).toMatchObject(expected)
      },
    )

    it('emits album-kind from a release-group mbid without re-matching via MB', async () => {
      const mb = radioheadMb()
      mb.getReleaseGroups = vi.fn()

      const [resolved] = await resolve(
        [
          radiohead({
            source: 'release-radar',
            suggestedAlbum: 'In Rainbows',
            releaseGroupMbid: 'rg-in-rainbows',
            releaseDate: '2007-10-10',
          }),
        ],
        mb,
      )

      expect(resolved).toMatchObject({
        kind: 'album',
        releaseGroupMbid: 'rg-in-rainbows',
        releaseDate: '2007-10-10',
      })
      expect(resolved?.suggestedAlbum).toEqual({
        releaseGroupId: 'rg-in-rainbows',
        title: 'In Rainbows',
      })
      expect(mb.getReleaseGroups).not.toHaveBeenCalled()
    })

    it('resolves every missing album for one artist into its own album-kind rec', async () => {
      const mb = radioheadMb({ tags: [] })
      mb.getReleaseGroups = vi.fn()
      const gap = (title: string, rg: string) =>
        radiohead({ source: 'gap-fill', suggestedAlbum: title, releaseGroupMbid: rg })

      const resolved = await resolve(
        [gap('The Bends', 'rg-bends'), gap('OK Computer', 'rg-okc')],
        mb,
      )

      expect(resolved).toHaveLength(2)
      expect(resolved.every((r) => r.kind === 'album' && r.mbid === 'mbid-rh')).toBe(true)
      expect(resolved.map((r) => r.releaseGroupMbid).sort()).toEqual(['rg-bends', 'rg-okc'])
      expect(mb.lookupArtist).toHaveBeenCalledTimes(1)
    })
  })

  it.each([
    ['begin and end', { begin: '1960-08-17', end: '1970-04-10', ended: true }, 1960, 1970],
    ['begin only', { begin: '1994', ended: false }, 1994, undefined],
    ['no life-span', undefined, undefined, undefined],
  ])('attaches era years from MB life-span (%s)', async (_name, lifeSpan, beginYear, endYear) => {
    const [result] = await resolve([radiohead()], radioheadMb({ 'life-span': lifeSpan }))
    expect(result?.beginYear).toBe(beginYear)
    expect(result?.endYear).toBe(endYear)
  })
})

describe('fetchArtistImage', () => {
  const MBID = 'mbid-image'

  function makeAudiodb(images: { url?: string; logoUrl?: string } = {}) {
    return {
      getArtistImages: vi.fn().mockResolvedValue(images),
      searchArtistByName: vi.fn().mockResolvedValue({}),
    }
  }
  const rateLimitedAudiodb = () => ({
    getArtistImages: vi.fn().mockRejectedValue(new RateLimitedError()),
    searchArtistByName: vi.fn(),
  })
  const makeLidarr = (images: Array<{ coverType: string; remoteUrl?: string }>) => ({
    lookupArtist: vi.fn().mockResolvedValue([{ images }]),
  })
  const failingLidarr = () => ({
    lookupArtist: vi.fn().mockRejectedValue(new Error('lidarr down')),
  })
  const makeFanart = (images: { url?: string; logoUrl?: string }) => ({
    getArtistImages: vi.fn().mockResolvedValue(images),
  })
  const makeMusicinfo = (images: { url?: string; logoUrl?: string }) => ({
    lookupArtistImages: vi.fn().mockResolvedValue(images),
  })

  function fetchWith(
    audiodb: unknown,
    lidarr: unknown = null,
    fanart: unknown = null,
    musicinfo: unknown = null,
  ) {
    return fetchArtistImage(
      MBID,
      'Test Artist',
      audiodb as never,
      lidarr as never,
      fanart as never,
      musicinfo as never,
    )
  }

  it('short-circuits on AudioDB hit and never invokes fallbacks', async () => {
    const audiodb = makeAudiodb({ url: 'https://audiodb/img.jpg' })
    const lidarr = makeLidarr([{ coverType: 'poster', remoteUrl: 'https://lidarr/img.jpg' }])
    const fanart = makeFanart({ url: 'https://fanart/img.jpg' })
    const musicinfo = makeMusicinfo({ url: 'https://musicinfo/img.jpg' })

    const result = await fetchWith(audiodb, lidarr, fanart, musicinfo)

    expect(result).toEqual({ url: 'https://audiodb/img.jpg', failed: false })
    expect(audiodb.getArtistImages).toHaveBeenCalledTimes(1)
    expect(lidarr.lookupArtist).not.toHaveBeenCalled()
    expect(fanart.getArtistImages).not.toHaveBeenCalled()
    expect(musicinfo.lookupArtistImages).not.toHaveBeenCalled()
  })

  it('returns fanart image when AudioDB misses and only fanart is configured', async () => {
    const fanart = makeFanart({ url: 'https://fanart/img.jpg', logoUrl: 'https://fanart/logo.png' })

    const result = await fetchWith(makeAudiodb(), null, fanart)

    expect(result).toEqual({
      url: 'https://fanart/img.jpg',
      logoUrl: 'https://fanart/logo.png',
      failed: false,
    })
    expect(fanart.getArtistImages).toHaveBeenCalledWith(MBID)
  })

  it('prefers Lidarr over fanart when both return images (priority preserved despite concurrency)', async () => {
    const result = await fetchWith(
      makeAudiodb(),
      makeLidarr([{ coverType: 'poster', remoteUrl: 'https://lidarr/img.jpg' }]),
      makeFanart({ url: 'https://fanart/img.jpg' }),
    )
    expect(result).toEqual({ url: 'https://lidarr/img.jpg', failed: false })
  })

  it('falls through to fanart without an unhandled rejection when Lidarr throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await fetchWith(
      makeAudiodb(),
      failingLidarr(),
      makeFanart({ url: 'https://fanart/img.jpg' }),
    )

    expect(result).toEqual({ url: 'https://fanart/img.jpg', failed: false })
    expect(warn).toHaveBeenCalledWith(
      `[resolve] Lidarr image lookup failed for ${MBID}:`,
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it.each([
    ['a shared provider failed', () => [makeAudiodb(), failingLidarr()]],
    ['AudioDB was rate-limited', () => [rateLimitedAudiodb(), makeLidarr([])]],
    [
      'user-scoped fallbacks missed',
      () => [makeAudiodb(), makeLidarr([]), makeFanart({}), makeMusicinfo({})],
    ],
    ['only user-scoped providers missed', () => [null, makeLidarr([]), makeFanart({})]],
  ])('does not report a cacheable failure when %s', async (_name, providers) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await fetchWith(...(providers() as Parameters<typeof fetchWith>))).toEqual({
      failed: false,
    })
    warn.mockRestore()
  })

  it('reports failed when AudioDB is the only configured source and misses', async () => {
    expect(await fetchArtistImage(MBID, 'Test Artist', makeAudiodb() as never)).toEqual({
      failed: true,
    })
  })

  it('cascades to AudioDB name search when the MBID lookup is empty', async () => {
    const audiodb = makeAudiodb()
    audiodb.searchArtistByName.mockResolvedValue({ url: 'adb://name' })

    const result = await fetchArtistImage('mbid-2', 'Niche Artist', audiodb as never)

    expect(result.url).toBe('adb://name')
    expect(audiodb.searchArtistByName).toHaveBeenCalledWith('Niche Artist')
  })

  it('cascades to Lidarr on an AudioDB rate limit and skips name search', async () => {
    const audiodb = rateLimitedAudiodb()

    const result = await fetchWith(
      audiodb,
      makeLidarr([{ coverType: 'poster', remoteUrl: 'lidarr://x' }]),
    )

    expect(audiodb.searchArtistByName).not.toHaveBeenCalled()
    expect(result.url).toBe('lidarr://x')
  })
})
