import type { ReleaseType, ResolvedReleasePolicy } from './types'

export type ReleasePolicyInput = {
  targetConfig?: {
    releaseTypes?: ReleaseType[]
  }
  lidarrDefaults?: {
    metadataProfileId?: number | null
  }
}

export function resolveReleasePolicy(input: ReleasePolicyInput): ResolvedReleasePolicy {
  if (input.targetConfig?.releaseTypes?.length) {
    return { releaseTypes: input.targetConfig.releaseTypes, source: 'target' }
  }

  if (input.lidarrDefaults?.metadataProfileId != null) {
    return { releaseTypes: ['album'], source: 'lidarr' }
  }

  return { releaseTypes: ['album'], source: 'default' }
}
