// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeArtistName } from '@/core/library/normalize'

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
