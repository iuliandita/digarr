import { type createMusicBrainzClient, parseYear } from '@/core/clients/musicbrainz'
import { isValidMbid } from '@/core/validation'
import { normalizeAlbumTitle } from './normalize'
import type { LibraryAlbum } from './sources/types'
import type { UnreconciledReason } from './types'

type MBClient = Pick<ReturnType<typeof createMusicBrainzClient>, 'getReleaseGroups'>

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
  unreconciledReason: UnreconciledReason | null
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
  unreconciledReason: UnreconciledReason | null = null,
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
    unreconciledReason,
  }
}

export async function reconcileAlbumsForArtist(
  artistMbid: string,
  albums: LibraryAlbum[],
  deps: {
    mbClient: MBClient
    /**
     * Invoked when MB getReleaseGroups throws (5xx, timeout, network). Albums
     * for this artist fall through to `albumMbid: null` rather than aborting
     * the sync.
     */
    onMbError?: (err: unknown) => void
  },
): Promise<ReconciledAlbum[]> {
  let releaseGroups: Awaited<ReturnType<MBClient['getReleaseGroups']>>
  let releaseGroupLookupFailed = false
  try {
    releaseGroups = await deps.mbClient.getReleaseGroups(artistMbid)
  } catch (err) {
    releaseGroupLookupFailed = true
    deps.onMbError?.(err)
    console.warn(
      `[library-reconcile] MB getReleaseGroups failed for artist ${artistMbid}; albums left unreconciled: ${err instanceof Error ? err.message : String(err)}`,
    )
    releaseGroups = []
  }

  return albums.map((album) => {
    const titleNormalized = normalizeAlbumTitle(album.title)

    if (releaseGroupLookupFailed) {
      return makeRow(
        album,
        titleNormalized,
        artistMbid,
        album.releaseYear ?? null,
        album.primaryType ?? null,
        null,
        null,
        null,
        'lookup_failed',
      )
    }

    const direct = isValidMbid(album.mbid)
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

    if (candidates.length === 0) {
      return makeRow(
        album,
        titleNormalized,
        artistMbid,
        album.releaseYear ?? null,
        album.primaryType ?? null,
        null,
        null,
        null,
        'no_candidate',
      )
    }

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
      // Only a confident year match when every candidate has a known year: an
      // unknown-year candidate could share album.releaseYear, which would make
      // the single match ambiguous rather than unique.
      const allCandidatesHaveKnownYears = candidates.every(
        (candidate) => parseYear(candidate.firstReleaseDate) !== undefined,
      )
      if (yearMatches.length === 1 && yearMatches[0] && allCandidatesHaveKnownYears) {
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
      'ambiguous',
    )
  })
}
