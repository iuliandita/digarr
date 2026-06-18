import type { ResolvedArtist } from '@/core/types'

export type MetadataLookup = (name: string) => Promise<{
  spotifyGenres: string[] | null
  spotifyPopularity: number | null
} | null>

const SPARSE_THRESHOLD = 2

export async function enrichGenres(
  artists: ResolvedArtist[],
  lookup: MetadataLookup | null,
): Promise<ResolvedArtist[]> {
  if (!lookup) return artists
  return Promise.all(
    artists.map(async (artist) => {
      if (artist.genres.length > SPARSE_THRESHOLD) return artist
      let meta: Awaited<ReturnType<MetadataLookup>>
      try {
        meta = await lookup(artist.name)
      } catch (err) {
        console.error(`[enrich] metadata lookup failed for ${artist.name}:`, err)
        return artist
      }
      if (!meta?.spotifyGenres?.length) return artist
      const existing = new Set(artist.genres.map((g) => g.toLowerCase()))
      const merged = [...artist.genres]
      for (const g of meta.spotifyGenres) {
        if (!existing.has(g.toLowerCase())) merged.push(g)
      }
      return { ...artist, genres: merged, tags: merged }
    }),
  )
}
