import type { QualityPreference, ResolvedQualityPolicy } from './types'

export type QualityPolicyInput = {
  targetConfig?: {
    qualityPreference?: QualityPreference
  }
  lidarrDefaults?: {
    qualityProfileId?: number | null
  }
}

export function resolveQualityPolicy(input: QualityPolicyInput): ResolvedQualityPolicy {
  if (input.targetConfig?.qualityPreference !== undefined) {
    return { preference: input.targetConfig.qualityPreference, source: 'target' }
  }

  if (input.lidarrDefaults?.qualityProfileId != null) {
    return { preference: 'flac_preferred', source: 'lidarr' }
  }

  return { preference: 'flac_preferred', source: 'default' }
}
