import type { ReleaseType, ResolvedReleasePolicy } from './types'

export type ReleasePolicyInput = {
  releaseTypes?: ReleaseType[]
  lidarrReleaseTypes?: ReleaseType[]
}

export function resolveReleasePolicy(input: ReleasePolicyInput): ResolvedReleasePolicy {
  if (input.releaseTypes !== undefined && input.releaseTypes.length > 0) {
    return { releaseTypes: input.releaseTypes, source: 'target' }
  }

  if (input.lidarrReleaseTypes !== undefined && input.lidarrReleaseTypes.length > 0) {
    return { releaseTypes: input.lidarrReleaseTypes, source: 'lidarr' }
  }

  return { releaseTypes: ['album'], source: 'default' }
}

