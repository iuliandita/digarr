import type { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { isSpecialPurposeArtist } from '@/core/clients/musicbrainz-special-purpose'
import { errMsg, isValidMbid } from '@/core/validation'
import type { LibrarySyncCounts } from '@/db/schema'
import { normalizeArtistName } from './normalize'
import type { LibraryArtist } from './sources/types'
import type { UnreconciledReason } from './types'

type MBClient = Pick<
  ReturnType<typeof createMusicBrainzClient>,
  'searchArtist' | 'getReleaseGroups'
>

function bumpMbFailed(counts: LibrarySyncCounts): void {
  counts.mbApiCallsFailed = (counts.mbApiCallsFailed ?? 0) + 1
}

function bumpLookupFailed(counts: LibrarySyncCounts): void {
  counts.unreconciledLookupFailed = (counts.unreconciledLookupFailed ?? 0) + 1
}

export type ReconciledArtist = {
  sourceArtistId: string
  name: string
  nameNormalized: string
  mbid: string | null
  matchMethod: 'mbid' | 'name_exact' | 'name_anchored' | 'name_disambiguated' | null
  matchConfidence: number | null
  unreconciledReason?: UnreconciledReason
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
  /** This source's previous matches by sourceArtistId, kept when MusicBrainz is unavailable. */
  previousMatches?: Map<string, PreviousArtistMatch>
  /** Mutable accumulator updated as the run progresses; surfaced to UI */
  counts: LibrarySyncCounts
}

export type PreviousArtistMatch = {
  nameNormalized: string
  mbid: string
  matchMethod: NonNullable<ReconciledArtist['matchMethod']>
  matchConfidence: number | null
}

const MATCH_COUNT_KEY = {
  mbid: 'matchedMbid',
  name_exact: 'matchedNameExact',
  name_anchored: 'matchedNameAnchored',
  name_disambiguated: 'matchedDisambiguated',
} as const

function lookupFailedRow(
  artist: LibraryArtist,
  nameNormalized: string,
  ctx: ReconcilerContext,
): ReconciledArtist {
  const previous = ctx.previousMatches?.get(artist.sourceArtistId)
  if (previous && previous.nameNormalized === nameNormalized) {
    ctx.counts[MATCH_COUNT_KEY[previous.matchMethod]] += 1
    return matchedRow(
      artist,
      nameNormalized,
      previous.mbid,
      previous.matchMethod,
      previous.matchConfidence ?? 0,
    )
  }
  bumpLookupFailed(ctx.counts)
  return unreconciledRow(artist, nameNormalized, 'lookup_failed')
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

type MBSearchArtist = Awaited<ReturnType<MBClient['searchArtist']>>['artists'][number]

function matchesAliasOrSortName(candidate: MBSearchArtist, nameNormalized: string): boolean {
  const names: unknown[] = [candidate['sort-name']]
  if (Array.isArray(candidate.aliases)) {
    for (const alias of candidate.aliases) {
      names.push(alias?.name, alias?.['sort-name'])
    }
  }
  return names.some(
    (name) =>
      typeof name === 'string' &&
      name.trim() !== '' &&
      normalizeArtistName(name) === nameNormalized,
  )
}

/**
 * Reconcile a single source artist to a MusicBrainz MBID.
 *
 * 6 ordered steps. Each has a clear terminal state.
 *  0. Override (user assertion beats everything)
 *  1. Source-provided MBID (trust the source)
 *  2. Cache short-circuit + MB API lookup with strict normalize-equal filter
 *     (primary name first, then aliases and sort name)
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
  if (isValidMbid(artist.mbid)) {
    ctx.counts.matchedMbid += 1
    return matchedRow(artist, nameNormalized, artist.mbid, 'mbid', 1.0)
  }

  // Step 2: cache short-circuit
  // The same artist cached from several sources is one match, not an ambiguity.
  const cachedMbids = new Set((await ctx.cacheLookup(nameNormalized)).map((row) => row.mbid))
  const [cachedMbid] = cachedMbids
  if (cachedMbids.size === 1 && cachedMbid) {
    ctx.counts.cacheHits += 1
    ctx.counts.matchedNameAnchored += 1
    return matchedRow(artist, nameNormalized, cachedMbid, 'name_anchored', 0.85)
  }

  // Cache miss or ambiguous: fall through to MB API.
  // MB errors (5xx, timeout, network) are soft-failed so one flaky upstream
  // call doesn't abort the whole sync. The artist keeps its previous match, or
  // is left unreconciled, and retries on the next sync run.
  ctx.counts.mbApiCalls += 1
  let mbResult: Awaited<ReturnType<MBClient['searchArtist']>>
  try {
    mbResult = await ctx.mbClient.searchArtist(nameNormalized)
  } catch (err) {
    bumpMbFailed(ctx.counts)
    console.warn(`[library-reconcile] MB searchArtist failed for "${artist.name}": ${errMsg(err)}`)
    return lookupFailedRow(artist, nameNormalized, ctx)
  }
  // A primary-name match outranks alias matches, so an alias shared with
  // another artist cannot turn a clean primary match into an ambiguity.
  const searchArtists = mbResult.artists ?? []
  const primaryMatches = searchArtists.filter((c) => normalizeArtistName(c.name) === nameNormalized)
  const candidates =
    primaryMatches.length > 0
      ? primaryMatches
      : searchArtists.filter((c) => matchesAliasOrSortName(c, nameNormalized))

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
        if (isSpecialPurposeArtist(c.id)) {
          return { candidate: c, overlap: 0, lookupFailed: false }
        }
        try {
          const releaseGroups = await ctx.mbClient.getReleaseGroups(c.id)
          const mbTitles = new Set(releaseGroups.map((rg) => normalizeArtistName(rg.title)))
          let overlap = 0
          for (const t of normalizedSourceTitles) {
            if (mbTitles.has(t)) overlap += 1
          }
          return { candidate: c, overlap, lookupFailed: false }
        } catch (err) {
          bumpMbFailed(ctx.counts)
          console.warn(
            `[library-reconcile] MB getReleaseGroups failed for candidate ${c.id} of "${artist.name}": ${errMsg(err)}`,
          )
          return { candidate: c, overlap: 0, lookupFailed: true }
        }
      }),
    )
    if (scored.some((result) => result.lookupFailed)) {
      return lookupFailedRow(artist, nameNormalized, ctx)
    }
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
