// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseDecades } from '@/db/queries/recommendations'

describe('parseDecades', () => {
  it.each([
    ['single decade', '70s', [[1970, 1979]]],
    [
      'multiple decades',
      '70s,90s',
      [
        [1970, 1979],
        [1990, 1999],
      ],
    ],
    [
      'invalid decades ignored',
      '70s,invalid,90s',
      [
        [1970, 1979],
        [1990, 1999],
      ],
    ],
    ['empty string', '', []],
  ])('parses %s', (_name, input, expected) => {
    expect(parseDecades(input)).toEqual(expected)
  })
})
