// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeAlbumTitle, normalizeArtistName } from '@/core/library/normalize'

describe('normalizeArtistName()', () => {
  const cases: Array<[string, string]> = [
    ['Beyoncé', 'beyonce'],
    ['The Beatles', 'beatles'],
    ['Tyler, The Creator', 'tyler, creator'],
    ['Madness (UK)', 'madness'],
    ['Earth, Wind & Fire', 'earth, wind and fire'],
    ['Sigur Rós', 'sigur ros'],
    ['  Radiohead  ', 'radiohead'],
    ['DJ Snake feat. Lil Jon', 'dj snake'],
    ['Daft Punk featuring Pharrell', 'daft punk'],
    ['Jay-Z ft. Beyoncé', 'jay-z'],
    ['THE   ROLLING   STONES', 'rolling stones'],
    ['Mötley Crüe', 'motley crue'],
    ['', ''],
    ['   ', ''],
  ]

  it.each(cases)('normalizes "%s" to "%s"', (input, expected) => {
    expect(normalizeArtistName(input)).toBe(expected)
  })

  it('is idempotent', () => {
    const once = normalizeArtistName('The Beatles')
    expect(normalizeArtistName(once)).toBe(once)
  })

  it('handles emoji and weird scripts without throwing', () => {
    expect(() => normalizeArtistName('🎸 The Band 🎸')).not.toThrow()
    expect(() => normalizeArtistName('坂本龍一')).not.toThrow()
  })
})

describe('normalizeAlbumTitle()', () => {
  const cases: Array<[string, string]> = [
    ['Kid A', 'kid a'],
    ['Beyoncé Homecoming', 'beyonce homecoming'],
    ['In Rainbows (Deluxe Edition)', 'in rainbows'],
    ['Discovery [Remastered]', 'discovery'],
    ['  Dummy  ', 'dummy'],
    ['', ''],
  ]

  it.each(cases)('normalizes "%s" to "%s"', (input, expected) => {
    expect(normalizeAlbumTitle(input)).toBe(expected)
  })

  it('does not strip leading "The" from album titles', () => {
    expect(normalizeAlbumTitle('The Album')).toBe('the album')
  })

  it('is idempotent', () => {
    const once = normalizeAlbumTitle('In Rainbows (Deluxe Edition)')
    expect(normalizeAlbumTitle(once)).toBe(once)
  })

  it('does not strip non-marker words that merely contain a marker substring', () => {
    expect(normalizeAlbumTitle('Space (Expedition)')).toBe('space (expedition)')
  })

  it('does not strip non-marker bracketed words that merely contain a marker substring', () => {
    expect(normalizeAlbumTitle('Space [Expedition]')).toBe('space [expedition]')
  })
})
