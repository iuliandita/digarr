import type { ServiceTestResult } from '@/core/types'
import type { LibraryAlbum, LibraryArtist, LibrarySource } from './types'

type JellyfinFamilyLibraryClient = {
  getAllArtists(): Promise<Array<{ id: string; name: string; mbid?: string; genres?: string[] }>>
  getAlbumsForArtist(sourceArtistId: string): Promise<
    Array<{
      id: string
      artistId: string
      title: string
      mbid?: string
      releaseYear?: number
      primaryType?: LibraryAlbum['primaryType']
    }>
  >
  testConnection(): Promise<ServiceTestResult>
}

type JellyfinFamilyLibraryOptions = {
  id: 'emby' | 'jellyfin'
  name: 'Emby' | 'Jellyfin'
  client: JellyfinFamilyLibraryClient
  userId: number
}

export function createJellyfinFamilyLibrarySource({
  id,
  name,
  client,
  userId,
}: JellyfinFamilyLibraryOptions): LibrarySource {
  return {
    id,
    name,
    capabilities: ['listArtists', 'listAlbums'],
    userId,
    mbidQuality: 'high',

    async listArtists(): Promise<LibraryArtist[]> {
      const artists = await client.getAllArtists()
      return artists.map((artist) => ({
        sourceArtistId: artist.id,
        name: artist.name,
        mbid: artist.mbid,
        genres: artist.genres,
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
