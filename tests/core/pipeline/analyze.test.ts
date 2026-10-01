// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { analyze } from '@/core/pipeline/analyze'
import type { DiscoverySource, TopArtistEntry } from '@/core/plugins/types'

const lbArtists = [
  { name: 'Radiohead', mbid: 'mbid-rh', playCount: 500, source: 'listenbrainz' },
  { name: 'Portishead', mbid: 'mbid-ph', playCount: 300, source: 'listenbrainz' },
  { name: 'Massive Attack', mbid: 'mbid-ma', playCount: 200, source: 'listenbrainz' },
]

const lfmArtists = [
  { name: 'Radiohead', mbid: 'mbid-rh', playCount: 600, source: 'lastfm' },
  { name: 'Bjork', mbid: 'mbid-bj', playCount: 400, source: 'lastfm' },
]

const activityIncreasing = [
  { listen_count: 100, from_ts: 1000, to_ts: 2000 },
  { listen_count: 200, from_ts: 2000, to_ts: 3000 },
]

const activityDecreasing = [
  { listen_count: 300, from_ts: 1000, to_ts: 2000 },
  { listen_count: 100, from_ts: 2000, to_ts: 3000 },
]

const activityStable = [
  { listen_count: 100, from_ts: 1000, to_ts: 2000 },
  { listen_count: 105, from_ts: 2000, to_ts: 3000 },
]

function makeLb(artists = lbArtists, activity = activityStable): DiscoverySource {
  return {
    id: 'listenbrainz',
    name: 'ListenBrainz',
    capabilities: ['topArtists', 'similarArtists', 'listeningActivity'],
    getTopArtists: vi.fn().mockResolvedValue(artists),
    getSimilarArtists: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    getListeningActivity: vi.fn().mockResolvedValue(activity),
  }
}

function makeLfm(artists = lfmArtists): DiscoverySource {
  return {
    id: 'lastfm',
    name: 'Last.fm',
    capabilities: ['topArtists', 'similarArtists', 'genreArtists'],
    getTopArtists: vi.fn().mockResolvedValue(artists),
    getSimilarArtists: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  }
}

