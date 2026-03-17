import { Hono } from 'hono'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import type { AppDependencies } from '@/server'

type ListenTrack = {
  artist: string
  track: string
  source: string
  imageUrl?: string
  mbid?: string
}

export function listeningRoutes(deps: AppDependencies) {
  const router = new Hono()

  router.get('/api/listening/recent', async (c) => {
    const settings = await deps.getSettings()
    if (!settings) return c.json({ tracks: [] })

    const tracks: ListenTrack[] = []

    // Try Last.fm first (usually has richer recent track data)
    if (settings.lastfmUsername && settings.lastfmApiKey && settings.lastfmApiKey !== '***') {
      try {
        const client = createLastFmClient(
          settings.lastfmUsername as string,
          settings.lastfmApiKey as string,
        )
        const recentTracks = await client.getRecentTracks()
        for (const t of recentTracks.slice(0, 10)) {
          tracks.push({
            artist: t.artist['#text'] ?? 'Unknown',
            track: t.name ?? 'Unknown',
            source: 'lastfm',
          })
        }
      } catch {
        // silently fail
      }
    }

    // Try ListenBrainz if no Last.fm tracks
    if (
      tracks.length === 0 &&
      settings.listenbrainzUsername &&
      settings.listenbrainzToken &&
      settings.listenbrainzToken !== '***'
    ) {
      try {
        const client = createListenBrainzClient(
          settings.listenbrainzUsername as string,
          settings.listenbrainzToken as string,
        )
        const topArtists = await client.getTopArtists('week')
        for (const a of topArtists.slice(0, 10)) {
          tracks.push({
            artist: a.name,
            track: `${a.playCount} plays this week`,
            source: 'listenbrainz',
            mbid: a.mbid,
          })
        }
      } catch {
        // silently fail
      }
    }

    // Fetch images for tracks missing them via Lidarr lookup
    if (
      settings.lidarrUrl &&
      settings.lidarrApiKey &&
      settings.lidarrApiKey !== '***' &&
      tracks.some((t) => !t.imageUrl)
    ) {
      try {
        const lidarr = createLidarrClient(
          settings.lidarrUrl as string,
          settings.lidarrApiKey as string,
          (settings.skipTlsVerify as boolean) ?? false,
        )
        // Deduplicate artist names for lookups
        const seen = new Set<string>()
        const imageCache = new Map<string, string>()

        for (const t of tracks) {
          if (t.imageUrl || seen.has(t.artist)) continue
          seen.add(t.artist)

          try {
            const term = t.mbid ? `lidarr:${t.mbid}` : t.artist
            const results = await lidarr.lookupArtist(term)
            const result = results[0] as Record<string, unknown> | undefined
            const images = (result?.images ?? []) as Array<{
              coverType: string
              remoteUrl?: string
            }>
            const img =
              images.find((i) => i.coverType === 'poster' && i.remoteUrl) ??
              images.find((i) => i.remoteUrl)
            if (img?.remoteUrl) {
              imageCache.set(t.artist, img.remoteUrl)
            }
          } catch {
            // skip
          }
        }

        // Apply cached images
        for (const t of tracks) {
          if (!t.imageUrl && imageCache.has(t.artist)) {
            t.imageUrl = imageCache.get(t.artist)
          }
        }
      } catch {
        // silently fail
      }
    }

    return c.json({ tracks })
  })

  return router
}
