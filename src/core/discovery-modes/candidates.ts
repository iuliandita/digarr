import type { DiscoveredArtist } from '@/core/types'
import type { DiscoveryCandidate, RawDiscoveryCandidate } from './types'

export function normalizeDiscoveryCandidates(
  candidates: RawDiscoveryCandidate[],
  modeId: string,
): DiscoveryCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    provenanceMode: candidate.provenanceMode || modeId,
  }))
}

export function discoveryCandidatesToDiscoveredArtists(
  candidates: DiscoveryCandidate[],
): DiscoveredArtist[] {
  return candidates.reduce<DiscoveredArtist[]>((results, candidate) => {
    if (candidate.candidateType === 'release') {
      if (!candidate.artistName?.trim()) {
        return results
      }

      results.push({
        name: candidate.artistName,
        mbid: candidate.artistMbid,
        similarityScore: candidate.confidenceHint ?? 0.7,
        aiReasoning: candidate.explanationHint,
        suggestedAlbum: candidate.name,
        source: candidate.provenanceMode,
        sourceUrl: candidate.sourceUrl,
      })
      return results
    }

    results.push({
      name: candidate.name,
      mbid: candidate.mbid,
      similarityScore: candidate.confidenceHint ?? 0.7,
      aiReasoning: candidate.explanationHint,
      source: candidate.provenanceMode,
      sourceUrl: candidate.sourceUrl,
    })
    return results
  }, [])
}
