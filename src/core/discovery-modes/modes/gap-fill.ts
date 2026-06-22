import type { AlbumCoverage } from '@/core/library/album-coverage'
import type { RawDiscoveryCandidate } from '../types'

/**
 * Turn an artist's missing studio albums into `release` discovery candidates.
 * `freshnessDate` is the release year (string) so the album scorer's recency
 * signal applies; omitted when the year is unknown.
 */
export function coverageToReleaseCandidates(
  coverage: AlbumCoverage,
  artistName: string,
): RawDiscoveryCandidate[] {
  return coverage.missing.map((album) => ({
    candidateType: 'release' as const,
    name: album.title,
    artistName,
    artistMbid: coverage.artistMbid,
    releaseGroupMbid: album.albumMbid,
    provenanceProvider: 'gap-fill',
    fallbackUsed: false,
    ...(album.releaseYear != null ? { freshnessDate: String(album.releaseYear) } : {}),
  }))
}
