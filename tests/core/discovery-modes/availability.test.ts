import { describe, expect, it } from 'vitest'
import {
  EMPTY_DISCOVERY_SNAPSHOT,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import { createDefaultDiscoveryModeRegistry } from '@/core/discovery-modes/registry'

describe('evaluateDiscoveryModeAvailability', () => {
  it('disables strict ListenBrainz mode when the connection is missing', () => {
    const result = evaluateDiscoveryModeAvailability('listenbrainz', {
      hasListenBrainz: false,
      hasSpotify: true,
      spotifyScopes: [],
      hasLastfm: true,
      hasDiscogs: false,
      hasDeezer: false,
      hasLibrarySync: false,
      hasSubsonic: false,
    })

    expect(result.enabled).toBe(false)
    expect(result.reason).toMatch(/listenbrainz/i)
  })

  it('treats ListenBrainz radio-derived modes as strict ListenBrainz-backed modes', () => {
    const snapshot = {
      hasListenBrainz: true,
      hasSpotify: false,
      spotifyScopes: [],
      hasLastfm: false,
      hasDiscogs: false,
      hasDeezer: false,
      hasLibrarySync: false,
      hasSubsonic: false,
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
      spotifyScopes: [],
      hasLastfm: true,
      hasDiscogs: false,
      hasDeezer: false,
      hasLibrarySync: false,
      hasSubsonic: false,
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
      spotifyScopes: [],
      hasLastfm: false,
      hasDiscogs: false,
      hasDeezer: false,
      hasLibrarySync: false,
      hasSubsonic: false,
    })

    expect(result.enabled).toBe(true)
    expect(result.fallbackUsed).toBe(true)
  })

  it('enables artist-relationships (MusicBrainz) always and labels when Discogs is connected', () => {
    const snapshot = {
      hasListenBrainz: true,
      hasSpotify: true,
      spotifyScopes: [],
      hasLastfm: true,
      hasDiscogs: true,
      hasDeezer: false,
      hasLibrarySync: true,
      hasSubsonic: false,
    }

    expect(evaluateDiscoveryModeAvailability('artist-relationships', snapshot)).toMatchObject({
      enabled: true,
      fallbackUsed: false,
      providerPath: ['musicbrainz'],
    })
    expect(evaluateDiscoveryModeAvailability('labels', snapshot)).toMatchObject({
      enabled: true,
      fallbackUsed: true,
      providerPath: ['discogs'],
    })
  })

  it('treats ListenBrainz radio-derived modes as strict ListenBrainz modes', () => {
    const snapshot = {
      hasListenBrainz: true,
      hasSpotify: false,
      spotifyScopes: [],
      hasLastfm: false,
      hasDiscogs: false,
      hasDeezer: false,
      hasLibrarySync: false,
      hasSubsonic: false,
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
      spotifyScopes: [],
      hasLastfm: true,
      hasDiscogs: true,
      hasDeezer: false,
      hasLibrarySync: false,
      hasSubsonic: false,
    })

    expect(result).toMatchObject({
      enabled: true,
      fallbackUsed: false,
      providerPath: ['lastfm'],
    })
  })

  it('reports labels mode unavailable when Discogs is not connected', () => {
    const result = evaluateDiscoveryModeAvailability('labels', {
      hasListenBrainz: false,
      hasSpotify: false,
      spotifyScopes: [],
      hasLastfm: false,
      hasDiscogs: false,
      hasDeezer: false,
      hasLibrarySync: false,
      hasSubsonic: false,
    })

    expect(result).toMatchObject({
      enabled: false,
      fallbackUsed: false,
      providerPath: [],
    })
    expect(result.reason).toBe('Connect Discogs to use this mode.')
  })

  it('enables gap-fill (MusicBrainz) when a library has been synced', () => {
    const result = evaluateDiscoveryModeAvailability('gap-fill', {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      hasLibrarySync: true,
    })

    expect(result).toMatchObject({
      enabled: true,
      fallbackUsed: false,
      providerPath: ['musicbrainz'],
    })
  })

  it('reports gap-fill mode unavailable when no library has been synced', () => {
    const result = evaluateDiscoveryModeAvailability('gap-fill', EMPTY_DISCOVERY_SNAPSHOT)

    expect(result).toMatchObject({
      enabled: false,
      fallbackUsed: false,
      providerPath: [],
      reason: 'Sync a library first to use this mode.',
    })
  })

  it('never falls through to the not-shipped-yet reason for a registered mode', () => {
    const allTrueSnapshot = Object.fromEntries(
      Object.entries(EMPTY_DISCOVERY_SNAPSHOT).map(([key, value]) => [
        key,
        typeof value === 'boolean' ? true : value,
      ]),
    ) as typeof EMPTY_DISCOVERY_SNAPSHOT

    const registry = createDefaultDiscoveryModeRegistry()
    for (const mode of registry.list()) {
      const result = evaluateDiscoveryModeAvailability(mode.id, allTrueSnapshot)
      expect(result.reason, `mode '${mode.id}' fell through to the default reason`).not.toBe(
        'This mode is not shipped yet.',
      )
    }
  })
})

describe('spotify-followed-artists availability', () => {
  it('is enabled when hasSpotify and user-follow-read is granted', () => {
    const result = evaluateDiscoveryModeAvailability('spotify-followed-artists', {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      hasSpotify: true,
      spotifyScopes: ['user-top-read', 'user-follow-read'],
    })
    expect(result).toMatchObject({ enabled: true, fallbackUsed: true, providerPath: ['spotify'] })
  })

  it('is disabled with a reconnect reason when connected but missing the follow scope', () => {
    const result = evaluateDiscoveryModeAvailability('spotify-followed-artists', {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      hasSpotify: true,
      spotifyScopes: ['user-top-read'],
    })
    expect(result.enabled).toBe(false)
    expect(result.reason).toMatch(/reconnect/i)
  })

  it('is disabled with a connect reason when Spotify is not connected', () => {
    const result = evaluateDiscoveryModeAvailability('spotify-followed-artists', {
      ...EMPTY_DISCOVERY_SNAPSHOT,
      hasSpotify: false,
    })
    expect(result.enabled).toBe(false)
    expect(result.reason).toMatch(/connect spotify/i)
  })
})
