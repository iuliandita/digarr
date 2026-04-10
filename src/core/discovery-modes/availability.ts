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

export function evaluateDiscoveryModeAvailability(
  modeId: string,
  snapshot: DiscoveryConnectionSnapshot,
): DiscoveryAvailabilityResult {
  if (modeId === 'listenbrainz') {
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

  const hasAnyEligibleSource =
    snapshot.hasListenBrainz || snapshot.hasSpotify || snapshot.hasLastfm || snapshot.hasDiscogs

  if (!hasAnyEligibleSource) {
    return {
      enabled: false,
      fallbackUsed: false,
      providerPath: [],
      reason: 'Connect a listening or collection source first.',
    }
  }

  return {
    enabled: true,
    fallbackUsed: !snapshot.hasDiscogs,
    providerPath: snapshot.hasDiscogs ? ['discogs'] : ['musicbrainz'],
    reason: snapshot.hasDiscogs
      ? undefined
      : 'Preferred provider unavailable; fallback will be used.',
  }
}
