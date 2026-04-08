import type { createMusicBrainzClient } from '@/core/clients/musicbrainz'

type MBClient = Pick<ReturnType<typeof createMusicBrainzClient>, 'getReleaseGroups'>

type OwnedAlbum = {
  albumMbid: string
  title: string
  releaseYear: number | null
}

type CoverageAlbum = {
  albumMbid: string
  title: string
  releaseYear: number | null
}

export type AlbumCoverage = {
  isHidden: boolean
  ownedCount: number
  totalCount: number
  owned: CoverageAlbum[]
  missing: CoverageAlbum[]
}

export function createAlbumCoverageService(deps: {
  store: {
    listOwnedAlbumsForArtist(userId: number, artistMbid: string): Promise<OwnedAlbum[]>
  }
  mbClient: MBClient
}) {
  return {
    async getCoverage(userId: number, artistMbid: string): Promise<AlbumCoverage> {
      const [ownedAlbums, releaseGroups] = await Promise.all([
        deps.store.listOwnedAlbumsForArtist(userId, artistMbid),
        deps.mbClient.getReleaseGroups(artistMbid),
      ])

      const ownedByMbid = new Map(ownedAlbums.map((album) => [album.albumMbid, album]))
      const studioAlbums = releaseGroups
        .filter((releaseGroup) => releaseGroup.type === 'Album')
        .map((releaseGroup) => ({
          albumMbid: releaseGroup.id,
          title: releaseGroup.title,
          releaseYear:
            typeof releaseGroup.firstReleaseDate === 'string' &&
            releaseGroup.firstReleaseDate.length >= 4
              ? Number.parseInt(releaseGroup.firstReleaseDate.slice(0, 4), 10)
              : null,
        }))

      const owned = studioAlbums.filter((album) => ownedByMbid.has(album.albumMbid))
      const missing = studioAlbums.filter((album) => !ownedByMbid.has(album.albumMbid))

      return {
        isHidden: studioAlbums.length === 0,
        ownedCount: owned.length,
        totalCount: studioAlbums.length,
        owned,
        missing,
      }
    },
  }
}
