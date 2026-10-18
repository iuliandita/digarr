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

function makeSource(
  id: 'listenbrainz' | 'lastfm',
  similar: Array<{ name: string; mbid?: string; similarityScore: number }>,
): DiscoverySource {
  return {
    id,
    name: id,
    capabilities: ['topArtists', 'similarArtists'],
    getTopArtists: vi.fn().mockResolvedValue([]),
    getSimilarArtists: vi.fn().mockResolvedValue(similar.map((a) => ({ ...a, source: id }))),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  }
}

const makeLb = () =>
  makeSource('listenbrainz', [
    { name: 'Thom Yorke', similarityScore: 0.9 },
    { name: 'Massive Attack', similarityScore: 0.7 },
  ])
const makeLfm = () =>
  makeSource('lastfm', [
    { name: 'Bjork', mbid: 'mbid-bj', similarityScore: 0.85 },
    { name: 'Tricky', mbid: 'mbid-tr', similarityScore: 0.75 },
  ])

function makeAi() {
  return {
    getRecommendations: vi.fn().mockResolvedValue([
      { artistName: 'Burial', reasoning: 'Dark electronic', confidence: 0.88, genres: [] },
      { artistName: 'Four Tet', reasoning: 'Experimental', confidence: 0.72, genres: [] },
    ]),
  }
}

const similarCalls = (source: DiscoverySource) => vi.mocked(source.getSimilarArtists).mock.calls

