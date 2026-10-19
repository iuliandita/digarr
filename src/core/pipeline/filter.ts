import type { ScoredArtist } from '@/core/types'

export function filter(
  artists: ScoredArtist[],
  libraryMbids: Set<string>,
  rejectedMbids: Set<string> | Map<string, Date>,
  blockedMbids: Set<string>,
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

    // Permanent block layer: independent of cooldown, always drops
    if (blockedMbids.has(artist.mbid)) return false

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

/**
 * Drop candidates whose suggested recording is a known recent play. Candidates
 * without a recording MBID are kept: an unknown track is never treated as unheard.
 */
export function excludeRecentlyPlayed<T extends Pick<ScoredArtist, 'suggestedRecording'>>(
  candidates: T[],
  playedRecordingMbids: Set<string>,
): { kept: T[]; excluded: number } {
  if (playedRecordingMbids.size === 0) return { kept: candidates, excluded: 0 }
  const kept = candidates.filter((c) => {
    const mbid = c.suggestedRecording?.mbid
    return !mbid || !playedRecordingMbids.has(mbid)
  })
  return { kept, excluded: candidates.length - kept.length }
}
