import type { createEmbyClient } from '@/core/clients/emby'
import type { LibraryAlbum, LibraryArtist, LibrarySource } from './types'

type EmbyClient = ReturnType<typeof createEmbyClient>

/**
 * Wraps the existing Emby client as a LibrarySource. Like Jellyfin, Emby
 * sources MBIDs from MusicBrainz provider IDs, so mbidQuality is 'high'.
 *
 * Emby is per-user.
 */
export function createEmbyLibrarySource(client: EmbyClient, userId: number): LibrarySource {
  return {
    id: 'emby',
    name: 'Emby',
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
