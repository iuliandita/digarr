import type { QualityPreference, ResolvedQualityPolicy } from './types'

export type QualityPolicyInput = {
  preference?: QualityPreference
  lidarrPreference?: QualityPreference
}

export function resolveQualityPolicy(input: QualityPolicyInput): ResolvedQualityPolicy {
  if (input.preference !== undefined) {
    return { preference: input.preference, source: 'target' }
  }

  if (input.lidarrPreference !== undefined) {
    return { preference: input.lidarrPreference, source: 'lidarr' }
  }

  return { preference: 'flac_preferred', source: 'default' }
}

