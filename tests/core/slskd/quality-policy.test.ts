// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveQualityPolicy } from '@/core/slskd/quality-policy'

describe('resolveQualityPolicy()', () => {
  it('defaults to flac preferred', () => {
    expect(resolveQualityPolicy({})).toEqual({
      preference: 'flac_preferred',
      source: 'default',
    })
  })

  it('uses the explicit override when provided', () => {
    expect(
      resolveQualityPolicy({
        targetConfig: { qualityPreference: 'any_audio' },
        lidarrDefaults: { qualityProfileId: 1 },
      }),
    ).toEqual({
      preference: 'any_audio',
      source: 'target',
    })
  })

  it('uses Lidarr quality defaults when target config is absent', () => {
    expect(resolveQualityPolicy({ lidarrDefaults: { qualityProfileId: 2 } })).toEqual({
      preference: 'flac_preferred',
      source: 'lidarr',
    })
  })
})
