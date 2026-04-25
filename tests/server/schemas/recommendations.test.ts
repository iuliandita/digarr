import { describe, expect, it } from 'vitest'
import { rejectStatusSchema } from '@/server/schemas/recommendations'

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
