import type { createLidarrClient } from '@/core/clients/lidarr'
import type { LibraryArtist, LibrarySource } from './types'

type LidarrClient = ReturnType<typeof createLidarrClient>

/**
 * Wraps the existing Lidarr client as a LibrarySource. Lidarr stores
 * MBIDs natively, so mbidQuality is 'high' and the reconciler can use
 * its rows as anchors for low-quality sources.
 *
 * Lidarr is global (one instance per Digarr install), so userId is null.
 */
export function createLidarrLibrarySource(client: LidarrClient): LibrarySource {
  return {
    id: 'lidarr',
    name: 'Lidarr',
    capabilities: ['listArtists'],
    userId: null,
    mbidQuality: 'high',

    async listArtists(): Promise<LibraryArtist[]> {
      const artists = await client.getArtists()
      return artists.map((a) => ({
        sourceArtistId: String(a.id),
        name: a.artistName,
        mbid: a.foreignArtistId,
        genres: a.genres ?? [],
      }))
    },

    testConnection() {
      return client.testConnection()
    },
  }
}
