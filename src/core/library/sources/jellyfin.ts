import type { createJellyfinClient } from '@/core/clients/jellyfin'
import { createJellyfinFamilyLibrarySource } from './jellyfin-family'
import type { LibrarySource } from './types'

type JellyfinClient = ReturnType<typeof createJellyfinClient>

/**
 * Wraps the existing Jellyfin client as a LibrarySource. Jellyfin populates
 * MBIDs via the MB metadata agent (common setup), so mbidQuality is 'high'.
 *
 * Jellyfin is per-user.
 */
export function createJellyfinLibrarySource(client: JellyfinClient, userId: number): LibrarySource {
  return createJellyfinFamilyLibrarySource({
    id: 'jellyfin',
    name: 'Jellyfin',
    client,
    userId,
  })
}
