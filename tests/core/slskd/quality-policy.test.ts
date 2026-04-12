// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveQualityPolicy } from '@/core/slskd/quality-policy'

describe('resolveQualityPolicy()', () => {
  it('defaults to flac preferred', () => {
    expect(resolveQualityPolicy({}).preference).toBe('flac_preferred')
  })

  it('uses the explicit override when provided', () => {
    expect(
      resolveQualityPolicy({
        preference: 'mp3_preferred',
        lidarrPreference: 'flac_preferred',
      }),
    ).toEqual({
      preference: 'mp3_preferred',
      source: 'target',
    })
  })
})
