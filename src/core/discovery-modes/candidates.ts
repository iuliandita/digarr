import type { DiscoveryCandidate } from './types'

export function normalizeDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  modeId: string,
): DiscoveryCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    provenanceMode: candidate.provenanceMode || modeId,
  }))
}
