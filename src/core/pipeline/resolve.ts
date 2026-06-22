import { type AudiodbClient, RateLimitedError } from '@/core/clients/audiodb'
import { extractImages, type ImageEntry } from '@/core/clients/image-utils'
import type { MBArtist, MBSearchResult } from '@/core/clients/musicbrainz'
import { parseYear } from '@/core/clients/musicbrainz'
import type { Translator } from '@/core/i18n/translator'
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

interface FanartClient {
  getArtistImages: (mbid: string) => Promise<{ url?: string; logoUrl?: string }>
}

interface MusicinfoClient {
  lookupArtistImages: (mbid: string) => Promise<{ url?: string; logoUrl?: string }>
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
  fanart?: FanartClient | null,
  musicinfo?: MusicinfoClient | null,
  t?: Translator,
  audiodb?: AudiodbClient | null,
): Promise<ResolvedArtist[]> {
  // Album-kind discoveries (gap-fill / release-radar) carry a releaseGroupMbid and
  // must each resolve to their OWN recommendation -- one per release group, even
  // when several share an artist. They skip the artist-dedup grouping below.
  const albumDiscovered = discovered.filter((d) => d.releaseGroupMbid)
  const artistDiscovered = discovered.filter((d) => !d.releaseGroupMbid)

  // Group artist-kind by MBID (if known) then by name, to deduplicate
  const byMbid = new Map<string, DiscoveredArtist[]>()
  const byName = new Map<string, DiscoveredArtist[]>()

  for (const artist of artistDiscovered) {
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

  // Group album-kind by release group: one resolved rec per release group.
  const byReleaseGroup = new Map<string, DiscoveredArtist[]>()
  for (const d of albumDiscovered) {
    const key = d.releaseGroupMbid as string
    const existing = byReleaseGroup.get(key) ?? []
    existing.push(d)
    byReleaseGroup.set(key, existing)
  }

  const total = byMbid.size + byName.size + byReleaseGroup.size
  let current = 0
  const resolved: ResolvedArtist[] = []

  onProgress?.({
    stage: 'resolve',
    current: 0,
    total,
    message: t ? t('pipeline.message.startingResolution') : 'Starting resolution',
  })

  // Resolve artists that already have MBIDs
  for (const [mbid, discoveries] of byMbid) {
    current++
    const artistName = discoveries[0]?.name ?? mbid
    onProgress?.({
      stage: 'resolve',
      current,
      total,
      message: t ? t('pipeline.message.resolvingArtist', artistName) : `Resolving ${artistName}...`,
    })

    try {
      const mbArtist = await mb.lookupArtist(mbid)
      resolved.push(
        await buildResolvedArtist(mbArtist, discoveries, mb, lidarr, fanart, musicinfo, audiodb),
      )
    } catch {
      // Drop unresolvable
    }
  }

  // Search MB for artists without MBIDs
  for (const [_nameLower, discoveries] of byName) {
    current++
    const firstName = discoveries[0]?.name ?? ''
    onProgress?.({
      stage: 'resolve',
      current,
      total,
      message: t ? t('pipeline.message.searchingArtist', firstName) : `Searching ${firstName}...`,
    })
    if (!firstName) continue

    try {
      const searchResult = await mb.searchArtist(firstName)
      const discoveryGenres = discoveries.flatMap((d) => d.genres ?? [])
      const maxCandidates = discoveryGenres.length > 0 ? 5 : 1

      let bestCandidate: MBArtist | null = null
      let bestOverlap = -Infinity

      for (const hit of searchResult.artists.slice(0, maxCandidates)) {
        if (byMbid.has(hit.id)) continue
        try {
          const mbArtist = await mb.lookupArtist(hit.id)

          if (discoveryGenres.length === 0) {
            // No genre data - trust MB search ranking
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

      // Skip when AI provided genres but the best MB candidate has zero overlap --
      // strong signal that the AI confused similarly-named artists (e.g. "Digital
      // Underground" vs "The Velvet Underground"). bestOverlap of -1 means MB had
      // no tags to compare, which is fine - many lesser-known artists lack tags.
      if (discoveryGenres.length > 0 && bestOverlap === 0) continue

      if (!bestCandidate || byMbid.has(bestCandidate.id)) continue
      resolved.push(
        await buildResolvedArtist(
          bestCandidate,
          discoveries,
          mb,
          lidarr,
          fanart,
          musicinfo,
          audiodb,
        ),
      )
      byMbid.set(bestCandidate.id, discoveries)
    } catch {
      // Drop unresolvable
    }
  }

  // Resolve album-kind discoveries: one rec per release group, caching the artist
  // MB lookup so N missing albums for one artist cost a single lookupArtist call.
  const artistLookupCache = new Map<string, MBArtist>()
  for (const [, discoveries] of byReleaseGroup) {
    current++
    const artistMbid = discoveries[0]?.mbid
    const albumTitle = discoveries[0]?.suggestedAlbum ?? ''
    onProgress?.({
      stage: 'resolve',
      current,
      total,
      message: t ? t('pipeline.message.resolvingArtist', albumTitle) : `Resolving ${albumTitle}...`,
    })
    if (!artistMbid) continue
    try {
      let mbArtist = artistLookupCache.get(artistMbid)
      if (!mbArtist) {
        mbArtist = await mb.lookupArtist(artistMbid)
        artistLookupCache.set(artistMbid, mbArtist)
      }
      resolved.push(
        await buildResolvedArtist(mbArtist, discoveries, mb, lidarr, fanart, musicinfo, audiodb),
      )
    } catch {
      // Drop unresolvable
    }
  }

  onProgress?.({
    stage: 'resolve',
    current: total,
    total,
    message: t ? t('pipeline.message.resolutionComplete') : 'Resolution complete',
  })

  // Final dedup. Album-kind keys on (artist, release group) so distinct albums for
  // one artist both survive; artist-kind keys on the artist mbid as before.
  const seenKeys = new Set<string>()
  return resolved.filter((a) => {
    const key =
      a.kind === 'album' && a.releaseGroupMbid ? `${a.mbid}::${a.releaseGroupMbid}` : a.mbid
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
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

    // Step 3: no match - return free text without releaseGroupId
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
  fanart?: FanartClient | null,
  musicinfo?: MusicinfoClient | null,
  audiodb?: AudiodbClient | null,
): Promise<ResolvedArtist> {
  const tags = (mbArtist.tags ?? []).map((t) => t.name)
  const streamingUrls = mb.extractStreamingUrls(mbArtist.relations ?? [])

  // AudioDB first, then Lidarr -> fanart.tv -> musicinfo.pro
  const imageResult = await fetchArtistImage(
    mbArtist.id,
    mbArtist.name,
    audiodb,
    lidarr,
    fanart,
    musicinfo,
  )

  // Album-kind: a discovery from release-radar already knows the real
  // release-group id -- use it directly and skip the lossy title match.
  const albumDiscovery = discoveries.find((d) => d.releaseGroupMbid)
  let kind: 'artist' | 'album' | undefined
  let releaseGroupMbid: string | undefined
  let releaseDate: string | undefined
  let suggestedAlbum: { releaseGroupId?: string; title: string; type?: string } | undefined

  if (albumDiscovery?.releaseGroupMbid) {
    kind = 'album'
    releaseGroupMbid = albumDiscovery.releaseGroupMbid
    releaseDate = albumDiscovery.releaseDate
    suggestedAlbum = {
      releaseGroupId: albumDiscovery.releaseGroupMbid,
      title: albumDiscovery.suggestedAlbum ?? '',
    }
  } else {
    // Artist-kind: recover a release-group id from the free-text AI title.
    const aiSuggestion = discoveries.find((d) => d.suggestedAlbum)?.suggestedAlbum
    suggestedAlbum = aiSuggestion
      ? await matchSuggestedAlbum(aiSuggestion, mbArtist.id, mb)
      : undefined
  }

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
    kind,
    releaseGroupMbid,
    releaseDate,
  }
}

export async function fetchArtistImage(
  mbid: string,
  name: string,
  audiodb?: AudiodbClient | null,
  lidarr?: LidarrLookupClient | null,
  fanart?: FanartClient | null,
  musicinfo?: MusicinfoClient | null,
): Promise<{ url?: string; logoUrl?: string; failed: boolean }> {
  // Primary: AudioDB (MBID first, then name search when MBID yields nothing).
  // A rate-limit error skips straight to the fallback chain (no name search).
  if (audiodb) {
    try {
      const byMbid = await audiodb.getArtistImages(mbid)
      if (byMbid.url) return { ...byMbid, failed: false }
      if (name) {
        const byName = await audiodb.searchArtistByName(name)
        if (byName.url) return { ...byName, failed: false }
      }
    } catch (err) {
      if (!(err instanceof RateLimitedError)) {
        console.warn(`[resolve] audiodb image lookup failed for ${mbid}:`, err)
      }
    }
  }

  // Fallback chain: Lidarr -> fanart.tv -> musicinfo.pro
  if (lidarr) {
    try {
      const results = await lidarr.lookupArtist(`lidarr:${mbid}`)
      const artist = results[0] as { images?: ImageEntry[] } | undefined
      if (artist?.images?.length) {
        const extracted = extractImages(artist.images)
        if (extracted.url) return { ...extracted, failed: false }
      }
    } catch (err) {
      console.warn(`[resolve] Lidarr image lookup failed for ${mbid}:`, err)
    }
  }

  if (fanart) {
    try {
      const result = await fanart.getArtistImages(mbid)
      if (result.url) return { ...result, failed: false }
    } catch (err) {
      console.warn(`[resolve] fanart.tv image lookup failed for ${mbid}:`, err)
    }
  }

  if (musicinfo) {
    try {
      const result = await musicinfo.lookupArtistImages(mbid)
      if (result.url) return { ...result, failed: false }
    } catch (err) {
      console.warn(`[resolve] musicinfo image lookup failed for ${mbid}:`, err)
    }
  }

  return { failed: Boolean(lidarr ?? fanart ?? musicinfo) }
}
