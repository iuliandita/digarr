import { describe, expect, it } from 'vitest'
import {
  bulkRecommendationSchema,
  monitorOptionSchema,
  rejectStatusSchema,
} from '@/server/schemas/recommendations'

describe('rejectStatusSchema', () => {
  it('accepts a minimal { status: rejected }', () => {
    expect(rejectStatusSchema.safeParse({ status: 'rejected' }).success).toBe(true)
  })

  it('accepts a permanent rejection with reason', () => {
    const r = rejectStatusSchema.safeParse({
      status: 'rejected',
      reason: 'tried_didnt_like',
      permanent: true,
    })
    expect(r.success).toBe(true)
  })

  it('rejects permanent + not_right_now', () => {
    const r = rejectStatusSchema.safeParse({
      status: 'rejected',
      reason: 'not_right_now',
      permanent: true,
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['permanent'])
  })

  it('rejects reasonText paired with non-other reason', () => {
    const r = rejectStatusSchema.safeParse({
      status: 'rejected',
      reason: 'already_own',
      reasonText: 'sneak',
    })
    expect(r.success).toBe(false)
  })

  it('caps reasonText at 200 chars', () => {
    const r = rejectStatusSchema.safeParse({
      status: 'rejected',
      reason: 'other',
      reasonText: 'x'.repeat(201),
    })
    expect(r.success).toBe(false)
  })

  it('strips control chars from reasonText', () => {
    const r = rejectStatusSchema.safeParse({
      status: 'rejected',
      reason: 'other',
      reasonText: 'hello\x00world',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.reasonText).toBe('helloworld')
  })

  it('defaults permanent to false', () => {
    const r = rejectStatusSchema.safeParse({ status: 'rejected' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.permanent).toBe(false)
  })

  it('rejects unknown reason values', () => {
    const r = rejectStatusSchema.safeParse({
      status: 'rejected',
      reason: 'made_up_reason',
    })
    expect(r.success).toBe(false)
  })
})

describe('bulkRecommendationSchema', () => {
  it.each([
    { action: 'reject', reason: 'not_right_now', permanent: true, success: false },
    { action: 'reject', reason: 'not_right_now', permanent: false, success: true },
    { action: 'reject', reason: 'not_right_now', success: true },
    { action: 'reject', reason: 'already_own', permanent: true, success: true },
    { action: 'reject', reason: 'wrong_style', permanent: true, success: true },
    { action: 'reject', reason: 'not_interested', permanent: true, success: true },
    { action: 'reject', reason: 'tried_didnt_like', permanent: true, success: true },
    { action: 'reject', reason: 'other', permanent: true, success: true },
    { action: 'reject', reason: null, permanent: true, success: true },
    { action: 'reject', permanent: true, success: true },
    { action: 'reject', reason: null, success: true },
    { action: 'reject', success: true },
    { action: 'approve', reason: 'not_right_now', permanent: true, success: true },
  ])('validates rejection compatibility for %j', ({ success, ...fields }) => {
    const result = bulkRecommendationSchema.safeParse({
      ids: [1],
      ...fields,
      reasonText: 'not supported in bulk',
    })

    expect(result.success).toBe(success)
    if (result.success) {
      expect(result.data.permanent).toBe(fields.permanent ?? false)
      expect(result.data).not.toHaveProperty('reasonText')
    } else {
      expect(result.error.issues[0]?.path).toEqual(['permanent'])
    }
  })
})

describe('monitorOptionSchema', () => {
  it('accepts popular album approval mode', () => {
    expect(monitorOptionSchema.safeParse('popular').success).toBe(true)
  })
})