describe('analyze()', () => {
  const sourceFor = (id: string, artists: TopArtistEntry[]): DiscoverySource => ({
    ...makeLb([], []),
    id,
    getTopArtists: vi.fn().mockResolvedValue(artists),
  })

  it('keeps source-relative evidence invariant across four listening cohorts', async () => {
    const cohorts = [
      [90, 10, 1],
      [1, 1, 1],
      [1, 0, 0],
      [10, 80, 10],
    ]
    for (const scores of cohorts) {
      const rows = scores.map((playCount, index) => ({
        name: `Interest ${index}`,
        playCount,
        source: 'history',
        genres: index === 2 ? undefined : [index === 0 ? 'rock' : 'jazz'],
      }))
      const collection = [
        {
          name: 'Collection',
          playCount: 9999,
          source: 'collection',
          preferenceScore: 1,
          preferenceBasis: 'membership' as const,
        },
      ]
      const baseline = await analyze([
        sourceFor('history', rows),
        sourceFor('collection', collection),
      ])
      const scaled = rows.map((artist) => ({ ...artist, playCount: artist.playCount * 1e300 }))
      const alternate = await analyze([
        sourceFor(
          'collection',
          [...collection, ...collection].map((artist) => ({ ...artist, preferenceScore: 1e-200 })),
        ),
        sourceFor('history', [...scaled, ...scaled].reverse()),
        sourceFor('history', scaled),
      ])
      const evidenceRows = (profile: typeof baseline) =>
        profile.topArtists.map(({ playCount: _raw, tasteWeight: _weight, ...artist }) => artist)
      expect(evidenceRows(alternate)).toEqual(evidenceRows(baseline))
      expect(alternate.topGenres.map((genre) => genre.name)).toEqual(
        baseline.topGenres.map((genre) => genre.name),
      )
      alternate.topArtists.forEach((artist, index) => {
        expect(artist.tasteWeight).toBeCloseTo(baseline.topArtists[index]?.tasteWeight ?? 0, 14)
      })
      alternate.topGenres.forEach((genre, index) => {
        expect(genre.weight).toBeCloseTo(baseline.topGenres[index]?.weight ?? 0, 14)
      })
      expect(baseline.topArtists.find((artist) => artist.name === 'Interest 2')?.genres).toEqual([])
      for (const artist of alternate.topArtists) {
        expect(Number.isFinite(artist.tasteWeight)).toBe(true)
        expect(artist.tasteWeight).toBeGreaterThanOrEqual(0)
        expect(artist.tasteWeight).toBeLessThanOrEqual(1)
        expect(artist.playCount).toBe(
          artist.source === 'collection'
            ? 9999
            : scaled.find((row) => row.name === artist.name)?.playCount,
        )
      }
      const updated = await analyze([
        sourceFor('history', [{ name: 'New interest', playCount: 1, source: 'history' }]),
      ])
      expect(updated.topArtists.map((artist) => artist.name)).toEqual(['New interest'])
      expect(updated.topArtists).not.toEqual(baseline.topArtists)
    }
  })

  it('preserves globally ambiguous names before per-source normalization', async () => {
    const first = {
      name: 'Shared',
      mbid: '00000000-0000-0000-0000-000000000041',
      playCount: 10,
      source: 'first',
    }
    const second = { ...first, mbid: '00000000-0000-0000-0000-000000000042', source: 'second' }
    const unknown = { name: 'shared', playCount: 5, source: 'first' }
    const profile = await analyze([
      sourceFor('first', [first, unknown]),
      sourceFor('second', [second]),
    ])
    expect(profile.topArtists).toHaveLength(3)
    expect(new Set(profile.topArtists.map((artist) => artist.mbid))).toEqual(
      new Set([first.mbid, second.mbid, undefined]),
    )
    const duplicated = await analyze([
      sourceFor('second', [second]),
      sourceFor('first', [unknown, first, unknown]),
      sourceFor('first', [first, unknown]),
    ])
    expect(duplicated.topArtists).toEqual(profile.topArtists)
    expect(duplicated.topArtists.find((artist) => artist.name === 'shared')?.mbid).toBeUndefined()
  })

  it('keeps zero and invalid evidence at zero without falling back to raw counts', async () => {
    const rows = [0, -1, Number.NaN, Number.POSITIVE_INFINITY].map((preferenceScore, index) => ({
      name: `Invalid ${index}`,
      playCount: 100,
      source: 'collection',
      preferenceScore,
      genres: ['rock'],
    }))
    const profile = await analyze([sourceFor('collection', rows)])
    expect(profile.topArtists.map((artist) => artist.tasteWeight)).toEqual([0, 0, 0, 0])
    expect(profile.topArtists.map((artist) => artist.playCount)).toEqual([100, 100, 100, 100])
    expect(profile.topGenres).toEqual([])
    const fallback = await analyze([
      sourceFor('history', [
        { name: 'Huge', playCount: Number.MAX_VALUE, source: 'history' },
        { name: 'Also huge', playCount: Number.MAX_VALUE, source: 'history' },
      ]),
    ])
    expect(fallback.topArtists.map((artist) => artist.tasteWeight)).toEqual([0.5, 0.5])
  })

  it('merges ListenBrainz and Last.fm top artists', async () => {
    const lb = makeLb()
    const lfm = makeLfm()
    const profile = await analyze([lb, lfm])

    // Should include artists from both sources
    const names = profile.topArtists.map((a) => a.name)
    expect(names).toContain('Radiohead')
    expect(names).toContain('Bjork')
    expect(names).toContain('Portishead')
    expect(names).toContain('Massive Attack')
  })

  it('deduplicates names and retains raw count from the stronger relative evidence', async () => {
    const lb = makeLb()
    const lfm = makeLfm()
    const profile = await analyze([lb, lfm])

    // Last.fm gives Radiohead 0.6 relative evidence; ListenBrainz gives it 0.5.
    const radiohead = profile.topArtists.find((a) => a.name.toLowerCase() === 'radiohead')
    expect(radiohead).toBeDefined()
    expect(radiohead?.playCount).toBe(600)

    // Should not appear twice
    const radioheadCount = profile.topArtists.filter(
      (a) => a.name.toLowerCase() === 'radiohead',
    ).length
    expect(radioheadCount).toBe(1)
  })

  it('keeps same-name artists with different MBIDs separate', async () => {
    const profile = await analyze([
      makeLb(
        [
          {
            name: 'Echo',
            mbid: '00000000-0000-0000-0000-000000000041',
            playCount: 10,
            source: 'listenbrainz',
          },
          {
            name: 'echo',
            mbid: '00000000-0000-0000-0000-000000000042',
            playCount: 9,
            source: 'listenbrainz',
          },
        ],
        [],
      ),
    ])

    expect(profile.topArtists).toHaveLength(2)
    expect(profile.topArtists.map((artist) => artist.mbid)).toEqual([
      '00000000-0000-0000-0000-000000000041',
      '00000000-0000-0000-0000-000000000042',
    ])
  })

  it('deduplicates aliases that share one MBID', async () => {
    const profile = await analyze([
      makeLb(
        [
          {
            name: 'Artist',
            mbid: '00000000-0000-0000-0000-000000000043',
            playCount: 10,
            source: 'listenbrainz',
          },
          {
            name: 'Artist Alias',
            mbid: '00000000-0000-0000-0000-000000000043',
            playCount: 9,
            source: 'listenbrainz',
          },
        ],
        [],
      ),
    ])

    expect(profile.topArtists).toHaveLength(1)
    expect(profile.topArtists[0]).toMatchObject({
      name: 'Artist',
      mbid: '00000000-0000-0000-0000-000000000043',
    })
  })

  it('treats malformed MBIDs as name-only during identity dedupe', async () => {
    const profile = await analyze([
      makeLb(
        [
          {
            name: 'Shared',
            mbid: '00000000-0000-0000-0000-000000000044',
            playCount: 10,
            source: 'listenbrainz',
          },
          { name: 'shared', mbid: 'malformed', playCount: 11, source: 'lastfm' },
        ],
        [],
      ),
    ])

    expect(profile.topArtists).toHaveLength(1)
    expect(profile.topArtists[0]).toMatchObject({
      mbid: '00000000-0000-0000-0000-000000000044',
      playCount: 11,
    })
  })

  it('drops a malformed MBID when no valid identity is available', async () => {
    const profile = await analyze([
      makeLb([{ name: 'Malformed', mbid: 'not-a-uuid', playCount: 1, source: 'lastfm' }], []),
    ])

    expect(profile.topArtists).toHaveLength(1)
    expect(profile.topArtists[0]?.mbid).toBeUndefined()
  })

  it('works with only ListenBrainz configured', async () => {
    const lb = makeLb()
    const profile = await analyze([lb])

    expect(profile.topArtists.length).toBe(3)
    expect(profile.topArtists.map((artist) => artist.playCount)).toEqual([500, 300, 200])
    const names = profile.topArtists.map((a) => a.name)
    expect(names).toContain('Radiohead')
    expect(names).toContain('Portishead')
  })

  it('works with only Last.fm configured', async () => {
    const lfm = makeLfm()
    const profile = await analyze([lfm])

    expect(profile.topArtists.length).toBe(2)
    const names = profile.topArtists.map((a) => a.name)
    expect(names).toContain('Radiohead')
    expect(names).toContain('Bjork')
  })

  it('computes increasing recentTrend', async () => {
    const lb = makeLb(lbArtists, activityIncreasing)
    const profile = await analyze([lb])
    expect(profile.listeningPatterns.recentTrend).toBe('increasing')
  })

  it('computes decreasing recentTrend', async () => {
    const lb = makeLb(lbArtists, activityDecreasing)
    const profile = await analyze([lb])
    expect(profile.listeningPatterns.recentTrend).toBe('decreasing')
  })

  it('computes stable recentTrend', async () => {
    const lb = makeLb(lbArtists, activityStable)
    const profile = await analyze([lb])
    expect(profile.listeningPatterns.recentTrend).toBe('stable')
  })

  it('returns stable trend when no activity data', async () => {
    const lb = makeLb(lbArtists, [])
    const profile = await analyze([lb])
    expect(profile.listeningPatterns.recentTrend).toBe('stable')
  })

  it('totalListens sums listen_count from activity', async () => {
    const lb = makeLb(lbArtists, activityIncreasing)
    const profile = await analyze([lb])
    expect(profile.listeningPatterns.totalListens).toBe(300)
  })

  it('sorts topArtists by relative evidence while retaining raw counts', async () => {
    const lb = makeLb()
    const profile = await analyze([lb])
    for (let i = 1; i < profile.topArtists.length; i++) {
      expect(profile.topArtists[i - 1]?.tasteWeight ?? 0).toBeGreaterThanOrEqual(
        profile.topArtists[i]?.tasteWeight ?? 0,
      )
    }
  })

  it('returns empty topArtists when no sources provided', async () => {
    const profile = await analyze([])
    expect(profile.topArtists).toEqual([])
  })
})

