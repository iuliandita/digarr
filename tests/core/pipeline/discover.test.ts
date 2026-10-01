// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { DiscoveryCandidate } from '@/core/discovery-modes/types'
import { discover } from '@/core/pipeline/discover'
import type { DiscoverySource } from '@/core/plugins/types'
import type { DiscoveredArtist, TasteProfile } from '@/core/types'

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
  async function aiNames(recName: string, reasoning: string, seeds: string[]) {
    const ai = {
      getRecommendations: vi
        .fn()
        .mockResolvedValue([{ artistName: recName, reasoning, confidence: 0.8, genres: [] }]),
    }
    const results = await discover(
      {
        ...profile,
        topArtists: seeds.map((name) => ({ name, playCount: 1, source: 'listenbrainz' })),
      },
      { ai },
      10,
    )
    return results.map((artist) => artist.name)
  }

  it.each<[string, string, string[], boolean]>([
    ['Portishead', 'Portishead has textures comparable to Radiohead.', ['Radiohead'], true],
    ['Four Tet', 'Four Tet offers an electronic contrast to Radiohead.', ['Radiohead'], true],
    ['Four Tet', 'Electronic textures for fans of Radiohead.', ['Radiohead'], true],
    [
      'Burial',
      'Atmospheric electronics comparable to Boards of Canada.',
      ['Boards of Canada'],
      true,
    ],
    ['Black Country New Road', 'For fans of Black Sabbath.', ['Black Sabbath'], true],
    [
      'Digital Underground',
      'Digital Underground differs from Velvet Underground.',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      'Velvet Underground is a useful comparison for Digital Underground.',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      'Velvet Underground offers one comparison. Digital Underground takes a different approach.',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      'Known for Velvet Underground soundscapes.',
      ['Velvet Underground'],
      false,
    ],
    [
      'Digital Underground',
      'Like "Velvet Underground" with more rhythm.',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      "Like 'Velvet Underground' with more rhythm.",
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      'Like “Velvet Underground” with more rhythm.',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      'Wie „Velvet Underground“ mit mehr Rhythmus.',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      'Jak „Velvet Underground” z mocniejszym rytmem.',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      'Like «Velvet Underground» with more rhythm.',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      'Like 「Velvet Underground」 with more rhythm.',
      ['Velvet Underground'],
      true,
    ],
    ['Digital Underground', 'Velvet Undergrounders perform here.', ['Velvet Underground'], true],
    ['Digital Underground', 'NeoVelvet Underground performs here.', ['Velvet Underground'], true],
    [
      'Digital Underground',
      'Velvet Underground revival performs here.',
      ['Velvet Underground', 'Velvet Underground Revival'],
      true,
    ],
    [
      'Digital Underground',
      'Velvet Underground Revival inspired Velvet Underground.',
      ['Velvet Underground', 'Velvet Underground Revival'],
      false,
    ],
    ['Digital Underground', 'Velvet Underground风格的作品。', ['Velvet Underground'], true],
    ['Digital Underground', '像Velvet Underground的作品。', ['Velvet Underground'], true],
    [
      'Digital Underground',
      'Digital Undergroundは、Velvet Underground と同じ冒険心を持つ。',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      'Digital Underground는 Velvet Underground 와 다른 펑크 사운드를 들려줍니다.',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      'Digital Underground融合放克与嘻哈，与 Velvet Underground 风格不同。',
      ['Velvet Underground'],
      true,
    ],
    [
      'Digital Underground',
      "Listener's favorite Velvet Underground influences this band's sound.",
      ['Velvet Underground'],
      false,
    ],
    ['Digital Underground', 'Velvet Underground sounds.', ['The Velvet Underground'], false],
    ['Digital Underground', 'VELVET\n  UNDERGROUND sounds.', ['Velvet Underground'], false],
    ['Digital (Underground)', 'Velvet (Underground) sounds.', ['Velvet (Underground)'], false],
    ['Digital (Underground)', 'Velvet Underground sounds.', ['Velvet (Underground)'], true],
    ['Digital Université', 'Velvet Universite\u0301 sounds.', ['Velvet Université'], false],
    [
      'Digital Université',
      'Digital Universite\u0301 differs from Velvet Université.',
      ['Velvet Université'],
      true,
    ],
    [
      'Digital Underground Collective',
      'Velvet Underground Collective sounds.',
      ['Velvet Underground Collective'],
      false,
    ],
    [
      'Digital Underground Collective',
      'Velvet Underground Ensemble sounds.',
      ['Velvet Underground Ensemble'],
      true,
    ],
  ])('bounds reasoning identity checks for %s: %s', async (name, reasoning, seeds, retained) => {
    expect(await aiNames(name, reasoning, seeds)).toEqual(retained ? [name] : [])
  })

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

  it('isolates LB source failure - other sources still return results', async () => {
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onSourceFailure = vi.fn()

    const results = await discover(profile, { listeningSources: [lb, lfm], ai }, 10, undefined, 0, {
      onSourceFailure,
    })

    // Should still get Last.fm and AI results
    expect(results.filter((r) => r.source === 'lastfm').length).toBeGreaterThan(0)
    expect(results.filter((r) => r.source === 'ai').length).toBeGreaterThan(0)
    // But no LB results
    expect(results.filter((r) => r.source === 'listenbrainz').length).toBe(0)
    // The swallowed failure must be observable, not silent
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[discover] source listenbrainz failed'),
    )
    expect(onSourceFailure).toHaveBeenCalledWith('listenbrainz', 'LB down')
    warn.mockRestore()
  })

  it('redacts credential-shaped substrings from a source failure before it reaches onSourceFailure', async () => {
    const lb: DiscoverySource = {
      id: 'listenbrainz',
      name: 'ListenBrainz',
      capabilities: ['topArtists', 'similarArtists', 'listeningActivity'],
      getTopArtists: vi.fn().mockResolvedValue([]),
      getSimilarArtists: vi
        .fn()
        .mockRejectedValue(new Error('request failed: ?api_key=abc123secret')),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onSourceFailure = vi.fn()

    await discover(profile, { listeningSources: [lb] }, 10, undefined, 0, { onSourceFailure })

    const [, lastError] = onSourceFailure.mock.calls[0] ?? []
    expect(lastError).toContain('[redacted]')
    expect(lastError).not.toContain('abc123secret')
    warn.mockRestore()
  })

  it('isolates AI source failure - other sources still return results', async () => {
    const lb = makeLb()
    const ai = { getRecommendations: vi.fn().mockRejectedValue(new Error('AI down')) }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onSourceFailure = vi.fn()

    const results = await discover(profile, { listeningSources: [lb], ai }, 10, undefined, 0, {
      onSourceFailure,
    })

    expect(results.filter((r) => r.source === 'listenbrainz').length).toBeGreaterThan(0)
    expect(results.filter((r) => r.source === 'ai').length).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[discover] AI source failed'))
    expect(onSourceFailure).toHaveBeenCalledWith('ai', 'AI down')
    warn.mockRestore()
  })

  it('redacts credential-shaped substrings from an AI source failure before it reaches onSourceFailure', async () => {
    const lb = makeLb()
    const ai = {
      getRecommendations: vi
        .fn()
        .mockRejectedValue(new Error('AI request failed: ?api_key=abc123secret')),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onSourceFailure = vi.fn()

    await discover(profile, { listeningSources: [lb], ai }, 10, undefined, 0, { onSourceFailure })

    const aiCall = onSourceFailure.mock.calls.find((call) => call[0] === 'ai')
    expect(aiCall).toBeDefined()
    const lastError = aiCall?.[1]
    expect(lastError).toContain('[redacted]')
    expect(lastError).not.toContain('abc123secret')
    warn.mockRestore()
  })

  it('respects topArtistsLimit - skips artists beyond the limit', async () => {
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

  it('filters colliding AI names when reasoning describes only the seed artist', async () => {
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
    // "Air" is only 3 chars - below the 4-char threshold, so no false positive
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

const emptyProfile = { topArtists: [], topGenres: [] } as never

function albumCandidate(rg: string): DiscoveredArtist {
  return {
    name: 'Radiohead',
    mbid: 'artist-1',
    similarityScore: 0.8,
    source: 'gap-fill',
    suggestedAlbum: rg,
    releaseGroupMbid: rg,
    releaseDate: '2007-10-10',
  }
}

describe('discover explicit-run dedup', () => {
  it('keeps multiple album-kind candidates that share an artist', async () => {
    const out = await discover(
      emptyProfile,
      { listeningSources: [], musicbrainz: null as never, ai: null },
      30,
      undefined,
      0.3,
      { explicitRun: true, explicitCandidates: [albumCandidate('rg-a'), albumCandidate('rg-b')] },
    )
    expect(out).toHaveLength(2)
    expect(out.map((d) => d.releaseGroupMbid).sort()).toEqual(['rg-a', 'rg-b'])
  })

  it('still collapses duplicate release groups for one artist', async () => {
    const out = await discover(
      emptyProfile,
      { listeningSources: [], musicbrainz: null as never, ai: null },
      30,
      undefined,
      0.3,
      { explicitRun: true, explicitCandidates: [albumCandidate('rg-a'), albumCandidate('rg-a')] },
    )
    expect(out).toHaveLength(1)
  })
})
