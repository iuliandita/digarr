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

  it('advances the rotation cursor even when a coverage lookup throws', async () => {
    const getArtists = vi.fn().mockResolvedValue([
      { id: 1, mbid: 'artist-1', name: 'Radiohead' },
      { id: 2, mbid: 'artist-2', name: 'Portishead' },
    ])
    const markChecked = vi.fn().mockResolvedValue(undefined)
    const getCoverage = vi.fn().mockImplementation(async (_userId: number, artistMbid: string) => {
      if (artistMbid === 'artist-2') {
        throw new Error('MB timeout')
      }
      return {
        artistMbid,
        ownedCount: 0,
        totalCount: 1,
        owned: [],
        missing: [{ albumMbid: 'rg-bends', title: 'The Bends', releaseYear: 1995 }],
      }
    })

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
    expect(markChecked).toHaveBeenCalledWith(expect.anything(), [1, 2])
  })
})
