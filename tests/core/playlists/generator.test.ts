// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { generatePlaylist, getStrategy } from '@/core/playlists/generator'
import type { StrategyArtist, StrategyDeps } from '@/core/playlists/strategies/types'
import type { TrackResolverDeps } from '@/core/playlists/types'
import type { PlaylistStrategy } from '@/db/schema'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECENT_ARTISTS: StrategyArtist[] = [
  { name: 'Radiohead', mbid: 'mbid-rh', score: 0.95, genres: ['alternative rock', 'art rock'] },
  { name: 'Portishead', mbid: 'mbid-ph', score: 0.88, genres: ['trip hop', 'electronic'] },
  { name: 'Massive Attack', mbid: 'mbid-ma', score: 0.82, genres: ['trip hop', 'downtempo'] },
  { name: 'Boards of Canada', mbid: 'mbid-boc', score: 0.75, genres: ['ambient', 'electronic'] },
]

const OLDER_ARTISTS: StrategyArtist[] = [
  { name: 'Talk Talk', mbid: 'mbid-tt', score: 0.91, genres: ['post-rock', 'ambient'] },
  { name: 'Cocteau Twins', mbid: 'mbid-ct', score: 0.79, genres: ['dream pop', 'shoegaze'] },
]

function makeStrategyDeps(overrides: Partial<StrategyDeps> = {}): StrategyDeps {
  return {
    getApprovedArtists: vi.fn().mockResolvedValue(RECENT_ARTISTS),
    getOlderApprovedArtists: vi.fn().mockResolvedValue(OLDER_ARTISTS),
    ...overrides,
  }
}

function makeResolverDeps(): TrackResolverDeps {
  let callCount = 0
  return {
    spotifySearch: vi.fn().mockImplementation(async (query: string) => {
      callCount++
      const artistName = query.replace('artist:', '')
      return [
        {
          name: `${artistName} Track 1`,
          artists: [artistName],
          uri: `spotify:track:${callCount}-1`,
          popularity: 80,
        },
        {
          name: `${artistName} Track 2`,
          artists: [artistName],
          uri: `spotify:track:${callCount}-2`,
          popularity: 75,
        },
        {
          name: `${artistName} Track 3`,
          artists: [artistName],
          uri: `spotify:track:${callCount}-3`,
          popularity: 70,
        },
      ]
    }),
  }
}

// ---------------------------------------------------------------------------
// getStrategy
// ---------------------------------------------------------------------------

describe('getStrategy()', () => {
  const strategies: PlaylistStrategy[] = ['weekly_digest', 'genre_focus', 'mood_mix', 'rediscover']

  it.each(strategies)('returns an impl with selectArtists for %s', (strategy) => {
    const impl = getStrategy(strategy)
    expect(typeof impl.selectArtists).toBe('function')
  })

  it('throws for an unknown strategy', () => {
    expect(() => getStrategy('unknown_strategy' as PlaylistStrategy)).toThrow(
      'Unknown playlist strategy: unknown_strategy',
    )
  })
})

// ---------------------------------------------------------------------------
// weekly_digest strategy
// ---------------------------------------------------------------------------

