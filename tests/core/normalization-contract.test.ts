// @vitest-environment node
// Persisted-key contract: changing any expected value here needs the migration plan in docs/NORMALIZATION.md.
import { describe, expect, it } from 'vitest'
import { normalizeAlbumTitle, normalizeArtistName } from '@/core/library/normalize'
import { artistKey } from '@/core/pipeline/genre-backfill'
import { artistMetadataKey } from '@/db/queries/artist-metadata'

const nfd = (s: string) => s.normalize('NFD')

// [input, normalizeArtistName, trim + lowercase]
const artistCases: Array<[string, string, string]> = [
  ['Beyoncé', 'beyonce', 'beyoncé'],
  ['Beyoncé', 'beyonce', 'beyoncé'],
  ['Sigur Rós', 'sigur ros', 'sigur rós'],
  ['Mötley Crüe', 'motley crue', 'mötley crüe'],
  ['Mø', 'mø', 'mø'],
  ['İlhan', 'ilhan', 'i̇lhan'],
  ['Madness (UK)', 'madness', 'madness (uk)'],
  ['Nirvana (US band)', 'nirvana', 'nirvana (us band)'],
  ['DJ Snake feat. Lil Jon', 'dj snake', 'dj snake feat. lil jon'],
  ['Daft Punk featuring Pharrell', 'daft punk', 'daft punk featuring pharrell'],
  ['Jay-Z ft. Beyoncé', 'jay-z', 'jay-z ft. beyoncé'],
  ['The Beatles', 'beatles', 'the beatles'],
  ['Tyler, The Creator', 'tyler, creator', 'tyler, the creator'],
  ['Theatre of Tragedy', 'theatre of tragedy', 'theatre of tragedy'],
  ['Earth, Wind & Fire', 'earth, wind and fire', 'earth, wind & fire'],
  ['Simon&Garfunkel', 'simon&garfunkel', 'simon&garfunkel'],
  ['坂本龍一', '坂本龍一', '坂本龍一'],
  ['방탄소년단', nfd('방탄소년단'), '방탄소년단'],
  ['きゃりーぱみゅぱみゅ', nfd('きゃりーぱみゅぱみゅ'), 'きゃりーぱみゅぱみゅ'],
  ['ＢＴＳ', 'ｂｔｓ', 'ｂｔｓ'],
  ['Кино', 'кино', 'кино'],
  ['  Radiohead  ', 'radiohead', 'radiohead'],
  ['Sonic\tYouth', 'sonic youth', 'sonic\tyouth'],
  ['Sonic   Youth', 'sonic youth', 'sonic   youth'],
  ['Sonic Youth', 'sonic youth', 'sonic youth'],
  ['MGMT', 'mgmt', 'mgmt'],
  ['   ', '', ''],
]

describe('persisted artist name keys', () => {
  it.each(artistCases)('%j', (input, normalized, lowered) => {
    expect(normalizeArtistName(input)).toBe(normalized)
    expect(artistKey(input)).toBe(lowered)
    expect(artistMetadataKey(input)).toBe(lowered)
  })
})

describe('persisted album title key', () => {
  it.each([
    ['OK Computer (Deluxe Edition)', 'ok computer'],
    ['Rumours [2004 Remaster]', 'rumours'],
    ['Abbey Road (Remastered 2009)', 'abbey road'],
    ['Live (at Leeds)', 'live (at leeds)'],
    ['Café Tacvba  ', 'cafe tacvba'],
    ['ＯＫ', 'ｏｋ'],
  ])('%j', (input, expected) => {
    expect(normalizeAlbumTitle(input)).toBe(expected)
  })
})
