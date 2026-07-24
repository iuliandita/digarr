export type DiscoveryConnectionSnapshot = {
  hasListenBrainz: boolean
  hasSpotify: boolean
  spotifyScopes: string[]
  hasLastfm: boolean
  hasDiscogs: boolean
  hasDeezer: boolean
  hasTidal: boolean
  hasLibrarySync: boolean
  hasSubsonic: boolean
}

/** All-false connection snapshot: the default when no provider-state resolver is wired. */
export const EMPTY_DISCOVERY_SNAPSHOT: DiscoveryConnectionSnapshot = {
  hasListenBrainz: false,
  hasSpotify: false,
  spotifyScopes: [],
  hasLastfm: false,
  hasDiscogs: false,
  hasDeezer: false,
  hasTidal: false,
  hasLibrarySync: false,
  hasSubsonic: false,
}

export type DiscoveryAvailabilityResult = {
  enabled: boolean
  fallbackUsed: boolean
  providerPath: string[]
  reason?: string
}

export type DiscoveryModeExecutionContext = {
  providerContext: {
    providerPath: string[]
  }
  fallbackPolicy: 'strict' | 'allow-fallback'
}

const LISTENBRAINZ_MODE_IDS = new Set([
  'listenbrainz',
  'lb-artist-radio',
  'lb-user-radio',
  'similar-users-deep',
  'lb-tag-radio',
])

export function buildDiscoveryModeExecutionContext(
  availability: DiscoveryAvailabilityResult,
): DiscoveryModeExecutionContext {
  return {
    providerContext: {
      providerPath: availability.providerPath,
    },
    fallbackPolicy: availability.fallbackUsed ? 'allow-fallback' : 'strict',
  }
}

export function evaluateDiscoveryModeAvailability(
  modeId: string,
  snapshot: DiscoveryConnectionSnapshot,
): DiscoveryAvailabilityResult {
  if (LISTENBRAINZ_MODE_IDS.has(modeId)) {
    return snapshot.hasListenBrainz
      ? { enabled: true, fallbackUsed: false, providerPath: ['listenbrainz'] }
      : {
          enabled: false,
          fallbackUsed: false,
          providerPath: [],
          reason: 'Connect ListenBrainz to use this mode.',
        }
  }

  if (modeId === 'release-radar') {
    if (snapshot.hasListenBrainz) {
      return { enabled: true, fallbackUsed: false, providerPath: ['listenbrainz'] }
    }
    if (snapshot.hasSpotify || snapshot.hasLastfm) {
      return {
        enabled: true,
        fallbackUsed: true,
        providerPath: [snapshot.hasSpotify ? 'spotify' : 'lastfm'],
        reason: 'Using fallback providers for release discovery.',
      }
    }
    return {
      enabled: false,
      fallbackUsed: false,
      providerPath: [],
      reason: 'Connect a listening source first.',
    }
  }

  if (modeId === 'artist-relationships') {
    // MusicBrainz needs no user connection, so this mode is always available.
    return { enabled: true, fallbackUsed: false, providerPath: ['musicbrainz'] }
  }

  if (modeId === 'labels') {
    return snapshot.hasDiscogs
      ? { enabled: true, fallbackUsed: true, providerPath: ['discogs'] }
      : {
          enabled: false,
          fallbackUsed: false,
          providerPath: [],
          reason: 'Connect Discogs to use this mode.',
        }
  }

  if (modeId === 'charts') {
    return snapshot.hasLastfm
      ? { enabled: true, fallbackUsed: true, providerPath: ['lastfm'] }
      : {
          enabled: false,
          fallbackUsed: false,
          providerPath: [],
          reason: 'Connect Last.fm to use this mode.',
        }
  }

  if (modeId === 'deezer-flow') {
    return snapshot.hasDeezer
      ? { enabled: true, fallbackUsed: true, providerPath: ['deezer'] }
      : {
          enabled: false,
          fallbackUsed: false,
          providerPath: [],
          reason: 'Connect Deezer to use this mode.',
        }
  }

  if (modeId === 'tidal-favorite-artists') {
    return snapshot.hasTidal
      ? { enabled: true, fallbackUsed: true, providerPath: ['tidal'] }
      : {
          enabled: false,
          fallbackUsed: false,
          providerPath: [],
          reason: 'Connect TIDAL to use this mode.',
        }
  }

  if (modeId === 'subsonic-starred') {
    return snapshot.hasSubsonic
      ? { enabled: true, fallbackUsed: true, providerPath: ['subsonic'] }
      : {
          enabled: false,
          fallbackUsed: false,
          providerPath: [],
          reason: 'Connect Subsonic to use this mode.',
        }
  }

  if (modeId === 'spotify-saved-albums') {
    return snapshot.hasSpotify
      ? { enabled: true, fallbackUsed: true, providerPath: ['spotify'] }
      : {
          enabled: false,
          fallbackUsed: false,
          providerPath: [],
          reason: 'Connect Spotify to use this mode.',
        }
  }

  if (modeId === 'spotify-followed-artists') {
    if (!snapshot.hasSpotify) {
      return {
        enabled: false,
        fallbackUsed: false,
        providerPath: [],
        reason: 'Connect Spotify to use this mode.',
      }
    }
    if (!snapshot.spotifyScopes.includes('user-follow-read')) {
      return {
        enabled: false,
        fallbackUsed: false,
        providerPath: [],
        reason: 'Reconnect Spotify to grant follow access.',
      }
    }
    return { enabled: true, fallbackUsed: true, providerPath: ['spotify'] }
  }

  if (modeId === 'similar-artist-web') {
    const providerPath = [
      ...(snapshot.hasListenBrainz ? ['listenbrainz'] : []),
      ...(snapshot.hasLastfm ? ['lastfm'] : []),
    ]

    if (providerPath.length === 0) {
      return {
        enabled: false,
        fallbackUsed: false,
        providerPath: [],
        reason: 'Connect ListenBrainz or Last.fm to use this mode.',
      }
    }

    return {
      enabled: true,
      fallbackUsed: false,
      providerPath,
    }
  }

  if (modeId === 'gap-fill') {
    return snapshot.hasLibrarySync
      ? { enabled: true, fallbackUsed: false, providerPath: ['musicbrainz'] }
      : {
          enabled: false,
          fallbackUsed: false,
          providerPath: [],
          reason: 'Sync a library first to use this mode.',
        }
  }

  return {
    enabled: false,
    fallbackUsed: false,
    providerPath: [],
    reason: 'This mode is not shipped yet.',
  }
}
