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
  return candidates.map((candidate) => ({
    name: candidate.candidateType === 'release' ? (candidate.artistName ?? candidate.name) : candidate.name,
    mbid: candidate.mbid,
    similarityScore: candidate.confidenceHint ?? 0.7,
    aiReasoning: candidate.explanationHint,
    suggestedAlbum: candidate.candidateType === 'release' ? candidate.name : undefined,
    source: candidate.provenanceMode,
    sourceUrl: candidate.sourceUrl,
  }))
}
