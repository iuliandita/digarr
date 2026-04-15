/**
 * Normalize an artist name for comparison.
 *
 * Rules (in order):
 * 1. Normalize NFD and strip diacritics (Unicode combining marks)
 * 2. Lowercase
 * 3. Strip parenthetical disambiguators: "Madness (UK)" -> "madness"
 * 4. Strip "feat./featuring/ft. ..." suffixes
 * 5. Replace " & " with " and "
 * 6. Strip leading "The "
 * 7. Strip interior ", The ": "Tyler, The Creator" -> "tyler, creator"
 * 8. Collapse whitespace and trim
 *
 * Used by the reconciler. Pure function - no I/O, no globals.
 */
export function normalizeArtistName(raw: string): string {
  if (!raw.trim()) return ''

  let s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
  s = s.toLowerCase()
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ') // strip parentheticals
  s = s.replace(/\s+(feat\.?|featuring|ft\.?)\s+.*$/i, '') // strip feat suffix
  s = s.replace(/\s+&\s+/g, ' and ') // & -> and
  s = s.replace(/^the\s+/i, '') // leading "the "
  s = s.replace(/,\s+the\s+/gi, ', ') // interior ", The " (e.g. "Tyler, The Creator")
  s = s.replace(/\s+/g, ' ').trim() // collapse whitespace

  return s
}

export function normalizeAlbumTitle(raw: string): string {
  if (!raw.trim()) return ''

  let s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  s = s.toLowerCase()
  s = s.replace(/\s*\([^)]*\b(?:deluxe|expanded|remaster(?:ed)?|edition)\b[^)]*\)\s*/gi, ' ')
  s = s.replace(/\s*\[[^\]]*\b(?:deluxe|expanded|remaster(?:ed)?|edition)\b[^\]]*\]\s*/gi, ' ')
  s = s.replace(/\s+/g, ' ').trim()

  return s
}
