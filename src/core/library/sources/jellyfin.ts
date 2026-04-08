import type { createJellyfinClient } from '@/core/clients/jellyfin'
import type { LibraryAlbum, LibraryArtist, LibrarySource } from './types'

type JellyfinClient = ReturnType<typeof createJellyfinClient>

/**
 * Wraps the existing Jellyfin client as a LibrarySource. Jellyfin populates
 * MBIDs via the MB metadata agent (common setup), so mbidQuality is 'high'.
 *
 * Jellyfin is per-user.
 */
export function createJellyfinLibrarySource(client: JellyfinClient, userId: number): LibrarySource {
  return {
    id: 'jellyfin',
    name: 'Jellyfin',
    capabilities: ['listArtists', 'listAlbums'],
    userId,
    mbidQuality: 'high',

    async listArtists(): Promise<LibraryArtist[]> {
      const artists = await client.getAllArtists()
      return artists.map((a) => ({
        sourceArtistId: a.id,
        name: a.name,
        mbid: a.mbid,
        genres: a.genres,
      }))
    },

    async listAlbums(sourceArtistId): Promise<LibraryAlbum[]> {
      const albums = await client.getAlbumsForArtist(sourceArtistId)
      return albums.map((album) => ({
        sourceAlbumId: album.id,
        sourceArtistId: album.artistId,
        title: album.title,
        mbid: album.mbid,
        releaseYear: album.releaseYear,
        primaryType: album.primaryType,
      }))
    },

    testConnection() {
      return client.testConnection()
    },
  }
}
