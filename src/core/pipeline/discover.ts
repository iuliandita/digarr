import { discoveryCandidatesToDiscoveredArtists } from '@/core/discovery-modes/candidates'
import type { DiscoveryCandidate } from '@/core/discovery-modes/types'
import type { DiscoverySource } from '@/core/plugins/types'
import type { AiRecommendation, DiscoveredArtist, TasteProfile } from '@/core/types'

const ARTICLES = /^(the|a|an)\s+/i

/** Normalize an artist name for comparison: lowercase, strip leading articles. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(ARTICLES, '').trim()
}

/**
 * Detect likely AI name confusion - the model meant to describe a top artist
 * but output a similarly-named different artist. Checks substring containment
 * in both directions (covers "Sonic Youth" in "Sonic Youth Junior").
 */
function hasNameConfusion(recName: string, topArtistNames: string[]): boolean {
  const recNorm = normalizeName(recName)
  for (const topName of topArtistNames) {
    const topNorm = normalizeName(topName)
    if (recNorm === topNorm) continue // exact match handled by topArtistNames filter
    if (topNorm.length < 4) continue // skip very short names to avoid false positives
    if (recNorm.includes(topNorm) || topNorm.includes(recNorm)) return true
  }
  return false
}

/**
 * Detect when AI reasoning explicitly mentions a different top artist by name.
 * E.g. reasoning for "Digital Underground" literally says "Velvet Underground".
 */
function reasoningMentionsTopArtist(
  reasoning: string,
  recName: string,
  topArtistNames: string[],
): boolean {
  const reaNorm = reasoning.toLowerCase()
  const recNorm = normalizeName(recName)
  for (const topName of topArtistNames) {
    const topNorm = normalizeName(topName)
    if (recNorm === topNorm) continue
    if (topNorm.length < 5) continue // avoid matching short common words
    if (reaNorm.includes(topNorm)) return true
  }
  return false
}

interface MusicBrainzSimilarSource {
  searchArtist: (
    query: string,
  ) => Promise<{ artists: Array<{ id: string; name: string; score: number }> }>
}

interface AiSource {
  getRecommendations: (profile: TasteProfile) => Promise<AiRecommendation[]>
}

export interface DiscoverSources {
  /** Listening source plugins (ListenBrainz, Last.fm, etc.) */
  listeningSources?: DiscoverySource[]
  musicbrainz?: MusicBrainzSimilarSource | null
  ai?: AiSource | null
}

export type DiscoverOptions = {
  explicitCandidates?: Array<DiscoveredArtist | DiscoveryCandidate>
  explicitRun?: boolean
}

function isDiscoveryCandidate(
  candidate: DiscoveredArtist | DiscoveryCandidate,
): candidate is DiscoveryCandidate {
  return 'candidateType' in candidate
}

function dedupeDiscoveredArtists(candidates: DiscoveredArtist[]): DiscoveredArtist[] {
  const seen = new Set<string>()

  return candidates.filter((candidate) => {
    const key = candidate.mbid?.trim().toLowerCase() || normalizeName(candidate.name)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export async function discover(
  profile: TasteProfile,
  sources: DiscoverSources,
  topArtistsLimit: number,
  libraryArtists?: Array<{ mbid: string; name: string }>,
  librarySeedRatio = 0.3,
  options: DiscoverOptions = {},
): Promise<DiscoveredArtist[]> {
  if (options.explicitRun) {
    const explicitCandidates = options.explicitCandidates ?? []
    const explicitArtists = explicitCandidates.some(isDiscoveryCandidate)
      ? discoveryCandidatesToDiscoveredArtists(explicitCandidates.filter(isDiscoveryCandidate))
      : (explicitCandidates as DiscoveredArtist[])
    return dedupeDiscoveredArtists(explicitArtists)
  }

  const topArtists = profile.topArtists.slice(0, topArtistsLimit)
  const results: DiscoveredArtist[] = []

  // Mix in library artists based on librarySeedRatio (0 = none, 1 = all library)
  let seedArtists = topArtists
  if (libraryArtists && libraryArtists.length > 0 && librarySeedRatio > 0) {
    const librarySlots = Math.max(1, Math.round(topArtistsLimit * librarySeedRatio))
    const listeningSlots = topArtistsLimit - librarySlots

    // Fisher-Yates shuffle for uniform distribution
    const shuffled = [...libraryArtists]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const current = shuffled[i]
      const swap = shuffled[j]
      if (!current || !swap) {
        throw new Error('Unexpected missing library artist during shuffle')
      }
      shuffled[i] = swap
      shuffled[j] = current
    }
    // Exclude artists already in topArtists
    const topMbids = new Set(topArtists.map((a) => a.mbid).filter(Boolean))
    const librarySeeds = shuffled
      .filter((a) => !topMbids.has(a.mbid))
      .slice(0, librarySlots)
      .map((a) => ({
        name: a.name,
        mbid: a.mbid,
        playCount: 0,
        source: 'listenbrainz' as const,
      }))

    seedArtists = [...topArtists.slice(0, listeningSlots), ...librarySeeds]
  }

  const listeningSources = sources.listeningSources ?? []

  // For each seed artist, query each configured listening source for similar artists
  await Promise.all(
    seedArtists.map(async (artist) => {
      for (const source of listeningSources) {
        try {
          const similar = await source.getSimilarArtists(artist.name, artist.mbid)
          for (const s of similar) {
            results.push({
              name: s.name,
              mbid: s.mbid,
              similarityScore: s.similarityScore,
              source: source.id,
            })
          }
        } catch {
          // Isolate source failure
        }
      }
    }),
  )

  // One AI call with the full profile
  if (sources.ai != null) {
    try {
      const aiRecs = await sources.ai.getRecommendations(profile)
      // Cross-check AI recommendations against the user's top artists to catch
      // name confusion hallucinations (e.g. "Digital Underground" with a
      // description of "Velvet Underground"). Uses the FULL top artists list,
      // not just the seed slice, for maximum coverage.
      const allTopNames = profile.topArtists.map((a) => a.name)
      for (const rec of aiRecs) {
        if (hasNameConfusion(rec.artistName, allTopNames)) continue
        if (reasoningMentionsTopArtist(rec.reasoning, rec.artistName, allTopNames)) continue
        results.push({
          name: rec.artistName,
          similarityScore: rec.confidence,
          aiReasoning: rec.reasoning,
          suggestedAlbum: rec.suggestedAlbum,
          genres: rec.genres,
          source: 'ai',
        })
      }
    } catch {
      // Isolate source failure
    }
  }

  return results
}
