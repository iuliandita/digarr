import { describe, expect, it } from 'vitest'
import { isValidRejectionReason, REJECTION_REASONS } from '@/core/recommendations/rejection-reasons'

describe('REJECTION_REASONS', () => {
  it('contains the 6 expected reasons in fixed order', () => {
    expect(REJECTION_REASONS).toEqual([
      'already_own',
      'wrong_style',
      'not_interested',
      'tried_didnt_like',
      'not_right_now',
      'other',
    ])
  })

  it('isValidRejectionReason narrows known reasons', () => {
    expect(isValidRejectionReason('already_own')).toBe(true)
    expect(isValidRejectionReason('not_a_real_reason')).toBe(false)
    expect(isValidRejectionReason('')).toBe(false)
  })
})
