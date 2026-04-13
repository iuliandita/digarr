export type DiscoveryConnectionSnapshot = {
  hasListenBrainz: boolean
  hasSpotify: boolean
  hasLastfm: boolean
  hasDiscogs: boolean
  hasLibrarySync: boolean
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

const NOT_IMPLEMENTED_MODE_IDS = new Set(['artist-relationships', 'labels'])

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
  if (NOT_IMPLEMENTED_MODE_IDS.has(modeId)) {
    return {
      enabled: false,
      fallbackUsed: false,
      providerPath: [],
      reason: 'This mode is not implemented yet.',
    }
  }

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

  return {
    enabled: false,
    fallbackUsed: false,
    providerPath: [],
    reason: 'This mode is not shipped yet.',
  }
}
