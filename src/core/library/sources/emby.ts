import type { createEmbyClient } from '@/core/clients/emby'
import { createJellyfinFamilyLibrarySource } from './jellyfin-family'
import type { LibrarySource } from './types'

type EmbyClient = ReturnType<typeof createEmbyClient>

/**
 * Wraps the existing Emby client as a LibrarySource. Like Jellyfin, Emby
 * sources MBIDs from MusicBrainz provider IDs, so mbidQuality is 'high'.
 *
 * Emby is per-user.
 */
export function createEmbyLibrarySource(client: EmbyClient, userId: number): LibrarySource {
  return createJellyfinFamilyLibrarySource({
    id: 'emby',
    name: 'Emby',
    client,
    userId,
  })
}
