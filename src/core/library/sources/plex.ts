import type { createPlexClient } from '@/core/clients/plex'
import type { LibraryAlbum, LibraryArtist, LibrarySource } from './types'

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
    capabilities: ['listArtists', 'listAlbums'],
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

    async listAlbums(sourceArtistId): Promise<LibraryAlbum[]> {
      const albums = await client.getAlbumsForArtist(sourceArtistId)
      return albums.map((album) => ({
        sourceAlbumId: album.ratingKey,
        sourceArtistId: album.artistRatingKey,
        title: album.title,
        mbid: undefined,
        releaseYear: album.releaseYear,
        primaryType: album.primaryType,
      }))
    },

    testConnection() {
      return client.testConnection()
    },
  }
}
