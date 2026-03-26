export type SearchSourceDescriptor = {
  id: string
  label: string
  available: boolean
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
      reason: options.hasSpotifyOAuth ? undefined : 'Connect Spotify in Settings to enable search.',
    },
    { id: 'deezer', label: 'Deezer', available: true },
    { id: 'musicbrainz', label: 'MusicBrainz', available: true },
    {
      id: 'tidal',
      label: 'TIDAL',
      available: options.hasTidalSearch,
      reason: options.hasTidalSearch ? undefined : 'TIDAL search is not configured yet.',
    },
    { id: 'bandcamp', label: 'Bandcamp', available: true },
  ]
}
