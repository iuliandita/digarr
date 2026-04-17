// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { changePasswordSchema, passwordSchema } from '@/server/schemas/auth'

describe('password policy', () => {
  it('rejects 11-char password', () => {
    const r = passwordSchema.safeParse('shortpass1!')
    expect(r.success).toBe(false)
  })

  it('accepts 12-char password', () => {
    const r = passwordSchema.safeParse('longenough12')
    expect(r.success).toBe(true)
  })

  it('rejects empty password', () => {
    const r = passwordSchema.safeParse('')
    expect(r.success).toBe(false)
  })
})

describe('changePasswordSchema', () => {
  it('rejects 11-char new password', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'anything',
      newPassword: 'shortpass1!',
    })
    expect(r.success).toBe(false)
  })

  it('accepts 12-char new password', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'anything',
      newPassword: 'longenough12',
    })
    expect(r.success).toBe(true)
  })

  it('requires non-empty current password', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: '',
      newPassword: 'longenough12',
    })
    expect(r.success).toBe(false)
  })
})