describe('discover()', () => {
  it('collects similar artists from every listening source plus one AI call, tagged by source', async () => {
    const ai = makeAi()
    const results = await discover(profile, { listeningSources: [makeLb(), makeLfm()], ai }, 10)

    expect(Object.fromEntries(results.map((r) => [r.name, r.source]))).toEqual({
      'Thom Yorke': 'listenbrainz',
      'Massive Attack': 'listenbrainz',
      Bjork: 'lastfm',
      Tricky: 'lastfm',
      Burial: 'ai',
      'Four Tet': 'ai',
    })
    expect(ai.getRecommendations).toHaveBeenCalledTimes(1)
  })

  it('returns nothing without sources and never queries a source lacking similarArtists', async () => {
    const source: DiscoverySource = { ...makeLb(), capabilities: ['topArtists'] }
    expect(await discover(profile, {}, 10)).toEqual([])
    expect(await discover(profile, { listeningSources: [source] }, 10)).toEqual([])
    expect(source.getSimilarArtists).not.toHaveBeenCalled()
  })

  it.each([
    {
      failing: 'listenbrainz',
      error: 'request failed: ?api_key=abc123secret',
      warning: '[discover] source listenbrainz failed',
      survivors: ['lastfm', 'ai'],
    },
    {
      failing: 'ai',
      error: 'AI request failed: ?api_key=abc123secret',
      warning: '[discover] AI source failed',
      survivors: ['listenbrainz', 'lastfm'],
    },
  ])(
    'isolates a $failing failure and reports it redacted',
    async ({ failing, error, warning, survivors }) => {
      const lb = makeLb()
      const ai = makeAi()
      if (failing === 'ai') ai.getRecommendations.mockRejectedValue(new Error(error))
      else vi.mocked(lb.getSimilarArtists).mockRejectedValue(new Error(error))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const onSourceFailure = vi.fn()

      const results = await discover(
        profile,
        { listeningSources: [lb, makeLfm()], ai },
        10,
        undefined,
        0,
        { onSourceFailure },
      )

      expect([...new Set(results.map((r) => r.source))].sort()).toEqual(survivors.sort())
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(warning))
      expect(onSourceFailure).toHaveBeenCalledExactlyOnceWith(
        failing,
        error.replace('abc123secret', '[redacted]'),
      )
      warn.mockRestore()
    },
  )

  it('reports a redacted failure even when another seed contributes artists', async () => {
    const source = makeLb()
    vi.mocked(source.getSimilarArtists).mockRejectedValueOnce(
      new Error('upstream failed: ?api_key=abc123secret'),
    )
    const onSourceFailure = vi.fn()
    const results = await discover(profile, { listeningSources: [source] }, 10, undefined, 0, {
      onSourceFailure,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(onSourceFailure).toHaveBeenCalledWith(
      'listenbrainz',
      'upstream failed: ?api_key=[redacted]',
    )
  })

  it('caps similar-artist lookups at topArtistsLimit', async () => {
    const lb = makeLb()
    await discover(profile, { listeningSources: [lb] }, 1)
    expect(similarCalls(lb)).toEqual([['Radiohead', 'mbid-rh']])
  })

  it('reports the actual seed count after library seed selection', async () => {
    const onSeedCount = vi.fn()
    await discover(profile, {}, 1, [{ name: 'Radiohead', mbid: 'mbid-rh' }], 1, {
      onSeedCount,
    })

    expect(onSeedCount).toHaveBeenCalledWith(1)
  })

  it('rotates exact weighted ties across the cap without changing ranks or the AI profile', async () => {
    const weightedProfile: TasteProfile = {
      ...profile,
      topArtists: [
        { name: 'Strong', playCount: 10, tasteWeight: 0.4, source: 'lastfm' },
        ...['First', 'Second', 'Third'].map((name) => ({
          name,
          playCount: 1,
          tasteWeight: 0.2,
          source: 'spotify',
        })),
      ],
    }
    const original = structuredClone(weightedProfile)
    const source = makeLb()
    const ai = makeAi()
    const random = vi.spyOn(Math, 'random')
    try {
      for (const [draws, selected] of [
        [[0, 0.99], 'Third'],
        [[0.99, 0], 'Second'],
        [[0.99, 0.99], 'First'],
      ] as const) {
        random.mockReturnValueOnce(draws[0]).mockReturnValueOnce(draws[1])
        vi.mocked(source.getSimilarArtists).mockClear()
        await discover(weightedProfile, { listeningSources: [source], ai }, 2)
        expect(similarCalls(source).map(([name]) => name)).toEqual(['Strong', selected])
      }
      expect(weightedProfile).toEqual(original)
      expect(ai.getRecommendations).toHaveBeenCalledTimes(3)
      for (const [received] of ai.getRecommendations.mock.calls)
        expect(received).toBe(weightedProfile)
    } finally {
      random.mockRestore()
    }
  })

  it('keeps legacy and invalid-weight seeds in their original rank order', async () => {
    const source = makeLb()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      await discover(
        {
          ...profile,
          topArtists: [
            ...profile.topArtists,
            ...[0, 0, Number.NaN, Number.POSITIVE_INFINITY].map((tasteWeight, index) => ({
              name: `Invalid ${index}`,
              playCount: 1,
              tasteWeight,
              source: 'spotify',
            })),
          ],
        },
        { listeningSources: [source] },
        4,
      )
      expect(similarCalls(source).map(([name]) => name)).toEqual([
        'Radiohead',
        'Portishead',
        'Invalid 0',
        'Invalid 1',
      ])
      expect(random).not.toHaveBeenCalled()
    } finally {
      random.mockRestore()
    }
  })

  it('deduplicates mixed seeds by identity and fills sparse library slots from listening', async () => {
    const source = makeLb()
    const onSeedCount = vi.fn()
    const listening = [
      { name: 'Strong', mbid: 'strong' },
      { name: 'Echo' },
      { name: 'Echo', mbid: 'echo-one' },
      { name: 'Café' },
      { name: 'The Echo' },
      { name: 'Echo', mbid: 'echo-two' },
      { name: 'Tail', mbid: 'tail' },
    ]
    const library = [
      { name: 'Strong', mbid: 'strong' },
      { name: '  ECHO  ', mbid: '' },
      { name: 'Echo', mbid: 'echo-one' },
      { name: '  CAFÉ  ', mbid: 'cafe' },
      { name: 'Echo', mbid: 'echo-two' },
      { name: 'Echo duplicate', mbid: 'echo-two' },
    ]
    const originalLibrary = structuredClone(library)
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    try {
      await discover(
        {
          ...profile,
          topArtists: listening.map((artist) => ({ ...artist, playCount: 1, source: 'lastfm' })),
        },
        { listeningSources: [source] },
        7,
        library,
        0.4,
        { onSeedCount },
      )
      expect(similarCalls(source)).toEqual([
        ['Strong', 'strong'],
        ['Echo', undefined],
        ['Echo', 'echo-one'],
        ['Café', 'cafe'],
        ['Echo', 'echo-two'],
        ['The Echo', undefined],
        ['Tail', 'tail'],
      ])
      expect(onSeedCount).toHaveBeenCalledWith(7)
      expect(library).toEqual(originalLibrary)
    } finally {
      random.mockRestore()
    }
  })

  it.each([0, 0.5])(
    'enriches listening seeds from matching library IDs at ratio %s',
    async (ratio) => {
      const source = makeLb()
      vi.mocked(source.getSimilarArtists).mockImplementation(async (_name, mbid) =>
        mbid === 'mbid-rh'
          ? [{ name: 'Thom Yorke', similarityScore: 0.9, source: 'listenbrainz' }]
          : [],
      )
      const nameOnlyProfile: TasteProfile = {
        ...profile,
        topArtists: [
          { name: 'Radiohead', playCount: 2, source: 'spotify' },
          { name: 'Other', playCount: 1, source: 'spotify' },
        ],
      }
      const original = structuredClone(nameOnlyProfile)
      const onSeedCount = vi.fn()
      const results = await discover(
        nameOnlyProfile,
        { listeningSources: [source] },
        2,
        [{ name: 'Radiohead', mbid: 'mbid-rh' }],
        ratio,
        { onSeedCount },
      )
      expect(similarCalls(source)).toEqual([
        ['Radiohead', 'mbid-rh'],
        ['Other', undefined],
      ])
      expect(results.map((artist) => artist.name)).toEqual(['Thom Yorke'])
      expect(onSeedCount).toHaveBeenCalledWith(2)
      expect(nameOnlyProfile).toEqual(original)
    },
  )

  it('backfills a library-only scan when the library has fewer unique artists than the cap', async () => {
    const source = makeLb()
    const onSeedCount = vi.fn()
    await discover(
      profile,
      { listeningSources: [source] },
      2,
      [{ name: 'Radiohead', mbid: 'mbid-rh' }],
      1,
      { onSeedCount },
    )
    expect(similarCalls(source)).toEqual([
      ['Radiohead', 'mbid-rh'],
      ['Portishead', 'mbid-ph'],
    ])
    expect(onSeedCount).toHaveBeenCalledWith(2)
  })

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
    ['Sonic Youth Junior', 'A UK drum and bass artist', ['Sonic Youth'], false],
    [
      'Digital Underground',
      'Known for their experimental art rock sound similar to Velvet Underground with droning guitars.',
      ['The Velvet Underground'],
      false,
    ],
    ['Airborne Toxic Event', 'Indie rock band from Los Angeles.', ['Air'], true],
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
    ['Digital Université', 'Velvet Université sounds.', ['Velvet Université'], false],
    [
      'Digital Université',
      'Digital Université differs from Velvet Université.',
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
  ])(
    'bounds AI name/reasoning identity checks for %s: %s',
    async (name, reasoning, seeds, kept) => {
      expect(await aiNames(name, reasoning, seeds)).toEqual(kept ? [name] : [])
    },
  )
})

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

