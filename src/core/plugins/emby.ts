import { createEmbyClient } from '@/core/clients/emby'
import { createJellyfinFamilySource } from './jellyfin-family'
import type { DiscoverySource } from './types'

export function createEmbySource(
  url: string,
  apiKey: string,
  userId: string,
  skipTlsVerify?: boolean,
  libraryId?: string | null,
): DiscoverySource {
  const client = createEmbyClient(url, apiKey, userId, { skipTlsVerify, libraryId })
  return createJellyfinFamilySource({
    id: 'emby',
    name: 'Emby',
    client,
  })
}
