// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encryptField, initEncryption } from '@/core/crypto'
import { discover } from '@/core/pipeline/discover'
import { resolve } from '@/core/pipeline/resolve'
import { computeWeightedScore, score } from '@/core/pipeline/score'
import { createAudioMuseSource, getAudioMuseConfig } from '@/core/plugins/audiomuse'
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
    expect(best?.sourceScores.similarity).toBeCloseTo(0.8)
    expect(best?.score).toBeCloseTo(
      computeWeightedScore(weights, {
        consensus: 0.25,
        similarity: 0.8,
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
