import type { createLidarrClient } from '@/core/clients/lidarr'
import type { LibraryAlbum, LibraryArtist, LibrarySource } from './types'

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
    capabilities: ['listArtists', 'listAlbums'],
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

    async listAlbums(sourceArtistId): Promise<LibraryAlbum[]> {
      const albums = await client.getAlbums(Number(sourceArtistId))
      return albums.map((album) => ({
        sourceAlbumId: String(album.id),
        sourceArtistId: String(album.artistId),
        title: album.title,
        mbid: album.foreignAlbumId,
        primaryType: album.albumType === 'Album' ? 'Album' : 'Other',
      }))
    },

    testConnection() {
      return client.testConnection()
    },
  }
}
