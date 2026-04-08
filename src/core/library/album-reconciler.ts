import { type createMusicBrainzClient, parseYear } from '@/core/clients/musicbrainz'
import { normalizeAlbumTitle } from './normalize'
import type { LibraryAlbum } from './sources/types'

type MBClient = Pick<ReturnType<typeof createMusicBrainzClient>, 'getReleaseGroups'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ReconciledAlbum = {
  sourceAlbumId: string
  sourceArtistId: string
  title: string
  titleNormalized: string
  albumMbid: string | null
  artistMbid: string
  releaseYear: number | null
  primaryType: 'Album' | 'EP' | 'Single' | 'Compilation' | 'Live' | 'Other' | null
  matchMethod: 'mbid' | 'title_exact' | 'title_year' | null
  matchConfidence: number | null
}

function makeRow(
  album: LibraryAlbum,
  titleNormalized: string,
  artistMbid: string,
  releaseYear: number | null,
  primaryType: ReconciledAlbum['primaryType'],
  albumMbid: string | null,
  matchMethod: ReconciledAlbum['matchMethod'],
  matchConfidence: number | null,
): ReconciledAlbum {
  return {
    sourceAlbumId: album.sourceAlbumId,
    sourceArtistId: album.sourceArtistId,
    title: album.title,
    titleNormalized,
    albumMbid,
    artistMbid,
    releaseYear,
    primaryType,
    matchMethod,
    matchConfidence,
  }
}

export async function reconcileAlbumsForArtist(
  artistMbid: string,
  albums: LibraryAlbum[],
  deps: { mbClient: MBClient },
): Promise<ReconciledAlbum[]> {
  const releaseGroups = await deps.mbClient.getReleaseGroups(artistMbid)

  return albums.map((album) => {
    const titleNormalized = normalizeAlbumTitle(album.title)
    const direct =
      typeof album.mbid === 'string' && UUID_RE.test(album.mbid)
        ? releaseGroups.find((rg) => rg.id === album.mbid)
        : undefined

    if (direct) {
      return makeRow(
        album,
        titleNormalized,
        artistMbid,
        parseYear(direct.firstReleaseDate) ?? album.releaseYear ?? null,
        (direct.type as ReconciledAlbum['primaryType']) ?? album.primaryType ?? null,
        direct.id,
        'mbid',
        1,
      )
    }

    const candidates = releaseGroups.filter(
      (rg) => normalizeAlbumTitle(rg.title) === titleNormalized,
    )

    if (candidates.length === 1 && candidates[0]) {
      return makeRow(
        album,
        titleNormalized,
        artistMbid,
        parseYear(candidates[0].firstReleaseDate) ?? album.releaseYear ?? null,
        (candidates[0].type as ReconciledAlbum['primaryType']) ?? album.primaryType ?? null,
        candidates[0].id,
        'title_exact',
        0.8,
      )
    }

    if (album.releaseYear != null) {
      const yearMatches = candidates.filter(
        (candidate) => parseYear(candidate.firstReleaseDate) === album.releaseYear,
      )
      const allOtherCandidatesHaveKnownDifferentYears = candidates.every((candidate) => {
        const candidateYear = parseYear(candidate.firstReleaseDate)
        return candidateYear === album.releaseYear || candidateYear !== undefined
      })
      if (yearMatches.length === 1 && yearMatches[0] && allOtherCandidatesHaveKnownDifferentYears) {
        return makeRow(
          album,
          titleNormalized,
          artistMbid,
          album.releaseYear,
          (yearMatches[0].type as ReconciledAlbum['primaryType']) ?? album.primaryType ?? null,
          yearMatches[0].id,
          'title_year',
          0.7,
        )
      }
    }

    return makeRow(
      album,
      titleNormalized,
      artistMbid,
      album.releaseYear ?? null,
      album.primaryType ?? null,
      null,
      null,
      null,
    )
  })
}
