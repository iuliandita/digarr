// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { DiscoveryCandidate } from '@/core/discovery-modes/types'
import { discover } from '@/core/pipeline/discover'
import type { DiscoverySource } from '@/core/plugins/types'
import type { TasteProfile } from '@/core/types'

const profile: TasteProfile = {
  topArtists: [
    { name: 'Radiohead', mbid: 'mbid-rh', playCount: 500, source: 'listenbrainz' },
    { name: 'Portishead', mbid: 'mbid-ph', playCount: 300, source: 'listenbrainz' },
  ],
  topGenres: [{ name: 'trip-hop', weight: 0.8 }],
  listeningPatterns: { totalListens: 1000, recentTrend: 'stable' },
}

function makeLb(): DiscoverySource {
  return {
    id: 'listenbrainz',
    name: 'ListenBrainz',
    capabilities: ['topArtists', 'similarArtists', 'listeningActivity'],
    getTopArtists: vi.fn().mockResolvedValue([]),
    getSimilarArtists: vi.fn().mockResolvedValue([
      { name: 'Thom Yorke', similarityScore: 0.9, source: 'listenbrainz' },
      { name: 'Massive Attack', similarityScore: 0.7, source: 'listenbrainz' },
    ]),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  }
}

function makeLfm(): DiscoverySource {
  return {
    id: 'lastfm',
    name: 'Last.fm',
    capabilities: ['topArtists', 'similarArtists', 'genreArtists'],
    getTopArtists: vi.fn().mockResolvedValue([]),
    getSimilarArtists: vi.fn().mockResolvedValue([
      { name: 'Bjork', mbid: 'mbid-bj', similarityScore: 0.85, source: 'lastfm' },
      { name: 'Tricky', mbid: 'mbid-tr', similarityScore: 0.75, source: 'lastfm' },
    ]),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  }
}

function makeAi() {
  return {
    getRecommendations: vi.fn().mockResolvedValue([
      {
        artistName: 'Burial',
        reasoning: 'Similar dark electronic sound',
        confidence: 0.88,
        genres: ['electronic'],
      },
      {
        artistName: 'Four Tet',
        reasoning: 'Experimental electronic',
        confidence: 0.72,
        genres: ['electronic'],
      },
    ]),
  }
}

