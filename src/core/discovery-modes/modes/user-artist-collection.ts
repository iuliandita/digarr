import type { OAuthProvider } from '@/core/provider-auth'
import type {
  DiscoveryConfigField,
  DiscoveryModeDefinition,
  DiscoveryModeStability,
} from '../types'
import { getNormalizedLimit, requireDiscoveryModeProviderToken } from './runtime'

export type UserArtistCollectionSpec = {
  id: string
  label: string
  description: string
  provider: OAuthProvider
  stability?: DiscoveryModeStability
  /** Artist names from the user's collection on that provider, newest/most relevant first. */
  fetchArtists: (token: string, limit: number) => Promise<Array<{ name: string }>>
}

const LIMIT_FIELDS: DiscoveryConfigField[] = [
  {
    key: 'limit',
    label: 'discoveryMode.field.limit',
    type: 'number',
    required: false,
  },
]

/**
 * Build a discovery mode that reads a user's own artist collection from an
 * OAuth-connected provider. Every such mode differs only in which endpoint it
 * calls, so the fields, limit clamping, and candidate shape live here.
 */
export function createUserArtistCollectionMode(
  spec: UserArtistCollectionSpec,
): DiscoveryModeDefinition {
  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    availability: 'fallback',
    ...(spec.stability ? { stability: spec.stability } : {}),
    easyFields: LIMIT_FIELDS,
    advancedFields: LIMIT_FIELDS,
    executor: async (request) => {
      const token = await requireDiscoveryModeProviderToken(request.userId, spec.provider)
      const limit = getNormalizedLimit(request, 50, 100)
      const artists = await spec.fetchArtists(token, limit)

      const candidates = artists.map((a) => ({
        candidateType: 'artist' as const,
        name: a.name,
        mbid: undefined,
        provenanceProvider: spec.provider,
        fallbackUsed: true,
      }))

      return { candidates }
    },
  }
}
