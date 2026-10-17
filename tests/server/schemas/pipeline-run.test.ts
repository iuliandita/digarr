// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { discoveryModeRunSchema } from '@/server/schemas/pipeline'

describe('discoveryModeRunSchema', () => {
  it('keeps the settings fields the parser reads', () => {
    const parsed = discoveryModeRunSchema.parse({
      modeId: 'x',
      rawUserSettings: { a: 1 },
      normalizedSettings: { a: 1 },
    })
    expect(parsed.rawUserSettings).toEqual({ a: 1 })
    expect(parsed.normalizedSettings).toEqual({ a: 1 })
  })

  it.each([{ rawUserSettings: 'x' }, { normalizedSettings: [] }])('rejects %o', (bad) => {
    expect(discoveryModeRunSchema.safeParse({ modeId: 'x', ...bad }).success).toBe(false)
  })
})
