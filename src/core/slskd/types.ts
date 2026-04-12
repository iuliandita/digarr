export const RELEASE_TYPES = ['album', 'ep', 'live', 'compilation'] as const
export type ReleaseType = (typeof RELEASE_TYPES)[number]

export const QUALITY_PREFERENCES = [
  'lossless_only',
  'flac_preferred',
  'lossy_fallback',
  'any_audio',
] as const
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
