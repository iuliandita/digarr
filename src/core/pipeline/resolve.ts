import type { MBArtist, MBSearchResult } from '@/core/clients/musicbrainz'
import { parseYear } from '@/core/clients/musicbrainz'
import type { DiscoveredArtist, PipelineProgress, ResolvedArtist } from '@/core/types'

interface MusicBrainzClient {
  lookupArtist: (mbid: string) => Promise<MBArtist>
  searchArtist: (query: string) => Promise<MBSearchResult>
  extractStreamingUrls: (
    relations: Array<{ type: string; url?: { resource: string } }>,
  ) => Record<string, string>
  getReleaseGroups?: (
    artistMbid: string,
  ) => Promise<Array<{ id: string; title: string; type: string; firstReleaseDate?: string }>>
}

interface LidarrLookupClient {
  lookupArtist: (term: string) => Promise<unknown[]>
}

/** Fraction of discovery genres found in MB tags. Returns -1 when either list is empty (no data). */
function genreOverlapScore(discoveryGenres: string[], mbTags: Array<{ name: string }>): number {
  if (discoveryGenres.length === 0 || mbTags.length === 0) return -1
  const mbGenres = new Set(mbTags.map((t) => t.name.toLowerCase()))
  const matches = discoveryGenres.filter((g) => mbGenres.has(g.toLowerCase()))
  return matches.length / discoveryGenres.length
}

export async function resolve(
  discovered: DiscoveredArtist[],
  mb: MusicBrainzClient,
  onProgress?: (progress: PipelineProgress) => void,
  lidarr?: LidarrLookupClient | null,
): Promise<ResolvedArtist[]> {
  // Group by MBID (if known) then by name, to deduplicate
  const byMbid = new Map<string, DiscoveredArtist[]>()
  const byName = new Map<string, DiscoveredArtist[]>()

  for (const artist of discovered) {
    if (artist.mbid) {
      const key = artist.mbid
      const existing = byMbid.get(key) ?? []
      existing.push(artist)
      byMbid.set(key, existing)
    } else {
      const key = artist.name.toLowerCase()
      const existing = byName.get(key) ?? []
      existing.push(artist)
      byName.set(key, existing)
    }
  }

  const total = byMbid.size + byName.size
  let current = 0
  const resolved: ResolvedArtist[] = []

  onProgress?.({ stage: 'resolve', current: 0, total, message: 'Starting resolution' })

  // Resolve artists that already have MBIDs
  for (const [mbid, discoveries] of byMbid) {
    current++
    const artistName = discoveries[0]?.name ?? mbid
    onProgress?.({ stage: 'resolve', current, total, message: `Resolving ${artistName}...` })

    try {
      const mbArtist = await mb.lookupArtist(mbid)
      resolved.push(await buildResolvedArtist(mbArtist, discoveries, mb, lidarr))
    } catch {
      // Drop unresolvable
    }
  }

  // Search MB for artists without MBIDs
  for (const [_nameLower, discoveries] of byName) {
    current++
    const firstName = discoveries[0]?.name ?? ''
    onProgress?.({ stage: 'resolve', current, total, message: `Searching ${firstName}...` })
    if (!firstName) continue

    try {
      const searchResult = await mb.searchArtist(firstName)
      const discoveryGenres = discoveries.flatMap((d) => d.genres ?? [])
      const maxCandidates = discoveryGenres.length > 0 ? 5 : 1

      let bestCandidate: MBArtist | null = null
      let bestOverlap = -1

      for (const hit of searchResult.artists.slice(0, maxCandidates)) {
        if (byMbid.has(hit.id)) continue
        try {
          const mbArtist = await mb.lookupArtist(hit.id)

          if (discoveryGenres.length === 0) {
            // No genre data -- trust MB search ranking
            bestCandidate = mbArtist
            break
          }

          const overlap = genreOverlapScore(discoveryGenres, mbArtist.tags ?? [])
          if (overlap > bestOverlap) {
            bestCandidate = mbArtist
            bestOverlap = overlap
          }
          if (overlap > 0) break // good enough
        } catch {
          // skip failed lookup, try next candidate
        }
      }

      if (!bestCandidate || byMbid.has(bestCandidate.id)) continue
      resolved.push(await buildResolvedArtist(bestCandidate, discoveries, mb, lidarr))
      byMbid.set(bestCandidate.id, discoveries)
    } catch {
      // Drop unresolvable
    }
  }

  onProgress?.({ stage: 'resolve', current: total, total, message: 'Resolution complete' })

  // Final dedup by MBID in case search returned same MBID twice
  const seenMbids = new Set<string>()
  return resolved.filter((a) => {
    if (seenMbids.has(a.mbid)) return false
    seenMbids.add(a.mbid)
    return true
  })
}

