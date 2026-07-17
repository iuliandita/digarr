import { createSubsonicClient } from '@/core/clients/subsonic'
import type { DiscoveryConfigField, DiscoveryModeDefinition } from '../types'
import {
  getDiscoveryModeConnections,
  getDiscoveryModeSkipTlsVerify,
  getNormalizedLimit,
} from './runtime'

export function createSubsonicStarredMode(): DiscoveryModeDefinition {
  const fields: DiscoveryConfigField[] = [
    {
      key: 'limit',
      label: 'discoveryMode.field.limit',
      type: 'number',
      required: false,
    },
  ]
  return {
    id: 'subsonic-starred',
    label: 'Subsonic Starred',
    description: 'Discover artists similar to the ones you starred on your Subsonic server',
    availability: 'fallback',
    easyFields: fields,
    advancedFields: fields,
    executor: async (request) => {
      const [conns, skipTlsVerify] = await Promise.all([
        getDiscoveryModeConnections(request.userId),
        getDiscoveryModeSkipTlsVerify(),
      ])
      if (!conns?.subsonicUrl || !conns.subsonicUsername || !conns.subsonicPassword) {
        throw new Error('Connect Subsonic to use this mode.')
      }

      const limit = getNormalizedLimit(request, 50, 100)
      const client = createSubsonicClient(
        conns.subsonicUrl,
        conns.subsonicUsername,
        conns.subsonicPassword,
        { skipTlsVerify },
      )
      const starred = await client.getStarredArtists()

      const candidates = starred.slice(0, limit).map((a) => ({
        candidateType: 'artist' as const,
        name: a.name,
        mbid: undefined,
        provenanceProvider: 'subsonic',
        fallbackUsed: true,
      }))

      return { candidates }
    },
  }
}
