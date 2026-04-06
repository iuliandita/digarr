import type { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import type { LibrarySyncCounts } from '@/db/schema'
import { normalizeArtistName } from './normalize'
import type { LibraryArtist } from './sources/types'

type MBClient = Pick<
  ReturnType<typeof createMusicBrainzClient>,
  'searchArtist' | 'getReleaseGroups'
>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  // Cache miss or ambiguous: fall through to MB API
  ctx.counts.mbApiCalls += 1
  const mbResult = await ctx.mbClient.searchArtist(nameNormalized)
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

  // Step 5 (Task 10) will go here. For now: ambiguous.
  ctx.counts.unreconciledAmbiguous += 1
  return unreconciledRow(artist, nameNormalized, 'ambiguous')
}
