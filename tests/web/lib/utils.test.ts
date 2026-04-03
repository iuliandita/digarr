import { describe, expect, it } from 'vitest'
import { hueFromName } from '@/web/lib/utils'

describe('hueFromName', () => {
  it('returns a number between 0 and 359', () => {
    const hue = hueFromName('Radiohead')
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
  })

  it('returns the same hue for the same name', () => {
    expect(hueFromName('Radiohead')).toBe(hueFromName('Radiohead'))
  })

  it('returns different hues for different names', () => {
    expect(hueFromName('Radiohead')).not.toBe(hueFromName('Portishead'))
  })

  it('handles empty string', () => {
    const hue = hueFromName('')
    expect(hue).toBe(0)
  })
})