describe('weekly_digest strategy', () => {
  it('fetches recent artists (last 7 days)', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('weekly_digest')

    await impl.selectArtists(deps, { size: 9 })

    expect(deps.getApprovedArtists).toHaveBeenCalledOnce()
    const firstCall = (deps.getApprovedArtists as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown[]
    const opts = firstCall[0] as { since: Date; genre?: string; limit?: number }
    expect(opts.since).toBeInstanceOf(Date)

    // The "since" date should be approximately 7 days ago.
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const diffMs = Math.abs(opts.since.getTime() - sevenDaysAgo.getTime())
    expect(diffMs).toBeLessThan(5000) // within 5 seconds
  })

  it('returns artists sorted by score descending', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('weekly_digest')

    const artists = await impl.selectArtists(deps, { size: 12 })

    const scores = artists.map((a) => a.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('caps results to enough artists for config.size tracks (~3 per artist)', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('weekly_digest')

    // size=6 => need ceil(6/3)=2 artists
    const artists = await impl.selectArtists(deps, { size: 6 })

    expect(artists.length).toBeLessThanOrEqual(2)
  })

  it('returns empty array when no recent artists exist', async () => {
    const deps = makeStrategyDeps({
      getApprovedArtists: vi.fn().mockResolvedValue([]),
    })
    const impl = getStrategy('weekly_digest')

    const artists = await impl.selectArtists(deps, { size: 9 })

    expect(artists).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// genre_focus strategy
// ---------------------------------------------------------------------------

describe('genre_focus strategy', () => {
  it('passes genre filter to getApprovedArtists', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('genre_focus')

    await impl.selectArtists(deps, { size: 9, genre: 'trip hop' })

    expect(deps.getApprovedArtists).toHaveBeenCalledWith(
      expect.objectContaining({ genre: 'trip hop' }),
    )
  })

  it('returns artists sorted by score descending', async () => {
    const tripHopArtists = RECENT_ARTISTS.filter((a) => a.genres?.includes('trip hop'))
    const deps = makeStrategyDeps({
      getApprovedArtists: vi.fn().mockResolvedValue(tripHopArtists),
    })
    const impl = getStrategy('genre_focus')

    const artists = await impl.selectArtists(deps, { size: 9, genre: 'trip hop' })

    const scores = artists.map((a) => a.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('returns empty array when no artists match genre', async () => {
    const deps = makeStrategyDeps({
      getApprovedArtists: vi.fn().mockResolvedValue([]),
    })
    const impl = getStrategy('genre_focus')

    const artists = await impl.selectArtists(deps, { size: 9, genre: 'polka' })

    expect(artists).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// mood_mix strategy
// ---------------------------------------------------------------------------

describe('mood_mix strategy', () => {
  it('filters artists by mood keyword in genre tags', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('mood_mix')

    // 'electronic' should match Portishead (trip hop, electronic) and BoC (ambient, electronic)
    const artists = await impl.selectArtists(deps, { size: 9, mood: 'electronic' })

    expect(artists.every((a) => a.genres?.some((g) => g.includes('electronic')))).toBe(true)
    expect(artists.map((a) => a.name)).toContain('Portishead')
    expect(artists.map((a) => a.name)).toContain('Boards of Canada')
    expect(artists.map((a) => a.name)).not.toContain('Radiohead')
  })

  it('is case-insensitive in mood matching', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('mood_mix')

    const lower = await impl.selectArtists(deps, { size: 9, mood: 'trip hop' })
    const upper = await impl.selectArtists(deps, { size: 9, mood: 'TRIP HOP' })

    expect(lower.map((a) => a.name)).toEqual(upper.map((a) => a.name))
  })

  it('matches alias moods like d&d against adjacent genre tags', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('mood_mix')

    const artists = await impl.selectArtists(deps, { size: 9, mood: 'd&d' })

    expect(artists.map((artist) => artist.name)).toContain('Boards of Canada')
  })

  it('returns all artists sorted by score when mood is not provided', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('mood_mix')

    const artists = await impl.selectArtists(deps, { size: 99 })

    // All RECENT_ARTISTS returned (pool=20, limit=33 -> returns all 4)
    expect(artists.length).toBeGreaterThan(0)
    const scores = artists.map((a) => a.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('returns empty array when no artists match mood', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('mood_mix')

    const artists = await impl.selectArtists(deps, { size: 9, mood: 'reggaeton' })

    expect(artists).toEqual([])
  })

  it('returns empty array when pool is empty', async () => {
    const deps = makeStrategyDeps({
      getApprovedArtists: vi.fn().mockResolvedValue([]),
    })
    const impl = getStrategy('mood_mix')

    const artists = await impl.selectArtists(deps, { size: 9, mood: 'electronic' })

    expect(artists).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// rediscover strategy
// ---------------------------------------------------------------------------

describe('rediscover strategy', () => {
  it('calls getOlderApprovedArtists with 30-day threshold', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('rediscover')

    await impl.selectArtists(deps, { size: 9 })

    expect(deps.getOlderApprovedArtists).toHaveBeenCalledOnce()
    const firstCall = (deps.getOlderApprovedArtists as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown[]
    const opts = firstCall[0] as { olderThan: Date; limit: number }
    expect(opts.olderThan).toBeInstanceOf(Date)

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const diffMs = Math.abs(opts.olderThan.getTime() - thirtyDaysAgo.getTime())
    expect(diffMs).toBeLessThan(5000)
  })

  it('returns artists sorted by score descending', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('rediscover')

    const artists = await impl.selectArtists(deps, { size: 9 })

    const scores = artists.map((a) => a.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('does not call getApprovedArtists', async () => {
    const deps = makeStrategyDeps()
    const impl = getStrategy('rediscover')

    await impl.selectArtists(deps, { size: 9 })

    expect(deps.getApprovedArtists).not.toHaveBeenCalled()
  })

  it('returns empty array when no older artists exist', async () => {
    const deps = makeStrategyDeps({
      getOlderApprovedArtists: vi.fn().mockResolvedValue([]),
    })
    const impl = getStrategy('rediscover')

    const artists = await impl.selectArtists(deps, { size: 9 })

    expect(artists).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// generatePlaylist
// ---------------------------------------------------------------------------

describe('generatePlaylist()', () => {
  it('chains strategy + resolver and returns GenerationResult', async () => {
    const strategyDeps = makeStrategyDeps()
    const resolverDeps = makeResolverDeps()

    const result = await generatePlaylist(
      'weekly_digest',
      { size: 25, trackSourcePriority: ['spotify'] },
      strategyDeps,
      resolverDeps,
    )

    expect(result.strategy).toBe('weekly_digest')
    expect(result.artistCount).toBeGreaterThan(0)
    expect(result.tracks.length).toBeGreaterThan(0)
    expect(result.tracks.every((t) => t.source === 'spotify')).toBe(true)
  })

  it('respects size limit - trims tracks to config.size', async () => {
    const strategyDeps = makeStrategyDeps()
    const resolverDeps = makeResolverDeps()

    const result = await generatePlaylist(
      'weekly_digest',
      { size: 5, trackSourcePriority: ['spotify'] },
      strategyDeps,
      resolverDeps,
    )

    expect(result.tracks.length).toBeLessThanOrEqual(5)
  })

  it('returns correct artistCount matching selected artists', async () => {
    // Force exactly 2 artists from the strategy.
    const twoArtists = RECENT_ARTISTS.slice(0, 2)
    const strategyDeps = makeStrategyDeps({
      getApprovedArtists: vi.fn().mockResolvedValue(twoArtists),
    })
    const resolverDeps = makeResolverDeps()

    const result = await generatePlaylist(
      'genre_focus',
      { size: 25, genre: 'rock', trackSourcePriority: ['spotify'] },
      strategyDeps,
      resolverDeps,
    )

    expect(result.artistCount).toBe(2)
  })

  it('carries strategy name through to the result', async () => {
    const strategyDeps = makeStrategyDeps()
    const resolverDeps = makeResolverDeps()

    const strategies: PlaylistStrategy[] = [
      'weekly_digest',
      'genre_focus',
      'mood_mix',
      'rediscover',
    ]

    for (const s of strategies) {
      const result = await generatePlaylist(
        s,
        { size: 3, trackSourcePriority: ['spotify'] },
        strategyDeps,
        resolverDeps,
      )
      expect(result.strategy).toBe(s)
    }
  })

  it('returns empty tracks when strategy returns no artists', async () => {
    const strategyDeps = makeStrategyDeps({
      getApprovedArtists: vi.fn().mockResolvedValue([]),
      getOlderApprovedArtists: vi.fn().mockResolvedValue([]),
    })
    const resolverDeps = makeResolverDeps()

    const result = await generatePlaylist(
      'weekly_digest',
      { size: 25, trackSourcePriority: ['spotify'] },
      strategyDeps,
      resolverDeps,
    )

    expect(result.tracks).toEqual([])
    expect(result.artistCount).toBe(0)
  })

  it('passes trackSourcePriority to the resolver', async () => {
    const localTracks = [{ name: 'Local Track', artist: 'Radiohead', path: '/music/local.flac' }]
    const jellyfinSearch = vi.fn().mockResolvedValue(localTracks)
    const strategyDeps = makeStrategyDeps({
      getApprovedArtists: vi.fn().mockResolvedValue([RECENT_ARTISTS[0]]),
    })
    const resolverDeps: TrackResolverDeps = { jellyfinSearch }

    const result = await generatePlaylist(
      'weekly_digest',
      { size: 5, trackSourcePriority: ['local'] },
      strategyDeps,
      resolverDeps,
    )

    expect(result.tracks.every((t) => t.source === 'local')).toBe(true)
    expect(jellyfinSearch).toHaveBeenCalled()
  })
})
