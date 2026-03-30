import type { ScoredArtist } from '@/core/types'

export function filter(
  artists: ScoredArtist[],
  libraryMbids: Set<string>,
  rejectedMbids: Set<string> | Map<string, Date>,
  cooldownDays: number,
  scoreThreshold: number,
  topArtistNames?: Set<string>,
): ScoredArtist[] {
  const now = new Date()
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000

  return artists.filter((artist) => {
    // Remove artists already in library
    if (libraryMbids.has(artist.mbid)) return false

    // Remove artists the user already listens to (by name)
    if (topArtistNames?.has(artist.name.toLowerCase())) return false

    // Remove artists rejected within the cooldown window
    if (rejectedMbids instanceof Map) {
      const rejectedAt = rejectedMbids.get(artist.mbid)
      if (rejectedAt !== undefined) {
        const elapsed = now.getTime() - rejectedAt.getTime()
        if (elapsed < cooldownMs) return false
      }
    } else {
      // Set<string>: DB query already applied cooldown window filter
      if (rejectedMbids.has(artist.mbid)) return false
    }

    // Remove artists below score threshold
    if (artist.score < scoreThreshold) return false

    return true
  })
}
