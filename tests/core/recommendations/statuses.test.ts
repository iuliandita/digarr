// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isValidStatus, parseStatusFilter, VALID_STATUSES } from '@/core/recommendations/statuses'

describe('parseStatusFilter', () => {
  it('accepts known statuses', () => {
    expect(parseStatusFilter('approved,rejected')).toEqual(['approved', 'rejected'])
  })

  it('trims whitespace per token', () => {
    expect(parseStatusFilter('approved , rejected ')).toEqual(['approved', 'rejected'])
  })

  it('drops unknown tokens including SQL-looking payloads', () => {
    expect(parseStatusFilter('approved,injection; DROP TABLE,rejected')).toEqual([
      'approved',
      'rejected',
    ])
  })

  it('returns empty when nothing is valid', () => {
    expect(parseStatusFilter('nope,alsonope')).toEqual([])
  })

  it('ignores empty tokens from repeated commas', () => {
    expect(parseStatusFilter('approved,,rejected,')).toEqual(['approved', 'rejected'])
  })
})

describe('isValidStatus', () => {
  it('accepts every listed status', () => {
    for (const status of VALID_STATUSES) {
      expect(isValidStatus(status)).toBe(true)
    }
  })

  it('rejects unknown values', () => {
    expect(isValidStatus('in_progress')).toBe(false)
    expect(isValidStatus('')).toBe(false)
  })
})
