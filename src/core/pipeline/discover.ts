import { discoveryCandidatesToDiscoveredArtists } from '@/core/discovery-modes/candidates'
import type { DiscoveryCandidate } from '@/core/discovery-modes/types'
import type { DiscoverySource } from '@/core/plugins/types'
import { redactSecrets } from '@/core/providers/retry'
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

function normalizeReasoning(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

function sameSeedArtist(
  first: { name: string; mbid?: string },
  second: { name: string; mbid?: string },
  nameMbids: Map<string, Set<string>>,
): boolean {
  const firstMbid = first.mbid?.trim().toLowerCase()
  const secondMbid = second.mbid?.trim().toLowerCase()
  if (firstMbid && secondMbid) return firstMbid === secondMbid
  const name = normalizeReasoning(first.name)
  return (
    name === normalizeReasoning(second.name) &&
    (!(firstMbid || secondMbid) || (nameMbids.get(name)?.size ?? 0) <= 1)
  )
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = shuffled[i]
    const swap = shuffled[j]
    if (current === undefined || swap === undefined) {
      throw new Error('Unexpected missing seed artist during shuffle')
    }
    shuffled[i] = swap
    shuffled[j] = current
  }
  return shuffled
}

function fullNamePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, 'gu')
}

function reasoningMentionsTopArtist(
  reasoning: string,
  recName: string,
  topArtistNames: string[],
): boolean {
  const reaNorm = normalizeReasoning(reasoning)
  const recNorm = normalizeName(normalizeReasoning(recName))
  if (reaNorm.includes(recNorm)) return false
  const recTokens: string[] = recNorm.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  if (recTokens.length < 2) return false
  const topNames = topArtistNames.map((name) => normalizeName(normalizeReasoning(name)))
  // Quoted references and longer known names are ambiguous evidence of identity.
  const unquoted = reaNorm.replace(
    /"[^"]*"|(?<![\p{L}\p{M}\p{N}])'[^']*'(?![\p{L}\p{M}\p{N}])|\u201c[^\u201d]*\u201d|\u201e[^\u201c\u201d]*[\u201c\u201d]|\u2018[^\u2019]*\u2019|\u00ab[^\u00bb]*\u00bb|\u300c[^\u300d]*\u300d|\u300e[^\u300f]*\u300f/gu,
    ' ',
  )
  for (const topNorm of topNames) {
    if (recNorm === topNorm) continue
    const topTokens: string[] = topNorm.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
    if (topTokens.length < 2) continue
    const shared = new Set(
      recTokens.filter((token) => token.length >= 5 && topTokens.includes(token)),
    ).size
    if (shared * 2 < recTokens.length || shared * 2 < topTokens.length) continue
    let evidence = unquoted
    for (const longerName of topNames) {
      if (longerName.length > topNorm.length && fullNamePattern(topNorm).test(longerName)) {
        evidence = evidence.replace(fullNamePattern(longerName), ' ')
      }
    }
    if (fullNamePattern(topNorm).test(evidence)) return true
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
  /** Invoked when any seed lookup fails, so callers can surface the real error. */
  onSourceFailure?: (sourceId: string, error: string) => void
  onSeedCount?: (count: number) => void
}

function isDiscoveryCandidate(
  candidate: DiscoveredArtist | DiscoveryCandidate,
): candidate is DiscoveryCandidate {
  return 'candidateType' in candidate
}

function dedupeDiscoveredArtists(candidates: DiscoveredArtist[]): DiscoveredArtist[] {
  const seen = new Set<string>()

  return candidates.filter((candidate) => {
    // Album-kind candidates (gap-fill / release-radar) are identified by their
    // release group, so several albums from one artist all survive. Artist-kind
    // candidates dedup on artist mbid/name as before.
    const key = candidate.releaseGroupMbid
      ? `rg::${candidate.releaseGroupMbid}`
      : candidate.mbid?.trim().toLowerCase() || normalizeName(candidate.name)
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

  const listeningArtists = [...profile.topArtists]
  const tiedArtists = new Map<number, TasteProfile['topArtists']>()
  for (const artist of listeningArtists) {
    if (
      artist.tasteWeight === undefined ||
      !Number.isFinite(artist.tasteWeight) ||
      artist.tasteWeight <= 0
    )
      continue
    const tied = tiedArtists.get(artist.tasteWeight) ?? []
    tied.push(artist)
    tiedArtists.set(artist.tasteWeight, tied)
  }
  for (const [weight, artists] of tiedArtists) tiedArtists.set(weight, shuffle(artists))
  for (const [index, artist] of listeningArtists.entries()) {
    if (artist.tasteWeight === undefined) continue
    const replacement = tiedArtists.get(artist.tasteWeight)?.shift()
    if (replacement) listeningArtists[index] = replacement
  }
  const results: DiscoveredArtist[] = []

  const nameMbids = new Map<string, Set<string>>()
  for (const artist of [...listeningArtists, ...(libraryArtists ?? [])]) {
    const mbid = artist.mbid?.trim().toLowerCase()
    if (!mbid) continue
    const name = normalizeReasoning(artist.name)
    const mbids = nameMbids.get(name) ?? new Set<string>()
    mbids.add(mbid)
    nameMbids.set(name, mbids)
  }
  const seedArtists: TasteProfile['topArtists'] = []
  function addSeeds(artists: TasteProfile['topArtists'], limit: number): void {
    for (const artist of artists) {
      if (seedArtists.length >= limit) break
      if (seedArtists.some((seed) => sameSeedArtist(seed, artist, nameMbids))) continue
      const mbids = nameMbids.get(normalizeReasoning(artist.name))
      const mbid =
        artist.mbid?.trim() || (mbids?.size === 1 ? mbids.values().next().value : undefined)
      seedArtists.push({ ...artist, ...(mbid ? { mbid } : {}) })
    }
  }

  if (libraryArtists && libraryArtists.length > 0 && librarySeedRatio > 0) {
    const librarySlots = Math.min(
      topArtistsLimit,
      Math.max(1, Math.round(topArtistsLimit * librarySeedRatio)),
    )
    const listeningSlots = topArtistsLimit - librarySlots
    addSeeds(listeningArtists, listeningSlots)
    addSeeds(
      shuffle(libraryArtists).map((a) => ({
        name: a.name,
        mbid: a.mbid,
        playCount: 0,
        source: 'listenbrainz',
      })),
      topArtistsLimit,
    )
  }
  addSeeds(listeningArtists, topArtistsLimit)

  options.onSeedCount?.(seedArtists.length)
  const listeningSources = (sources.listeningSources ?? []).filter((source) =>
    source.capabilities.includes('similarArtists'),
  )

  // For each seed artist, query each configured listening source for similar artists
  // Aggregate per-source failures so a dead source is logged once, not per seed.
  const sourceFailures = new Map<string, { count: number; lastError: string }>()
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
        } catch (err) {
          const prev = sourceFailures.get(source.id)
          sourceFailures.set(source.id, {
            count: (prev?.count ?? 0) + 1,
            lastError: redactSecrets(err instanceof Error ? err.message : String(err)),
          })
        }
      }
    }),
  )
  for (const [sourceId, { count, lastError }] of sourceFailures) {
    console.warn(
      `[discover] source ${sourceId} failed for ${count} seed artist(s); last error: ${lastError}`,
    )
    options.onSourceFailure?.(sourceId, lastError)
  }

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
    } catch (err) {
      const detail = redactSecrets(err instanceof Error ? err.message : String(err))
      console.warn(`[discover] AI source failed: ${detail}`)
      options.onSourceFailure?.('ai', detail)
    }
  }

  return results
}
