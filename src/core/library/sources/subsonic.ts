import type { createSubsonicClient } from '@/core/clients/subsonic'
import type { LibraryAlbum, LibraryArtist, LibrarySource } from './types'

type SubsonicClient = ReturnType<typeof createSubsonicClient>

/**
 * Wraps the existing Subsonic client as a LibrarySource. Subsonic ID3
 * artists may carry OpenSubsonic MBIDs, but mbidQuality stays 'low' - the
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
    mbidQuality: 'low',

    async listArtists(): Promise<LibraryArtist[]> {
      const artists = await client.getAllArtists()
      const albums = await client.getAllAlbums()
      const titlesByArtist = new Map<string, Set<string>>()
      for (const album of albums) {
        if (!album.title.trim()) continue
        const titles = titlesByArtist.get(album.artistId) ?? new Set<string>()
        titles.add(album.title)
        titlesByArtist.set(album.artistId, titles)
      }
      return artists.map((a) => ({
        sourceArtistId: a.id,
        name: a.name,
        mbid: a.mbid,
        knownAlbumTitles: [...(titlesByArtist.get(a.id) ?? [])],
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