describe('discover() explicit runs', () => {
  it('maps and dedupes discovery-mode candidates without querying sources', async () => {
    const lb = makeLb()
    const base: DiscoveryCandidate = {
      candidateType: 'artist',
      name: 'Stereolab',
      mbid: 'mbid-st',
      provenanceMode: 'labels',
      provenanceProvider: 'discogs',
      confidenceHint: 0.9,
      fallbackUsed: false,
    }

    const results = await discover(profile, { listeningSources: [lb] }, 10, undefined, 0.3, {
      explicitCandidates: [base, { ...base, confidenceHint: 0.7 }],
      explicitRun: true,
    })

    expect(results).toEqual([
      { name: 'Stereolab', mbid: 'mbid-st', similarityScore: 0.9, source: 'labels' },
    ])
    expect(lb.getSimilarArtists).not.toHaveBeenCalled()
  })

  it('returns nothing for zero candidates without calling sources or AI', async () => {
    const lb = makeLb()
    const ai = makeAi()

    const results = await discover(profile, { listeningSources: [lb], ai }, 10, undefined, 0.3, {
      explicitCandidates: [],
      explicitRun: true,
    })

    expect(results).toEqual([])
    expect(lb.getSimilarArtists).not.toHaveBeenCalled()
    expect(ai.getRecommendations).not.toHaveBeenCalled()
  })

  it.each([
    ['keeps distinct release groups for one artist', ['rg-a', 'rg-b'], ['rg-a', 'rg-b']],
    ['collapses a duplicate release group', ['rg-a', 'rg-a'], ['rg-a']],
  ])('%s', async (_name, groups, expected) => {
    const out = await discover(profile, { listeningSources: [], ai: null }, 30, undefined, 0.3, {
      explicitRun: true,
      explicitCandidates: groups.map(albumCandidate),
    })
    expect(out.map((d) => d.releaseGroupMbid).sort()).toEqual(expected)
  })
})
