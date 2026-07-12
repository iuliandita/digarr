import { describe, expect, it } from 'vitest'
import { idParamSchema } from '@/server/schemas/validator'

describe('idParamSchema', () => {
  it('coerces a positive integer path parameter', () => {
    expect(idParamSchema.parse({ id: '42' })).toEqual({ id: 42 })
  })

  it.each([0, -1, 1.5, 'not-a-number'])('rejects invalid IDs: %s', (id) => {
    expect(idParamSchema.safeParse({ id }).success).toBe(false)
  })
})
