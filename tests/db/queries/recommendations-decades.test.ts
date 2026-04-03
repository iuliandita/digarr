// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseDecades } from '@/db/queries/recommendations'

describe('parseDecades', () => {
  it('parses single decade', () => {
    expect(parseDecades('70s')).toEqual([[1970, 1979]])
  })
  it('parses multiple decades', () => {
    expect(parseDecades('70s,90s')).toEqual([
      [1970, 1979],
      [1990, 1999],
    ])
  })
  it('ignores invalid decades', () => {
    expect(parseDecades('70s,invalid,90s')).toEqual([
      [1970, 1979],
      [1990, 1999],
    ])
  })
  it('returns empty for empty string', () => {
    expect(parseDecades('')).toEqual([])
  })
})
