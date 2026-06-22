// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { coverageToReleaseCandidates } from '@/core/discovery-modes/modes/gap-fill'
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
