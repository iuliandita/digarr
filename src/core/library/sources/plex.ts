import type { createPlexClient } from '@/core/clients/plex'
import type { LibraryArtist, LibrarySource } from './types'

type PlexClient = ReturnType<typeof createPlexClient>

/**
 * Wraps the existing Plex client as a LibrarySource. The default Plex
 * Music agent does not store MBIDs, so mbidQuality is 'low' -- the
 * reconciler will name-match against MusicBrainz and anchor against
 * Lidarr/Jellyfin rows when possible.
 *
 * Plex is per-user (each Digarr user can configure their own Plex server).
 */
export function createPlexLibrarySource(client: PlexClient, userId: number): LibrarySource {
  return {
    id: 'plex',
    name: 'Plex',
    capabilities: ['listArtists'],
    userId,
    mbidQuality: 'low',

    async listArtists(): Promise<LibraryArtist[]> {
      const artists = await client.getAllArtists()
      return artists.map((a) => ({
        sourceArtistId: a.ratingKey,
        name: a.name,
        mbid: undefined, // default Plex agent has no MBIDs
        genres: a.genres,
      }))
    },

    testConnection() {
      return client.testConnection()
    },
  }
}
