import type {
  AdapterConfigField,
  AdapterResult,
  SubscriptionAdapter,
} from '@/core/subscriptions/types'
import { extractArtistsFromPlaylist } from './spotify-shared'

// Viral 50 playlists only have a reliable global ID -- regional viral playlists
// are not publicly stable, so we only offer viral50 for the global region.
const CHART_PLAYLIST_IDS: Record<string, Record<string, string>> = {
  global: {
    top50: '37i9dQZEVXbMDoHDwVN2tF',
    viral50: '37i9dQZEVXbLiRSasKsNU9',
  },
  us: {
    top50: '37i9dQZEVXbLRQDuF5jeBp',
  },
  gb: {
    top50: '37i9dQZEVXbLnolsZ8PSNw',
  },
  de: {
    top50: '37i9dQZEVXbJiZcmkrIHGU',
  },
  fr: {
    top50: '37i9dQZEVXbIPWwFssbupI',
  },
  au: {
    top50: '37i9dQZEVXbJPcfkRz0wJ0',
  },
  br: {
    top50: '37i9dQZEVXbMXbN3EUUhlg',
  },
}

const CONFIG_FIELDS: AdapterConfigField[] = [
  {
    key: 'region',
    label: 'Region',
    type: 'select',
    required: true,
    options: [
      { value: 'global', label: 'Global' },
      { value: 'us', label: 'United States' },
      { value: 'gb', label: 'United Kingdom' },
      { value: 'de', label: 'Germany' },
      { value: 'fr', label: 'France' },
      { value: 'au', label: 'Australia' },
      { value: 'br', label: 'Brazil' },
    ],
  },
  {
    key: 'chartType',
    label: 'Chart Type',
    type: 'select',
    required: true,
    options: [
      { value: 'top50', label: 'Top 50' },
      { value: 'viral50', label: 'Viral 50 (Global only)' },
    ],
    helpText:
      'Viral 50 is only available for the Global region. Other regions fall back to Top 50.',
  },
]

export function createSpotifyChartsAdapter(deps: {
  getToken: () => Promise<string>
  baseUrl?: string
}): SubscriptionAdapter {
  const baseUrl = deps.baseUrl ?? 'https://api.spotify.com/v1'

  return {
    type: 'spotify-charts',
    label: 'Spotify Charts',
    configFields: CONFIG_FIELDS,

    async fetch(
      config: Record<string, unknown>,
      _options?: { limit?: number },
    ): Promise<AdapterResult> {
      const region = String(config.region ?? 'global').toLowerCase()
      const chartType = String(config.chartType ?? 'top50').toLowerCase()

      const globalCharts = CHART_PLAYLIST_IDS.global ?? {}
      const regionCharts = CHART_PLAYLIST_IDS[region] ?? globalCharts
      const playlistId = regionCharts[chartType] ?? regionCharts.top50 ?? globalCharts.top50 ?? ''

      const token = await deps.getToken()
      const url = `${baseUrl}/playlists/${playlistId}?fields=tracks.items(track(artists(name,id)))`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      let res: Response
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        throw new Error(`Spotify charts fetch failed: ${res.status} ${res.statusText}`)
      }

      const data = await res.json()
      const artists = extractArtistsFromPlaylist(
        data,
        `spotify-charts:${region}/${chartType}`,
        `https://open.spotify.com/playlist/${playlistId}`,
      )

      return { artists }
    },
  }
}