describe('discover()', () => {
  it('collects similar artists from LB source', async () => {
    const lb = makeLb()
    const results = await discover(profile, { listeningSources: [lb] }, 10)

    const names = results.map((r) => r.name)
    expect(names).toContain('Thom Yorke')
    expect(names).toContain('Massive Attack')
  })

  it('collects similar artists from Last.fm source', async () => {
    const lfm = makeLfm()
    const results = await discover(profile, { listeningSources: [lfm] }, 10)

    const names = results.map((r) => r.name)
    expect(names).toContain('Bjork')
    expect(names).toContain('Tricky')
  })

  it('includes AI recommendations', async () => {
    const ai = makeAi()
    const results = await discover(profile, { ai }, 10)

    const names = results.map((r) => r.name)
    expect(names).toContain('Burial')
    expect(names).toContain('Four Tet')
  })

  it('tags results with correct source', async () => {
    const lb = makeLb()
    const lfm = makeLfm()
    const ai = makeAi()
    const results = await discover(profile, { listeningSources: [lb, lfm], ai }, 10)

    const lbResults = results.filter((r) => r.source === 'listenbrainz')
    const lfmResults = results.filter((r) => r.source === 'lastfm')
    const aiResults = results.filter((r) => r.source === 'ai')

    expect(lbResults.length).toBeGreaterThan(0)
    expect(lfmResults.length).toBeGreaterThan(0)
    expect(aiResults.length).toBeGreaterThan(0)
  })

  it('isolates LB source failure -- other sources still return results', async () => {
    const lb: DiscoverySource = {
      id: 'listenbrainz',
      name: 'ListenBrainz',
      capabilities: ['topArtists', 'similarArtists', 'listeningActivity'],
      getTopArtists: vi.fn().mockResolvedValue([]),
      getSimilarArtists: vi.fn().mockRejectedValue(new Error('LB down')),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    }
    const lfm = makeLfm()
    const ai = makeAi()

    const results = await discover(profile, { listeningSources: [lb, lfm], ai }, 10)

    // Should still get Last.fm and AI results
    expect(results.filter((r) => r.source === 'lastfm').length).toBeGreaterThan(0)
    expect(results.filter((r) => r.source === 'ai').length).toBeGreaterThan(0)
    // But no LB results
    expect(results.filter((r) => r.source === 'listenbrainz').length).toBe(0)
  })

  it('isolates AI source failure -- other sources still return results', async () => {
    const lb = makeLb()
    const ai = { getRecommendations: vi.fn().mockRejectedValue(new Error('AI down')) }

    const results = await discover(profile, { listeningSources: [lb], ai }, 10)

    expect(results.filter((r) => r.source === 'listenbrainz').length).toBeGreaterThan(0)
    expect(results.filter((r) => r.source === 'ai').length).toBe(0)
  })

  it('respects topArtistsLimit -- skips artists beyond the limit', async () => {
    const lb = makeLb()
    // Limit to 1 artist, so only Radiohead's similar artists should be fetched
    await discover(profile, { listeningSources: [lb] }, 1)

    // getSimilarArtists should only be called once (for Radiohead)
    expect(lb.getSimilarArtists).toHaveBeenCalledTimes(1)
    expect(lb.getSimilarArtists).toHaveBeenCalledWith('Radiohead', 'mbid-rh')
  })

  it('skips LB similar artists for artists without MBID', async () => {
    const profileNoMbid: TasteProfile = {
      ...profile,
      topArtists: [{ name: 'Unknown Artist', playCount: 100, source: 'listenbrainz' }],
    }
    // LB source returns empty when no MBID is provided (the plugin handles this)
    const lb: DiscoverySource = {
      id: 'listenbrainz',
      name: 'ListenBrainz',
      capabilities: ['topArtists', 'similarArtists', 'listeningActivity'],
      getTopArtists: vi.fn().mockResolvedValue([]),
      getSimilarArtists: vi.fn().mockResolvedValue([]),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    }
    const results = await discover(profileNoMbid, { listeningSources: [lb] }, 10)

    // The source's getSimilarArtists is still called (it decides what to do with no MBID)
    expect(lb.getSimilarArtists).toHaveBeenCalledWith('Unknown Artist', undefined)
    expect(results).toEqual([])
  })

  it('returns empty array with no sources configured', async () => {
    const results = await discover(profile, {}, 10)
    expect(results).toEqual([])
  })

  it('makes exactly one AI call regardless of artist count', async () => {
    const ai = makeAi()
    await discover(profile, { ai }, 10)
    expect(ai.getRecommendations).toHaveBeenCalledTimes(1)
  })

  it('filters AI recs with names similar to top artists (substring match)', async () => {
    const confusedProfile: TasteProfile = {
      ...profile,
      topArtists: [
        { name: 'Sonic Youth', mbid: 'mbid-sy', playCount: 800, source: 'listenbrainz' },
      ],
    }
    const ai = {
      getRecommendations: vi.fn().mockResolvedValue([
        {
          artistName: 'Sonic Youth Junior',
          reasoning: 'A UK drum and bass artist',
          confidence: 0.8,
          genres: ['drum and bass'],
        },
        {
          artistName: 'Burial',
          reasoning: 'Dark electronic producer',
          confidence: 0.9,
          genres: ['electronic'],
        },
      ]),
    }

    const results = await discover(confusedProfile, { ai }, 10)
    const names = results.map((r) => r.name)

    expect(names).not.toContain('Sonic Youth Junior')
    expect(names).toContain('Burial')
  })

  it('filters AI recs whose reasoning mentions a different top artist', async () => {
    const confusedProfile: TasteProfile = {
      ...profile,
      topArtists: [
        {
          name: 'The Velvet Underground',
          mbid: 'mbid-vu',
          playCount: 600,
          source: 'listenbrainz',
        },
      ],
    }
    const ai = {
      getRecommendations: vi.fn().mockResolvedValue([
        {
          artistName: 'Digital Underground',
          reasoning:
            'Known for their experimental art rock sound similar to Velvet Underground with droning guitars.',
          confidence: 0.85,
          genres: ['hip-hop'],
        },
        {
          artistName: 'Grouper',
          reasoning: 'Ambient folk artist with hazy soundscapes.',
          confidence: 0.9,
          genres: ['ambient'],
        },
      ]),
    }

    const results = await discover(confusedProfile, { ai }, 10)
    const names = results.map((r) => r.name)

    expect(names).not.toContain('Digital Underground')
    expect(names).toContain('Grouper')
  })

  it('does not filter AI recs that legitimately share short name fragments', async () => {
    const narrowProfile: TasteProfile = {
      ...profile,
      topArtists: [{ name: 'Air', mbid: 'mbid-air', playCount: 400, source: 'listenbrainz' }],
    }
    const ai = {
      getRecommendations: vi.fn().mockResolvedValue([
        {
          artistName: 'Airborne Toxic Event',
          reasoning: 'Indie rock band from Los Angeles.',
          confidence: 0.75,
          genres: ['indie rock'],
        },
      ]),
    }

    const results = await discover(narrowProfile, { ai }, 10)
    // "Air" is only 3 chars -- below the 4-char threshold, so no false positive
    expect(results.map((r) => r.name)).toContain('Airborne Toxic Event')
  })

  it('returns mapped and deduped discovery-mode candidates before querying sources', async () => {
    const lb = makeLb()
    const explicitCandidates: DiscoveryCandidate[] = [
      {
        candidateType: 'artist',
        name: 'Stereolab',
        mbid: 'mbid-st',
        provenanceMode: 'labels',
        provenanceProvider: 'discogs',
        confidenceHint: 0.9,
        fallbackUsed: false,
      },
      {
        candidateType: 'artist',
        name: 'Stereolab',
        mbid: 'mbid-st',
        provenanceMode: 'labels',
        provenanceProvider: 'discogs',
        confidenceHint: 0.7,
        fallbackUsed: false,
      },
    ]

    const results = await discover(profile, { listeningSources: [lb] }, 10, undefined, 0.3, {
      explicitCandidates,
      explicitRun: true,
    })

    expect(results).toEqual([
      {
        name: 'Stereolab',
        mbid: 'mbid-st',
        similarityScore: 0.9,
        source: 'labels',
      },
    ])
    expect(lb.getSimilarArtists).not.toHaveBeenCalled()
  })

  it('returns an empty result for explicit discovery runs with zero candidates', async () => {
    const lb = makeLb()
    const ai = {
      getRecommendations: vi.fn().mockResolvedValue([
        {
          artistName: 'Should Not Be Used',
          reasoning: 'legacy path',
          confidence: 0.7,
          genres: [],
        },
      ]),
    }

    const results = await discover(profile, { listeningSources: [lb], ai }, 10, undefined, 0.3, {
      explicitCandidates: [],
      explicitRun: true,
    })

    expect(results).toEqual([])
    expect(lb.getSimilarArtists).not.toHaveBeenCalled()
    expect(ai.getRecommendations).not.toHaveBeenCalled()
  })
})
