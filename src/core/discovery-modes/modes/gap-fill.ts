import PQueue from 'p-queue'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import type { AlbumCoverage } from '@/core/library/album-coverage'
import { createAlbumCoverageService } from '@/core/library/album-coverage'
import type { GapFillArtist } from '@/db/queries/gap-fill'
import type { DiscoveryModeDefinition, RawDiscoveryCandidate } from '../types'

/**
 * Turn an artist's missing studio albums into `release` discovery candidates.
 * `freshnessDate` is the release year (string) so the album scorer's recency
 * signal applies; omitted when the year is unknown.
 */
export function coverageToReleaseCandidates(
  coverage: AlbumCoverage,
  artistName: string,
): RawDiscoveryCandidate[] {
  return coverage.missing.map((album) => ({
    candidateType: 'release' as const,
    name: album.title,
    artistName,
    artistMbid: coverage.artistMbid,
    releaseGroupMbid: album.albumMbid,
    provenanceProvider: 'gap-fill',
    fallbackUsed: false,
    ...(album.releaseYear != null ? { freshnessDate: String(album.releaseYear) } : {}),
  }))
}

const DEFAULT_MAX_ARTISTS_PER_RUN = 25

type GapFillDeps = {
  getArtistsForGapFill: (db: unknown, userId: number, limit: number) => Promise<GapFillArtist[]>
  markArtistsGapChecked: (db: unknown, ids: number[]) => Promise<void>
  getCoverageForArtist: (userId: number, artistMbid: string) => Promise<AlbumCoverage>
  maxArtistsPerRun?: number
}

/**
 * Build the default production deps (live DB + MusicBrainz + library store).
 * Dynamic imports keep this off the hot module-load path, matching runtime.ts.
 */
async function defaultGapFillDeps(): Promise<GapFillDeps> {
  const [{ db }, gapFill, { createLibrarySyncStore }] = await Promise.all([
    import('@/db'),
    import('@/db/queries/gap-fill'),
    import('@/core/library/store'),
  ])
  const store = createLibrarySyncStore(db)
  const coverage = createAlbumCoverageService({
    store: {
      listOwnedAlbumsForArtist: (userId, artistMbid) =>
        store.listOwnedAlbumsForArtist(userId, artistMbid),
    },
    mbClient: createMusicBrainzClient(),
  })
  return {
    getArtistsForGapFill: (_db, userId, limit) => gapFill.getArtistsForGapFill(db, userId, limit),
    markArtistsGapChecked: (_db, ids) => gapFill.markArtistsGapChecked(db, ids),
    getCoverageForArtist: (userId, artistMbid) => coverage.getCoverageForArtist(userId, artistMbid),
  }
}

export function createGapFillMode(injected?: GapFillDeps): DiscoveryModeDefinition {
  return {
    id: 'gap-fill',
    label: 'Library Gap-Fill',
    description: 'Find studio albums you are missing from artists you already track',
    availability: 'strict',
    easyFields: [],
    advancedFields: [{ key: 'maxArtistsPerRun', label: 'Artists checked per run', type: 'number' }],
    executor: async (request) => {
      const deps = injected ?? (await defaultGapFillDeps())
      const limit = Number(request.normalizedSettings.maxArtistsPerRun)
      const maxArtists =
        deps.maxArtistsPerRun ??
        (Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_MAX_ARTISTS_PER_RUN)

      const artists = await deps.getArtistsForGapFill({}, request.userId, maxArtists)
      if (artists.length === 0) return { candidates: [] }

      // Concurrency 2 + small spacing: one live MB getReleaseGroups call per artist
      // would otherwise starve the event loop (k8s liveness probe gotcha).
      const queue = new PQueue({ concurrency: 2, interval: 200, intervalCap: 2 })
      const perArtist = await Promise.all(
        artists.map((artist) =>
          queue.add(async (): Promise<RawDiscoveryCandidate[]> => {
            try {
              const coverage = await deps.getCoverageForArtist(request.userId, artist.mbid)
              return coverageToReleaseCandidates(coverage, artist.name)
            } catch {
              return []
            }
          }),
        ),
      )

      await deps.markArtistsGapChecked(
        {},
        artists.map((artist) => artist.id),
      )

      const candidates = perArtist
        .filter((entry): entry is RawDiscoveryCandidate[] => Array.isArray(entry))
        .flat()

      return { candidates }
    },
  }
}
