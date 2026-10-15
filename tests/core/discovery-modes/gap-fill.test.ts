// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  coverageToReleaseCandidates,
  createGapFillMode,
} from '@/core/discovery-modes/modes/gap-fill'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import type { AlbumCoverage } from '@/core/library/album-coverage'

const coverage: AlbumCoverage = {
  artistMbid: 'artist-1',
  ownedCount: 1,
  totalCount: 3,
  owned: [{ albumMbid: 'rg-owned', title: 'Pablo Honey', releaseYear: 1993 }],
  missing: [
    { albumMbid: 'rg-bends', title: 'The Bends', releaseYear: 1995 },
    { albumMbid: 'rg-okc', title: 'OK Computer', releaseYear: 1997 },
  ],
}

describe('coverageToReleaseCandidates', () => {
  it('emits one release candidate per missing album', () => {
    const out = coverageToReleaseCandidates(coverage, 'Radiohead')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      candidateType: 'release',
      artistName: 'Radiohead',
      artistMbid: 'artist-1',
      releaseGroupMbid: 'rg-bends',
      name: 'The Bends',
      freshnessDate: '1995',
      provenanceProvider: 'gap-fill',
      fallbackUsed: false,
    })
  })

  it('returns nothing when no albums are missing', () => {
    expect(coverageToReleaseCandidates({ ...coverage, missing: [] }, 'Radiohead')).toEqual([])
  })

  it('omits freshnessDate when releaseYear is null', () => {
    const out = coverageToReleaseCandidates(
      { ...coverage, missing: [{ albumMbid: 'rg-x', title: 'X', releaseYear: null }] },
      'Radiohead',
    )
    expect(out[0]?.freshnessDate).toBeUndefined()
  })
})

describe('createGapFillMode executor', () => {
  it('emits candidates for missing albums and marks artists checked', async () => {
    const getArtists = vi.fn().mockResolvedValue([
      { id: 1, mbid: 'artist-1', name: 'Radiohead' },
      { id: 2, mbid: 'artist-2', name: 'Portishead' },
    ])
    const markChecked = vi.fn().mockResolvedValue(undefined)
    const getCoverage = vi.fn().mockImplementation(async (_userId: number, artistMbid: string) => ({
      artistMbid,
      ownedCount: 0,
      totalCount: 1,
      owned: [],
      missing:
        artistMbid === 'artist-1'
          ? [{ albumMbid: 'rg-bends', title: 'The Bends', releaseYear: 1995 }]
          : [],
    }))

    const mode = createGapFillMode({
      getArtistsForGapFill: getArtists,
      markArtistsGapChecked: markChecked,
      getCoverageForArtist: getCoverage,
      maxArtistsPerRun: 25,
    })

    const result = await mode.executor({
      userId: 7,
      normalizedSettings: {},
      providerContext: {},
    } as DiscoveryModeRequest)

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      releaseGroupMbid: 'rg-bends',
      artistName: 'Radiohead',
    })
    expect(getArtists).toHaveBeenCalledWith(expect.anything(), 7, 25)
    expect(markChecked).toHaveBeenCalledWith(expect.anything(), [1, 2])
  })

  it.each(['mixed', 'all'] as const)(
    'preserves the selected slice on %s lookup failures and returns its candidates on retry',
    async (failureKind) => {
      const getArtists = vi.fn().mockResolvedValue([
        { id: 1, mbid: 'artist-1', name: 'Radiohead' },
        { id: 2, mbid: 'artist-2', name: 'Portishead' },
      ])
      const markChecked = vi.fn().mockResolvedValue(undefined)
      const failure = new Error('MB timeout')
      let failing = true
      const getCoverage = vi
        .fn()
        .mockImplementation(async (_userId: number, artistMbid: string) => {
          if (failing && (failureKind === 'all' || artistMbid === 'artist-2')) {
            throw failure
          }
          return {
            artistMbid,
            ownedCount: 0,
            totalCount: 1,
            owned: [],
            missing: [{ albumMbid: `rg-${artistMbid}`, title: 'Missing album', releaseYear: 1995 }],
          }
        })

      const mode = createGapFillMode({
        getArtistsForGapFill: getArtists,
        markArtistsGapChecked: markChecked,
        getCoverageForArtist: getCoverage,
        maxArtistsPerRun: 25,
      })

      const request = {
        userId: 7,
        normalizedSettings: {},
        providerContext: {},
      } as DiscoveryModeRequest

      await expect(mode.executor(request)).rejects.toBe(failure)
      expect(markChecked).not.toHaveBeenCalled()

      failing = false
      const result = await mode.executor(request)
      expect(result.candidates.map((candidate) => candidate.artistName)).toEqual([
        'Radiohead',
        'Portishead',
      ])
      expect(getArtists).toHaveBeenCalledTimes(2)
      expect(markChecked).toHaveBeenCalledWith(expect.anything(), [1, 2])
      expect(markChecked).toHaveBeenCalledOnce()
    },
  )

  it('settles running and queued coverage lookups before rejecting', async () => {
    vi.useFakeTimers()
    try {
      const failure = new Error('MB timeout')
      let finishRunning!: (coverage: AlbumCoverage) => void
      let finishQueued!: (coverage: AlbumCoverage) => void
      const running = new Promise<AlbumCoverage>((resolve) => {
        finishRunning = resolve
      })
      const queued = new Promise<AlbumCoverage>((resolve) => {
        finishQueued = resolve
      })
      const getCoverage = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockReturnValueOnce(running)
        .mockReturnValueOnce(queued)
      const markChecked = vi.fn()
      const mode = createGapFillMode({
        getArtistsForGapFill: vi.fn().mockResolvedValue([
          { id: 1, mbid: 'artist-1', name: 'Radiohead' },
          { id: 2, mbid: 'artist-2', name: 'Portishead' },
          { id: 3, mbid: 'artist-3', name: 'Broadcast' },
        ]),
        markArtistsGapChecked: markChecked,
        getCoverageForArtist: getCoverage,
      })
      const settled = vi.fn()
      const execution = mode.executor({
        userId: 7,
        normalizedSettings: {},
        providerContext: {},
      } as DiscoveryModeRequest)
      const outcome = execution.then(settled, (error: unknown) => {
        settled()
        return error
      })

      await vi.advanceTimersByTimeAsync(200)
      expect(getCoverage).toHaveBeenCalledTimes(3)
      expect(settled).not.toHaveBeenCalled()
      finishRunning(coverage)
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).not.toHaveBeenCalled()
      finishQueued(coverage)
      expect(await outcome).toBe(failure)
      expect(markChecked).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('advances the rotation after successful empty coverage', async () => {
    const markChecked = vi.fn().mockResolvedValue(undefined)
    const mode = createGapFillMode({
      getArtistsForGapFill: vi
        .fn()
        .mockResolvedValue([{ id: 1, mbid: 'artist-1', name: 'Radiohead' }]),
      markArtistsGapChecked: markChecked,
      getCoverageForArtist: vi.fn().mockResolvedValue({ ...coverage, missing: [] }),
    })
    await expect(
      mode.executor({
        userId: 7,
        normalizedSettings: {},
        providerContext: {},
      } as DiscoveryModeRequest),
    ).resolves.toEqual({ candidates: [] })
    expect(markChecked).toHaveBeenCalledWith(expect.anything(), [1])
  })
})
