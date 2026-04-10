import { describe, expect, it } from 'vitest'
import { evaluateDiscoveryModeAvailability } from '@/core/discovery-modes/availability'

describe('evaluateDiscoveryModeAvailability', () => {
  it('disables strict ListenBrainz mode when the connection is missing', () => {
    const result = evaluateDiscoveryModeAvailability('listenbrainz', {
      hasListenBrainz: false,
      hasSpotify: true,
      hasLastfm: true,
      hasDiscogs: false,
      hasLibrarySync: false,
    })

    expect(result.enabled).toBe(false)
    expect(result.reason).toMatch(/listenbrainz/i)
  })

  it('keeps fallback mode enabled and marks fallback when preferred providers are missing', () => {
    const result = evaluateDiscoveryModeAvailability('release-radar', {
      hasListenBrainz: false,
      hasSpotify: true,
      hasLastfm: false,
      hasDiscogs: false,
      hasLibrarySync: false,
    })

    expect(result.enabled).toBe(true)
    expect(result.fallbackUsed).toBe(true)
  })
})