function normalizeTitle(title: string): string {
  return title
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
    .toLowerCase()
}

async function matchSuggestedAlbum(
  suggestedAlbum: string,
  artistMbid: string,
  mb: MusicBrainzClient,
): Promise<{ releaseGroupId?: string; title: string; type?: string }> {
  if (!mb.getReleaseGroups) {
    return { title: suggestedAlbum }
  }

  try {
    const releaseGroups = await mb.getReleaseGroups(artistMbid)

    // Step 1: exact title match (case-insensitive)
    const exact = releaseGroups.find(
      (rg) => rg.title.toLowerCase() === suggestedAlbum.toLowerCase(),
    )
    if (exact) {
      return { releaseGroupId: exact.id, title: exact.title, type: exact.type }
    }

    // Step 2: normalized match (strip parenthetical suffixes)
    const normalizedSuggestion = normalizeTitle(suggestedAlbum)
    const normalized = releaseGroups.find((rg) => normalizeTitle(rg.title) === normalizedSuggestion)
    if (normalized) {
      return { releaseGroupId: normalized.id, title: normalized.title, type: normalized.type }
    }

    // Step 3: no match -- return free text without releaseGroupId
    return { title: suggestedAlbum }
  } catch {
    return { title: suggestedAlbum }
  }
}

async function buildResolvedArtist(
  mbArtist: MBArtist,
  discoveries: DiscoveredArtist[],
  mb: MusicBrainzClient,
  lidarr?: LidarrLookupClient | null,
): Promise<ResolvedArtist> {
  const tags = (mbArtist.tags ?? []).map((t) => t.name)
  const streamingUrls = mb.extractStreamingUrls(mbArtist.relations ?? [])

  // Get artist image from Lidarr's metadata (fanart.tv)
  const imageResult = await fetchLidarrImage(mbArtist.id, lidarr)

  // Resolve suggested album from AI discoveries
  const aiSuggestion = discoveries.find((d) => d.suggestedAlbum)?.suggestedAlbum
  const suggestedAlbum = aiSuggestion
    ? await matchSuggestedAlbum(aiSuggestion, mbArtist.id, mb)
    : undefined

  return {
    mbid: mbArtist.id,
    name: mbArtist.name,
    disambiguation: mbArtist.disambiguation,
    tags,
    genres: tags,
    imageUrl: imageResult.url,
    logoUrl: imageResult.logoUrl,
    imageFailed: imageResult.failed,
    streamingUrls,
    suggestedAlbum,
    discoveries,
    beginYear: parseYear(mbArtist['life-span']?.begin),
    endYear: parseYear(mbArtist['life-span']?.end),
  }
}

async function fetchLidarrImage(
  mbid: string,
  lidarr?: LidarrLookupClient | null,
): Promise<{ url?: string; logoUrl?: string; failed: boolean }> {
  if (!lidarr) return { failed: false }

  try {
    const results = await lidarr.lookupArtist(`lidarr:${mbid}`)
    const artist = results[0] as
      | { images?: Array<{ coverType: string; remoteUrl?: string }> }
      | undefined
    if (!artist?.images?.length) return { failed: true }

    // Grab clearlogo separately
    const logo = artist.images.find((i) => i.coverType === 'clearlogo' && i.remoteUrl)
    const logoUrl = logo?.remoteUrl

    // Prefer poster/artistthumb, then fanart
    for (const type of ['poster', 'fanart', 'banner']) {
      const img = artist.images.find((i) => i.coverType === type && i.remoteUrl)
      if (img?.remoteUrl) return { url: img.remoteUrl, logoUrl, failed: false }
    }
    // Fall back to any non-clearlogo image with a remoteUrl
    const fallback = artist.images.find((i) => i.coverType !== 'clearlogo' && i.remoteUrl)
    return fallback?.remoteUrl
      ? { url: fallback.remoteUrl, logoUrl, failed: false }
      : { logoUrl, failed: true }
  } catch {
    return { failed: true }
  }
}