describe('analyze() genre aggregation', () => {
  function makeSpotifyLike(artists: TopArtistEntry[]): DiscoverySource {
    return {
      id: 'spotify',
      name: 'Spotify',
      capabilities: ['topArtists'],
      getTopArtists: vi.fn().mockResolvedValue(artists),
      getSimilarArtists: vi.fn().mockResolvedValue([]),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    }
  }

  it('hydrates cached genres before aggregation and exposes coverage', async () => {
    const source = makeSpotifyLike([
      {
        name: 'Cached Artist',
        mbid: '00000000-0000-0000-0000-000000000020',
        playCount: 100,
        source: 'listenbrainz',
      },
    ])
    const genreHydrator = vi.fn(async (artists: TopArtistEntry[]) => ({
      artists: artists.map((artist) => ({
        ...artist,
        genres: ['Post-Rock'],
        genreSource: 'artist-cache' as const,
      })),
      coverage: { coveredArtists: 1, pendingArtists: 0, totalArtists: 1 },
    }))

    const profile = await analyze([source], { genreHydrator })

    expect(genreHydrator).toHaveBeenCalledOnce()
    expect(profile.topGenres).toEqual([{ name: 'post-rock', weight: 1 }])
    expect(profile.topArtists[0]).toMatchObject({
      genres: ['Post-Rock'],
      genreSource: 'artist-cache',
      tasteWeight: 1,
    })
    expect(profile.genreCoverage).toEqual({
      coveredArtists: 1,
      pendingArtists: 0,
      totalArtists: 1,
    })
  })

  it('keeps genres from a lower-play duplicate while retaining the higher play count', async () => {
    const withoutGenres = makeSpotifyLike([
      { name: 'Shared', playCount: 100, source: 'listenbrainz' },
    ])
    const withGenres = makeSpotifyLike([
      {
        name: 'shared',
        playCount: 50,
        source: 'spotify',
        genres: ['Indie'],
        genreSource: 'native',
      },
    ])

    const profile = await analyze([withoutGenres, withGenres])

    expect(profile.topArtists).toHaveLength(1)
    expect(profile.topArtists[0]).toMatchObject({
      playCount: 100,
      genres: ['Indie'],
      genreSource: 'native',
    })
    expect(profile.topGenres).toEqual([{ name: 'indie', weight: 1 }])
  })

  it('cleans semicolon lists and numeric artifacts without duplicate genre contributions', async () => {
    const source = makeSpotifyLike([
      {
        name: 'Case Mix',
        playCount: 100,
        source: 'spotify',
        genres: ['Rock;40;rock;137', ' ROCK ', 'R&B', '2 Tone', 'Cafe\u0301; Café', ' ; '],
      },
      { name: 'Other', playCount: 50, source: 'spotify', genres: ['jazz'] },
    ])

    const profile = await analyze([source])

    expect(profile.topGenres).toEqual([
      { name: '2 tone', weight: 1 },
      { name: 'café', weight: 1 },
      { name: 'r&b', weight: 1 },
      { name: 'rock', weight: 1 },
      { name: 'jazz', weight: 0.5 },
    ])
    expect(profile.topArtists[0]?.genres).toEqual(['Rock', 'R&B', '2 Tone', 'Café'])
  })

  it('cleans genres before hydration and recounts valid coverage after cache hydration', async () => {
    const source = makeSpotifyLike([
      {
        name: 'Fallback',
        playCount: 10,
        source: 'spotify',
        genres: ['40;137'],
        genreSource: 'native',
      },
      { name: 'Junk Cache', playCount: 5, source: 'spotify' },
    ])
    const genreHydrator = vi.fn(async (artists: TopArtistEntry[]) => {
      expect(artists[0]?.genres).toEqual([])
      expect(artists[0]?.genreSource).toBeUndefined()
      return {
        artists: artists.map((artist, i) => ({
          ...artist,
          genres: i === 0 ? ['Heavy Metal; Metalcore;6', 'heavy metal'] : ['79;137'],
          genreSource: 'artist-cache' as const,
        })),
        coverage: { coveredArtists: 2, pendingArtists: 1, totalArtists: 2 },
      }
    })
    const profile = await analyze([source], { genreHydrator })
    expect(profile.topGenres).toEqual([
      { name: 'heavy metal', weight: 1 },
      { name: 'metalcore', weight: 1 },
    ])
    expect(profile.topArtists[0]?.genres).toEqual(['Heavy Metal', 'Metalcore'])
    expect(profile.topArtists[1]?.genreSource).toBeUndefined()
    expect(profile.genreCoverage).toEqual({ coveredArtists: 1, pendingArtists: 1, totalArtists: 2 })
  })

  it('aggregates topGenres weighted by playCount, normalized, lowercased', async () => {
    const source = makeSpotifyLike([
      { name: 'Artist A', playCount: 100, source: 'spotify', genres: ['Rock', 'Electronic'] },
      { name: 'Artist B', playCount: 200, source: 'spotify', genres: ['Electronic', 'Ambient'] },
    ])
    const profile = await analyze([source])

    // Electronic: 100+200=300, Rock: 100, Ambient: 200 -> max=300
    // normalized: Electronic=1.0, Ambient=0.666..., Rock=0.333...
    const byName = Object.fromEntries(profile.topGenres.map((g) => [g.name, g.weight]))
    expect(byName.electronic).toBeCloseTo(1.0)
    expect(byName.ambient).toBeCloseTo(200 / 300)
    expect(byName.rock).toBeCloseTo(100 / 300)
    expect(byName.Electronic).toBeUndefined() // must be lowercased
  })

  it('sorts topGenres descending by weight', async () => {
    const source = makeSpotifyLike([
      { name: 'Artist A', playCount: 50, source: 'spotify', genres: ['jazz'] },
      { name: 'Artist B', playCount: 200, source: 'spotify', genres: ['rock', 'jazz'] },
    ])
    const profile = await analyze([source])

    for (let i = 1; i < profile.topGenres.length; i++) {
      expect(profile.topGenres[i - 1]?.weight ?? 0).toBeGreaterThanOrEqual(
        profile.topGenres[i]?.weight ?? 0,
      )
    }
  })

  it('returns empty topGenres when no artists carry genres', async () => {
    const source = makeSpotifyLike([
      { name: 'Artist A', playCount: 100, source: 'spotify' },
      { name: 'Artist B', playCount: 200, source: 'spotify', genres: [] },
    ])
    const profile = await analyze([source])
    expect(profile.topGenres).toEqual([])
  })

  it('returns empty topGenres when no sources provided', async () => {
    const profile = await analyze([])
    expect(profile.topGenres).toEqual([])
  })

  it('artists without genres contribute nothing to topGenres', async () => {
    const source = makeSpotifyLike([
      { name: 'Artist A', playCount: 999, source: 'spotify' }, // no genres field
      { name: 'Artist B', playCount: 10, source: 'spotify', genres: ['indie'] },
    ])
    const profile = await analyze([source])

    expect(profile.topGenres).toHaveLength(1)
    expect(profile.topGenres[0]?.name).toBe('indie')
    expect(profile.topGenres[0]?.weight).toBeCloseTo(1.0)
  })

  it('normalizes so the max-weight genre is exactly 1.0', async () => {
    const source = makeSpotifyLike([
      { name: 'X', playCount: 500, source: 'spotify', genres: ['metal'] },
      { name: 'Y', playCount: 100, source: 'spotify', genres: ['metal', 'punk'] },
    ])
    const profile = await analyze([source])

    const max = Math.max(...profile.topGenres.map((g) => g.weight))
    expect(max).toBeCloseTo(1.0)
  })
})
