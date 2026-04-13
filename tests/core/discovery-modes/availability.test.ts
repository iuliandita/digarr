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

  it('treats ListenBrainz radio-derived modes as strict ListenBrainz-backed modes', () => {
    const snapshot = {
      hasListenBrainz: true,
      hasSpotify: false,
      hasLastfm: false,
      hasDiscogs: false,
      hasLibrarySync: false,
    }

    for (const modeId of [
      'lb-artist-radio',
      'lb-user-radio',
      'similar-users-deep',
      'lb-tag-radio',
    ]) {
      expect(evaluateDiscoveryModeAvailability(modeId, snapshot)).toMatchObject({
        enabled: true,
        fallbackUsed: false,
        providerPath: ['listenbrainz'],
      })
    }
  })

  it('reports ListenBrainz radio-derived modes as unavailable when ListenBrainz is missing', () => {
    const result = evaluateDiscoveryModeAvailability('lb-artist-radio', {
      hasListenBrainz: false,
      hasSpotify: true,
      hasLastfm: true,
      hasDiscogs: false,
      hasLibrarySync: false,
    })

    expect(result).toMatchObject({
      enabled: false,
      fallbackUsed: false,
      providerPath: [],
      reason: 'Connect ListenBrainz to use this mode.',
    })
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

  it('disables unfinished modes instead of advertising fake availability', () => {
    const snapshot = {
      hasListenBrainz: true,
      hasSpotify: true,
      hasLastfm: true,
      hasDiscogs: true,
      hasLibrarySync: true,
    }

    expect(evaluateDiscoveryModeAvailability('artist-relationships', snapshot)).toMatchObject({
      enabled: false,
      fallbackUsed: false,
      providerPath: [],
      reason: 'This mode is not implemented yet.',
    })
    expect(evaluateDiscoveryModeAvailability('labels', snapshot)).toMatchObject({
      enabled: false,
      fallbackUsed: false,
      providerPath: [],
      reason: 'This mode is not implemented yet.',
    })
  })

  it('treats ListenBrainz radio-derived modes as strict ListenBrainz modes', () => {
    const snapshot = {
      hasListenBrainz: true,
      hasSpotify: false,
      hasLastfm: false,
      hasDiscogs: false,
      hasLibrarySync: false,
    }

    for (const modeId of [
      'lb-artist-radio',
      'lb-user-radio',
      'similar-users-deep',
      'lb-tag-radio',
    ]) {
      expect(evaluateDiscoveryModeAvailability(modeId, snapshot)).toMatchObject({
        enabled: true,
        fallbackUsed: false,
        providerPath: ['listenbrainz'],
      })
    }
  })

  it('uses real similar-artist providers instead of discogs or musicbrainz placeholders', () => {
    const result = evaluateDiscoveryModeAvailability('similar-artist-web', {
      hasListenBrainz: false,
      hasSpotify: false,
      hasLastfm: true,
      hasDiscogs: true,
      hasLibrarySync: false,
    })

    expect(result).toMatchObject({
      enabled: true,
      fallbackUsed: false,
      providerPath: ['lastfm'],
    })
  })

  it('reports unfinished labels mode as unavailable', () => {
    const result = evaluateDiscoveryModeAvailability('labels', {
      hasListenBrainz: false,
      hasSpotify: false,
      hasLastfm: false,
      hasDiscogs: false,
      hasLibrarySync: false,
    })

    expect(result).toMatchObject({
      enabled: false,
      fallbackUsed: false,
      providerPath: [],
    })
    expect(result.reason).toBe('This mode is not implemented yet.')
  })
})
