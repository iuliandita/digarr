import type { createLidarrClient } from '@/core/clients/lidarr'
import type { LibraryAlbum, LibraryArtist, LibrarySource } from './types'

type LidarrClient = ReturnType<typeof createLidarrClient>

const LIDARR_PRIMARY_TYPE_MAP = {
  Album: 'Album',
  EP: 'EP',
  Single: 'Single',
  Compilation: 'Compilation',
  Live: 'Live',
} as const

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
        primaryType:
          LIDARR_PRIMARY_TYPE_MAP[album.albumType as keyof typeof LIDARR_PRIMARY_TYPE_MAP] ??
          'Other',
      }))
    },

    testConnection() {
      return client.testConnection()
    },
  }
}
