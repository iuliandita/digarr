// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encryptField, initEncryption } from '@/core/crypto'
import { discover } from '@/core/pipeline/discover'
import { resolve } from '@/core/pipeline/resolve'
import { computeWeightedScore, score } from '@/core/pipeline/score'
import {
  AUDIOMUSE_MAX_CANDIDATES,
  createAudioMuseSource,
  getAudioMuseConfig,
} from '@/core/plugins/audiomuse'
import type { TasteProfile } from '@/core/types'
import { DEFAULT_PREFERENCES } from '@/db/schema'
import fixture from '../../fixtures/audiomuse/v3.6.4.json'

const profile: TasteProfile = {
  topArtists: [{ name: 'Radiohead', playCount: 10, source: 'lastfm' }],
  topGenres: [],
  listeningPatterns: { totalListens: 10, recentTrend: 'stable' },
}

afterEach(() => {
  vi.unstubAllGlobals()
  initEncryption(undefined)
})

describe('AudioMuse discovery source', () => {
  it.each([undefined, null, {}, { audiomuseToken: 'unused' }, { audiomuseUrl: '' }])(
    'does nothing when not configured: %j',
    async (prefs) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      const config = getAudioMuseConfig(prefs)
      expect(config).toBeNull()
      expect(
        await discover(
          profile,
          { listeningSources: config ? [createAudioMuseSource(config)] : [] },
          2,
        ),
      ).toEqual([])
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('uses the encrypted admin connection even when its picker is hidden', () => {
    initEncryption('test-encryption-key')
    expect(
      getAudioMuseConfig({
        audiomuseUrl: 'https://audiomuse.example',
        audiomuseToken: encryptField('secret') ?? '',
        audiomuseSkipTlsVerify: true,
        showExperimentalIntegrations: false,
      }),
    ).toEqual({ url: 'https://audiomuse.example', token: 'secret', skipTlsVerify: true })
  })

  it('shares listening and owned-library seeds, resolves candidates, and contributes to weighted scoring', async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json(fixture.artists))
    vi.stubGlobal('fetch', fetch)
    const source = createAudioMuseSource({ url: 'https://audiomuse.example' })
    expect(source.capabilities).toEqual(['similarArtists'])
    expect(await source.getTopArtists()).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    const discovered = await discover(
      profile,
      { listeningSources: [source] },
      2,
      [{ name: 'Björk', mbid: 'owned-mbid' }],
      0.5,
    )
    expect(fetch.mock.calls.map(([url]) => new URL(url).searchParams.get('artist')).sort()).toEqual(
      ['Björk', 'Radiohead'],
    )
    const mb = {
      searchArtist: vi.fn(async (name: string) => ({ artists: [{ id: name, name, score: 100 }] })),
      lookupArtist: vi.fn(async (id: string) => ({ id, name: id, tags: [], relations: [] })),
      extractStreamingUrls: vi.fn(() => ({})),
    }
    const resolved = await resolve(discovered, mb)
    const weights = DEFAULT_PREFERENCES.scoringWeights
    const scored = score(resolved, [], weights, new Map())
    expect(scored.map((a) => a.name)).toEqual(['Portishead', 'Massive Attack', 'Tricky'])
    const best = scored[0]
    expect(best?.sourceScores.similarity).toBeCloseTo(1)
    expect(best?.score).toBeCloseTo(
      computeWeightedScore(weights, {
        consensus: 0.25,
        similarity: 1,
        genreOverlap: 0,
        aiConfidence: 0.5,
        feedbackBoost: 0.5,
        popularity: 0.5,
      }),
    )
    expect(best?.score).toBeGreaterThan(
      score(resolved, [], { ...weights, similarity: 0 }, new Map())[0]?.score ?? 0,
    )
    expect(best?.discoveries.every((d) => d.source === 'audiomuse')).toBe(true)
  })

  it('marks a restored encrypted token unreadable without exposing it', () => {
    initEncryption('original-key')
    const token = encryptField('secret')
    initEncryption('replacement-key')
    expect(
      getAudioMuseConfig({
        audiomuseUrl: 'https://audiomuse.example',
        audiomuseToken: token ?? undefined,
      }),
    ).toEqual({
      url: 'https://audiomuse.example',
      skipTlsVerify: false,
      skipReason: 'token_unreadable',
    })
  })

  it('excludes owned and blocked names before resolution, dedupes seeds, and caps the strongest candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const seed = new URL(url).searchParams.get('artist')
        return Response.json([
          { artist: 'OWNED', divergence: 0 },
          { artist: 'BLOCKED', divergence: 0 },
          { artist: '(Unknown)', divergence: 0 },
          { artist: 'Shared', divergence: 0.1 },
          ...Array.from({ length: 20 }, (_, i) => ({
            artist: `${seed} match ${i}`,
            divergence: 20 - i,
          })),
        ])
      }),
    )
    const source = createAudioMuseSource(
      { url: 'https://audiomuse.example' },
      {
        excludedArtistNames: ['The Owned', 'Blöcked'],
      },
    )
    const discovered = await discover(
      {
        ...profile,
        topArtists: Array.from({ length: 30 }, (_, i) => ({
          name: `Seed ${i}`,
          playCount: 30 - i,
          source: 'lastfm',
        })),
      },
      { listeningSources: [source] },
      30,
    )
    expect(discovered).toHaveLength(AUDIOMUSE_MAX_CANDIDATES)
    expect(new Set(discovered.map((artist) => artist.name)).size).toBe(AUDIOMUSE_MAX_CANDIDATES)
    expect(
      discovered.some((artist) => ['OWNED', 'BLOCKED', '(Unknown)'].includes(artist.name)),
    ).toBe(false)
    const searchArtist = vi.fn(async (name: string) => ({
      artists: [{ id: name, name, score: 100 }],
    }))
    await resolve(discovered, {
      searchArtist,
      lookupArtist: vi.fn(async (id: string) => ({ id, name: id, tags: [], relations: [] })),
      extractStreamingUrls: vi.fn(() => ({})),
    })
    expect(searchArtist).toHaveBeenCalledTimes(AUDIOMUSE_MAX_CANDIDATES)
    expect(searchArtist.mock.calls.every(([name]) => !['OWNED', 'BLOCKED'].includes(name))).toBe(
      true,
    )
    const thirdSeed = discovered.filter((artist) => artist.name.startsWith('Seed 2 match'))
    expect(thirdSeed.map((artist) => artist.name)).toEqual(
      Array.from({ length: 9 }, (_, i) => `Seed 2 match ${19 - i}`),
    )
  })

  it('normalizes each seed by rank onto 0.5 to 1 without changing divergence ordering', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([...fixture.artists].reverse())),
    )
    const result = await createAudioMuseSource({
      url: 'https://audiomuse.example',
    }).getSimilarArtists('Seed')
    expect(result.map((artist) => [artist.name, artist.similarityScore])).toEqual([
      ['Portishead', 1],
      ['Massive Attack', 0.75],
      ['Tricky', 0.5],
    ])
  })

  it('summarizes successful and unknown seeds without losing partial success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const seed = Number(new URL(url).searchParams.get('artist'))
        return seed % 6 === 0
          ? Response.json(fixture.unknownArtist, { status: 404 })
          : Response.json(fixture.artists)
      }),
    )
    const source = createAudioMuseSource({ url: 'https://audiomuse.example' })
    await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) => source.getSimilarArtists(String(i))),
    )
    expect(source.getDiscoverySummary?.()).toEqual({
      seedsQueried: 30,
      seedsWithResults: 25,
      skipReasons: { artist_unknown: 5 },
    })
  })

  it('keeps querying after one failed seed and disables after two consecutive unreachable seeds', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(Response.json(fixture.artists))
      .mockResolvedValueOnce(Response.json({}, { status: 400 }))
      .mockResolvedValueOnce(Response.json(fixture.artists))
      .mockRejectedValue(new Error('timeout'))
    vi.stubGlobal('fetch', fetch)
    const source = createAudioMuseSource({ url: 'https://audiomuse.example' })
    await expect(source.getSimilarArtists('A')).rejects.toMatchObject({ reason: 'unreachable' })
    expect(await source.getSimilarArtists('B')).toHaveLength(3)
    await expect(source.getSimilarArtists('C')).rejects.toMatchObject({ reason: 'request_failed' })
    await expect(source.getSimilarArtists('D')).resolves.toEqual([])
    for (const name of ['E', 'F', 'G']) {
      await expect(source.getSimilarArtists(name)).rejects.toMatchObject({ reason: 'unreachable' })
    }
    expect(fetch).toHaveBeenCalledTimes(6)
    expect(source.getDiscoverySummary?.()).toEqual({
      seedsQueried: 6,
      seedsWithResults: 2,
      skipReasons: { unreachable: 3, request_failed: 1 },
    })
  })

  it.each([
    [503, fixture.notIndexed, 'not_indexed'],
    [404, fixture.unknownArtist, 'artist_unknown'],
    [0, null, 'unreachable'],
  ] as const)(
    'reports %s through onSourceFailure and lets other signals finish',
    async (status, body, reason) => {
      const fetch = vi.fn().mockImplementation(async () => {
        if (!status) throw new Error('connection refused')
        return Response.json(body, { status })
      })
      vi.stubGlobal('fetch', fetch)
      const onSourceFailure = vi.fn()
      const results = await discover(
        profile,
        {
          listeningSources: [createAudioMuseSource({ url: 'https://audiomuse.example' })],
          ai: {
            getRecommendations: vi.fn().mockResolvedValue([
              {
                artistName: 'Other artist',
                confidence: 0.8,
                reasoning: 'Different sound',
                genres: [],
              },
            ]),
          },
        },
        2,
        undefined,
        0,
        { onSourceFailure },
      )
      expect(results.map((a) => a.source)).toEqual(['ai'])
      expect(onSourceFailure).toHaveBeenCalledWith('audiomuse', `AudioMuse-AI: ${reason}`)
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('stops queued lookups after a service-wide failure but keeps trying unknown seeds', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => Response.json(fixture.notIndexed, { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const source = createAudioMuseSource({ url: 'https://audiomuse.example' })
    const result = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => source.getSimilarArtists(`Artist ${i}`)),
    )
    expect(result.every((r) => r.status === 'rejected')).toBe(true)
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(2)
    fetch
      .mockClear()
      .mockImplementation(async () => Response.json(fixture.unknownArtist, { status: 404 }))
    const unknownSource = createAudioMuseSource({ url: 'https://audiomuse.example' })
    await Promise.allSettled(['A', 'B', 'C'].map((name) => unknownSource.getSimilarArtists(name)))
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
