import type { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import type { LibrarySyncCounts } from '@/db/schema'
import { normalizeArtistName } from './normalize'
import type { LibraryArtist } from './sources/types'

type MBClient = Pick<
  ReturnType<typeof createMusicBrainzClient>,
  'searchArtist' | 'getReleaseGroups'
>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function mbErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function bumpMbFailed(counts: LibrarySyncCounts): void {
  counts.mbApiCallsFailed = (counts.mbApiCallsFailed ?? 0) + 1
}

export type ReconciledArtist = {
  sourceArtistId: string
  name: string
  nameNormalized: string
  mbid: string | null
  matchMethod: 'mbid' | 'name_exact' | 'name_anchored' | 'name_disambiguated' | null
  matchConfidence: number | null
  unreconciledReason?: 'no_candidate' | 'ambiguous' | 'override_skip'
  genres: string[]
}

export type ReconcilerOverride = { correctMbid: string | null }

export type ReconcilerContext = {
  userId: number | null
  overrides: Map<string, ReconcilerOverride>
  /** MBIDs already known for this user (from sources synced earlier in the run) */
  knownMbids: Set<string>
  mbClient: MBClient
  /**
   * Look up cached, already-reconciled rows from library_artists by normalized name.
   * Used for the Step 2 cache short-circuit. Returns rows the user can see
   * (own per-user rows + global rows) where mbid IS NOT NULL.
   */
  cacheLookup: (
    nameNormalized: string,
  ) => Promise<Array<{ mbid: string; name: string; source: string }>>
  /** Mutable accumulator updated as the run progresses; surfaced to UI */
  counts: LibrarySyncCounts
}

function isValidUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function matchedRow(
  artist: LibraryArtist,
  nameNormalized: string,
  mbid: string,
  method: NonNullable<ReconciledArtist['matchMethod']>,
  confidence: number,
): ReconciledArtist {
  return {
    sourceArtistId: artist.sourceArtistId,
    name: artist.name,
    nameNormalized,
    mbid,
    matchMethod: method,
    matchConfidence: confidence,
    genres: artist.genres ?? [],
  }
}

function unreconciledRow(
  artist: LibraryArtist,
  nameNormalized: string,
  reason: NonNullable<ReconciledArtist['unreconciledReason']>,
): ReconciledArtist {
  return {
    sourceArtistId: artist.sourceArtistId,
    name: artist.name,
    nameNormalized,
    mbid: null,
    matchMethod: null,
    matchConfidence: null,
    unreconciledReason: reason,
    genres: artist.genres ?? [],
  }
}

/**
 * Reconcile a single source artist to a MusicBrainz MBID.
 *
 * 6 ordered steps. Each has a clear terminal state.
 *  0. Override (user assertion beats everything)
 *  1. Source-provided MBID (trust the source)
 *  2. Cache short-circuit + MB API lookup with strict normalize-equal filter
 *  3. Anchor against already-known MBIDs (Task 9)
 *  4. Exact normalized name match (Task 9)
 *  5. Album-overlap disambiguation (Task 10)
 */
export async function reconcileArtist(
  artist: LibraryArtist,
  sourceId: string,
  ctx: ReconcilerContext,
): Promise<ReconciledArtist> {
  ctx.counts.total += 1
  const nameNormalized = normalizeArtistName(artist.name)

  // Step 0: override
  const override = ctx.overrides.get(`${sourceId}:${artist.sourceArtistId}`)
  if (override) {
    if (override.correctMbid === null) {
      return unreconciledRow(artist, nameNormalized, 'override_skip')
    }
    ctx.counts.matchedMbid += 1
    return matchedRow(artist, nameNormalized, override.correctMbid, 'mbid', 1.0)
  }

  // Step 1: source-provided MBID
  if (isValidUuid(artist.mbid)) {
    ctx.counts.matchedMbid += 1
    return matchedRow(artist, nameNormalized, artist.mbid, 'mbid', 1.0)
  }

  // Step 2: cache short-circuit
  const cached = await ctx.cacheLookup(nameNormalized)
  if (cached.length === 1 && cached[0]) {
    ctx.counts.cacheHits += 1
    ctx.counts.matchedNameAnchored += 1
    return matchedRow(artist, nameNormalized, cached[0].mbid, 'name_anchored', 0.85)
  }

  // Cache miss or ambiguous: fall through to MB API.
  // MB errors (5xx, timeout, network) are soft-failed so one flaky upstream
  // call doesn't abort the whole sync. The artist is left unreconciled and
  // will retry on the next sync run.
  ctx.counts.mbApiCalls += 1
  let mbResult: Awaited<ReturnType<MBClient['searchArtist']>>
  try {
    mbResult = await ctx.mbClient.searchArtist(nameNormalized)
  } catch (err) {
    bumpMbFailed(ctx.counts)
    console.warn(
      `[library-reconcile] MB searchArtist failed for "${artist.name}"; leaving unreconciled: ${mbErrorMessage(err)}`,
    )
    ctx.counts.unreconciledNoCandidate += 1
    return unreconciledRow(artist, nameNormalized, 'no_candidate')
  }
  const candidates = (mbResult.artists ?? []).filter(
    (c) => normalizeArtistName(c.name) === nameNormalized,
  )

  if (candidates.length === 0) {
    ctx.counts.unreconciledNoCandidate += 1
    return unreconciledRow(artist, nameNormalized, 'no_candidate')
  }

  // Step 3: anchor against already-known MBIDs from earlier sources
  const anchored = candidates.filter((c) => ctx.knownMbids.has(c.id))
  if (anchored.length === 1 && anchored[0]) {
    ctx.counts.matchedNameAnchored += 1
    return matchedRow(artist, nameNormalized, anchored[0].id, 'name_anchored', 0.85)
  }

  // Step 4: exact normalized-name match (only when there's exactly one candidate)
  if (candidates.length === 1 && candidates[0]) {
    ctx.counts.matchedNameExact += 1
    return matchedRow(artist, nameNormalized, candidates[0].id, 'name_exact', 0.7)
  }

  // Step 5: album-overlap disambiguation
  const sourceAlbumTitles = artist.knownAlbumTitles ?? []
  if (sourceAlbumTitles.length > 0 && candidates.length >= 2) {
    const normalizedSourceTitles = new Set(sourceAlbumTitles.map(normalizeArtistName))
    const scored = await Promise.all(
      candidates.map(async (c) => {
        try {
          const releaseGroups = await ctx.mbClient.getReleaseGroups(c.id)
          const mbTitles = new Set(releaseGroups.map((rg) => normalizeArtistName(rg.title)))
          let overlap = 0
          for (const t of normalizedSourceTitles) {
            if (mbTitles.has(t)) overlap += 1
          }
          return { candidate: c, overlap }
        } catch (err) {
          bumpMbFailed(ctx.counts)
          console.warn(
            `[library-reconcile] MB getReleaseGroups failed for candidate ${c.id} of "${artist.name}"; treating as zero overlap: ${mbErrorMessage(err)}`,
          )
          return { candidate: c, overlap: 0 }
        }
      }),
    )
    scored.sort((a, b) => b.overlap - a.overlap)
    const winner = scored[0]
    const runnerUp = scored[1]
    if (
      winner &&
      winner.overlap >= 2 &&
      (runnerUp === undefined || runnerUp.overlap === 0 || winner.overlap >= 2 * runnerUp.overlap)
    ) {
      ctx.counts.matchedDisambiguated += 1
      return matchedRow(artist, nameNormalized, winner.candidate.id, 'name_disambiguated', 0.5)
    }
  }

  // Fall through to ambiguous when disambiguation can't decide
  ctx.counts.unreconciledAmbiguous += 1
  return unreconciledRow(artist, nameNormalized, 'ambiguous')
}
