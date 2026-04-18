import { Hono } from 'hono'
import { createEmbyClient } from '@/core/clients/emby'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { getUserConnections } from '@/db/queries/users'
import type { AppDependencies } from '@/server'
import { parseIntClamp } from '@/server/helpers/parse-int-clamp'
import type { HonoEnv } from '@/server/types'

type ListenTrack = {
  artist: string
  track: string
  source: string
  imageUrl?: string
  mbid?: string
}

export function listeningRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.get('/api/listening/recent', async (c) => {
    const settings = await deps.getSettings()
    if (!settings) return c.json({ tracks: [] })

    const range = (c.req.query('range') as 'week' | 'month' | 'year') || 'month'
    const limit = parseIntClamp(c.req.query('limit'), {
      name: 'limit',
      min: 1,
      max: 50,
      default: 5,
    })
    const rangeLabel =
      range === 'week' ? 'this week' : range === 'year' ? 'this year' : 'this month'

    const userId = c.get('userId')
    const userConns = userId ? await getUserConnections(deps.db, userId) : null

    const lastfmUser = userConns?.lastfmUsername || ''
    const lastfmKey = userConns?.lastfmApiKey || ''
    const lbUser = userConns?.listenbrainzUsername || ''
    const lbToken = userConns?.listenbrainzToken || ''

    const tracks: ListenTrack[] = []

    // Try Last.fm first (usually has richer recent track data)
    if (lastfmUser && lastfmKey && lastfmKey !== '***') {
      try {
        const client = createLastFmClient(lastfmUser, lastfmKey)
        const recentTracks = await client.getRecentTracks()
        for (const t of recentTracks.slice(0, limit)) {
          tracks.push({
            artist: t.artist['#text'] ?? 'Unknown',
            track: t.name ?? 'Unknown',
            source: 'lastfm',
          })
        }
      } catch (err: unknown) {
        console.warn('[listening] Last.fm fetch failed:', err)
      }
    }

    // Try ListenBrainz if no Last.fm tracks
    if (tracks.length === 0 && lbUser && lbToken && lbToken !== '***') {
      try {
        const client = createListenBrainzClient(lbUser, lbToken)
        const topArtists = await client.getTopArtists(range)
        for (const a of topArtists.slice(0, limit)) {
          tracks.push({
            artist: a.name,
            track: `${a.playCount} plays ${rangeLabel}`,
            source: 'listenbrainz',
            mbid: a.mbid,
          })
        }
      } catch (err: unknown) {
        console.warn('[listening] ListenBrainz fetch failed:', err)
      }
    }

    // Fall back to Emby recent plays if earlier sources produced nothing
    if (
      tracks.length === 0 &&
      userConns?.embyUrl &&
      userConns?.embyApiKey &&
      userConns?.embyUserId
    ) {
      try {
        const emby = createEmbyClient(
          userConns.embyUrl,
          userConns.embyApiKey,
          userConns.embyUserId,
          { skipTlsVerify: settings.skipTlsVerify ?? false },
        )
        const recent = await emby.getRecentlyPlayed(limit)
        for (const item of recent) {
          tracks.push({
            artist: item.artistName,
            track: item.trackName,
            source: 'emby',
          })
        }
      } catch (err: unknown) {
        console.warn('[listening] Emby fetch failed:', err)
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
          settings.lidarrUrl,
          settings.lidarrApiKey,
          settings.skipTlsVerify ?? false,
        )
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
