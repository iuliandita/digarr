// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { analyze } from '@/core/pipeline/analyze'
import type { DiscoverySource } from '@/core/plugins/types'

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

  it('deduplicates artists by name (case-insensitive), keeping highest play count', async () => {
    const lb = makeLb()
    const lfm = makeLfm()
    const profile = await analyze([lb, lfm])

    // Radiohead appears in both - LFM has higher play count (600 vs 500)
    const radiohead = profile.topArtists.find((a) => a.name.toLowerCase() === 'radiohead')
    expect(radiohead).toBeDefined()
    expect(radiohead?.playCount).toBe(600)

    // Should not appear twice
    const radioheadCount = profile.topArtists.filter(
      (a) => a.name.toLowerCase() === 'radiohead',
    ).length
    expect(radioheadCount).toBe(1)
  })

  it('works with only ListenBrainz configured', async () => {
    const lb = makeLb()
    const profile = await analyze([lb])

    expect(profile.topArtists.length).toBe(3)
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

  it('sorts topArtists descending by playCount', async () => {
    const lb = makeLb()
    const profile = await analyze([lb])
    for (let i = 1; i < profile.topArtists.length; i++) {
      expect(profile.topArtists[i - 1]?.playCount ?? 0).toBeGreaterThanOrEqual(
        profile.topArtists[i]?.playCount ?? 0,
      )
    }
  })

  it('returns empty topArtists when no sources provided', async () => {
    const profile = await analyze([])
    expect(profile.topArtists).toEqual([])
  })
})
