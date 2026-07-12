import { createJellyfinClient } from '@/core/clients/jellyfin'
import { createJellyfinFamilySource } from './jellyfin-family'
import type { DiscoverySource } from './types'

export function createJellyfinSource(
  url: string,
  apiKey: string,
  userId: string,
  skipTlsVerify?: boolean,
  libraryId?: string | null,
): DiscoverySource {
  const client = createJellyfinClient(url, apiKey, userId, { skipTlsVerify, libraryId })
  return createJellyfinFamilySource({
    id: 'jellyfin',
    name: 'Jellyfin',
    client,
  })
}
