// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { computeNameRelevance } from '@/core/search/relevance'

describe('computeNameRelevance', () => {
  it.each([
    ['東京事変', '東京事変'],
    ['Кино', 'кино'],
    ['Björk', 'bjork'],
  ])('scores an exact match of %s as 1', (query, candidate) => {
    expect(computeNameRelevance(query, candidate)).toBe(1)
  })

  it('scores unrelated non-Latin names below an exact match', () => {
    expect(computeNameRelevance('東京事変', 'Кино')).toBeLessThan(0.5)
  })
})
