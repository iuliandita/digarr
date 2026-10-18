import { type createMusicBrainzClient, MusicBrainzHttpError } from '@/core/clients/musicbrainz'
import { isSpecialPurposeArtist } from '@/core/clients/musicbrainz-special-purpose'

type MBClient = Pick<ReturnType<typeof createMusicBrainzClient>, 'getReleaseGroups'>

type OwnedAlbum = {
  source: string
  sourceAlbumId: string
  albumMbid: string
  title: string
  releaseYear: number | null
  primaryType: string | null
}

type CoverageAlbum = {
  albumMbid: string
  title: string
  releaseYear: number | null
}

export type AlbumCoverage = {
  artistMbid: string
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
    async getCoverageForArtist(userId: number, artistMbid: string): Promise<AlbumCoverage> {
      if (isSpecialPurposeArtist(artistMbid)) {
        return { artistMbid, ownedCount: 0, totalCount: 0, owned: [], missing: [] }
      }
      const [ownedAlbums, releaseGroups] = await Promise.all([
        deps.store.listOwnedAlbumsForArtist(userId, artistMbid),
        deps.mbClient.getReleaseGroups(artistMbid, ['album']).catch((err: unknown) => {
          if (err instanceof MusicBrainzHttpError && err.status === 404) return []
          throw err
        }),
      ])

      const ownedByMbid = new Map(ownedAlbums.map((album) => [album.albumMbid, album]))
      const studioAlbums = releaseGroups
        .filter((releaseGroup) => {
          if (releaseGroup.type !== 'Album') return false
          if (
            !Array.isArray(releaseGroup.secondaryTypes) ||
            !releaseGroup.secondaryTypes.every((type) => typeof type === 'string')
          ) {
            throw new Error(
              `MusicBrainz missing or invalid secondary types for release group ${releaseGroup.id}`,
            )
          }
          return releaseGroup.secondaryTypes.length === 0
        })
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
        artistMbid,
        ownedCount: owned.length,
        totalCount: studioAlbums.length,
        owned,
        missing,
      }
    },
  }
}
