// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { discoveryCandidatesToDiscoveredArtists } from '@/core/discovery-modes/candidates'
import type { DiscoveryCandidate } from '@/core/discovery-modes/types'

function releaseCandidate(over: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    candidateType: 'release',
    name: 'In Rainbows',
    artistName: 'Radiohead',
    artistMbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    releaseGroupMbid: 'rg-in-rainbows',
    freshnessDate: '2007-10-10',
    provenanceProvider: 'listenbrainz',
    provenanceMode: 'release-radar',
    fallbackUsed: false,
    confidenceHint: 0.8,
    ...over,
  } as DiscoveryCandidate
}

describe('discoveryCandidatesToDiscoveredArtists', () => {
  it('carries releaseGroupMbid and releaseDate from release candidates', () => {
    const [out] = discoveryCandidatesToDiscoveredArtists([releaseCandidate()])
    expect(out?.releaseGroupMbid).toBe('rg-in-rainbows')
    expect(out?.releaseDate).toBe('2007-10-10')
    expect(out?.suggestedAlbum).toBe('In Rainbows')
    expect(out?.mbid).toBe('a74b1b7f-71a5-4011-9441-d0b5e4122711')
  })

  it('leaves album fields undefined when the release has no releaseGroupMbid', () => {
    const [out] = discoveryCandidatesToDiscoveredArtists([
      releaseCandidate({ releaseGroupMbid: undefined }),
    ])
    expect(out?.releaseGroupMbid).toBeUndefined()
    expect(out?.suggestedAlbum).toBe('In Rainbows')
  })
})
