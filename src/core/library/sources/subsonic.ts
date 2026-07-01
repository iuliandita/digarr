import type { createSubsonicClient } from '@/core/clients/subsonic'
import type { LibraryAlbum, LibraryArtist, LibrarySource } from './types'

type SubsonicClient = ReturnType<typeof createSubsonicClient>

/**
 * Wraps the existing Subsonic client as a LibrarySource. Subsonic ID3
 * artists/albums do not carry MBIDs, so mbidQuality is 'low' - the
 * reconciler will name-match against MusicBrainz and anchor against
 * Lidarr/Jellyfin rows when possible.
 *
 * Subsonic is per-user (each Digarr user can configure their own
 * Subsonic/Navidrome server).
 */
export function createSubsonicLibrarySource(client: SubsonicClient, userId: number): LibrarySource {
  return {
    id: 'subsonic',
    name: 'Subsonic',
    capabilities: ['listArtists', 'listAlbums'],
    userId,
    mbidQuality: 'low', // Subsonic ID3 artists carry no MBIDs; reconciler name-matches

    async listArtists(): Promise<LibraryArtist[]> {
      const artists = await client.getAllArtists()
      return artists.map((a) => ({
        sourceArtistId: a.id,
        name: a.name,
        mbid: undefined,
      }))
    },

    async listAlbums(sourceArtistId): Promise<LibraryAlbum[]> {
      const albums = await client.getAlbumsForArtist(sourceArtistId)
      return albums.map((al) => ({
        sourceAlbumId: al.id,
        sourceArtistId: al.artistId,
        title: al.title,
        mbid: undefined,
        releaseYear: al.releaseYear,
        primaryType: 'Album' as const,
      }))
    },

    testConnection() {
      return client.testConnection()
    },
  }
}
