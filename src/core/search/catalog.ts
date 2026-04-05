export type SearchSourceDescriptor = {
  id: string
  label: string
  available: boolean
  stability?: 'stable' | 'experimental'
  reason?: string
}

type SearchSourceCatalogOptions = {
  hasSpotifyOAuth: boolean
  hasTidalSearch: boolean
}

export function buildSearchSourceCatalog(
  options: SearchSourceCatalogOptions,
): SearchSourceDescriptor[] {
  return [
    {
      id: 'spotify',
      label: 'Spotify',
      available: options.hasSpotifyOAuth,
      stability: 'stable' as const,
      reason: options.hasSpotifyOAuth ? undefined : 'Connect Spotify in Settings to enable search.',
    },
    { id: 'deezer', label: 'Deezer', available: true, stability: 'stable' as const },
    { id: 'musicbrainz', label: 'MusicBrainz', available: true, stability: 'stable' as const },
    {
      id: 'tidal',
      label: 'TIDAL',
      available: options.hasTidalSearch,
      stability: 'experimental' as const,
      reason: options.hasTidalSearch ? undefined : 'TIDAL search is not configured yet.',
    },
    { id: 'bandcamp', label: 'Bandcamp', available: true, stability: 'experimental' as const },
  ]
}
