export const RELEASE_TYPES = ['album', 'ep', 'single', 'compilation', 'live', 'other'] as const
export type ReleaseType = (typeof RELEASE_TYPES)[number]

export const QUALITY_PREFERENCES = ['flac_preferred', 'mp3_preferred'] as const
export type QualityPreference = (typeof QUALITY_PREFERENCES)[number]

export type ResolvedReleasePolicySource = 'default' | 'lidarr' | 'target'
export type ResolvedQualityPolicySource = 'default' | 'lidarr' | 'target'

export type ResolvedReleasePolicy = {
  releaseTypes: ReleaseType[]
  source: ResolvedReleasePolicySource
}

export type ResolvedQualityPolicy = {
  preference: QualityPreference
  source: ResolvedQualityPolicySource
}

export type SlskdMatchRelease = {
  artistName: string
  title: string
  qualityPreference?: QualityPreference
}

export type SlskdMatchScore = {
  confidence: number
  artistMatch: boolean
  titleMatch: boolean
  qualityMatch: boolean
  normalizedArtist: string
  normalizedTitle: string
  normalizedCandidateArtist: string
  normalizedCandidateTitle: string
}

export type SlskdMatchDecision =
  | {
      status: 'auto_queue'
      candidate: import('@/core/clients/slskd').SlskdSearchResult
      confidence: number
    }
  | {
      status: 'needs_review'
      confidence: number
      reason: 'low_confidence' | 'ambiguous'
    }

