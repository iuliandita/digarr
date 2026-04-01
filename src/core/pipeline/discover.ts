import type { DiscoverySource } from '@/core/plugins/types'
import type { AiRecommendation, DiscoveredArtist, TasteProfile } from '@/core/types'

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

export async function discover(
  profile: TasteProfile,
  sources: DiscoverSources,
  topArtistsLimit: number,
  libraryArtists?: Array<{ mbid: string; name: string }>,
  librarySeedRatio = 0.3,
): Promise<DiscoveredArtist[]> {
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
      const tmp = shuffled[i]!
      shuffled[i] = shuffled[j]!
      shuffled[j] = tmp
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
      for (const rec of aiRecs) {
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
