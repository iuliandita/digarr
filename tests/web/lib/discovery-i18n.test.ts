import { describe, expect, it } from 'vitest'
import { translateDiscoveryReason } from '@/web/lib/discovery-i18n'

describe('translateDiscoveryReason', () => {
  it('falls back to the original reason when the mapped key is missing', () => {
    const reason = 'This mode is not implemented yet.'
    const t = (key: string) => key

    expect(translateDiscoveryReason(t, reason)).toBe(reason)
  })
})
