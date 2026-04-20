import { Hono } from 'hono'
import { createEmbyClient } from '@/core/clients/emby'
import { createJellyfinClient } from '@/core/clients/jellyfin'
import { createLastFmClient, type LastFmPeriod } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createListenBrainzClient, type ListenBrainzRange } from '@/core/clients/listenbrainz'
import { getUserConnections, type UserConnections } from '@/db/queries/users'
import type { AppDependencies } from '@/server'
import { parseIntClamp } from '@/server/helpers/parse-int-clamp'
import type { HonoEnv } from '@/server/types'

type TopArtistEntry = {
  artist: string
  track: string
  source: string
  imageUrl?: string
  mbid?: string
}

type RecentTrackEntry = {
  artist: string
  track: string
  source: string
  imageUrl?: string
  playedAt?: string
  nowPlaying?: boolean
  mbid?: string
}

const TOP_RANGES = ['this_week', 'this_month', 'this_year', 'all_time'] as const
type TopRange = (typeof TOP_RANGES)[number]

function parseTopRange(raw: string | undefined): TopRange {
  if (!raw) return 'this_month'
  if ((TOP_RANGES as readonly string[]).includes(raw)) return raw as TopRange
  // back-compat for the previous (misleading) range values
  if (raw === 'week') return 'this_week'
  if (raw === 'month') return 'this_month'
  if (raw === 'year') return 'this_year'
  return 'this_month'
}

function rangeLabel(range: TopRange): string {
  if (range === 'this_week') return 'this week'
  if (range === 'this_year') return 'this year'
  if (range === 'all_time') return 'all time'
  return 'this month'
}

function lastFmPeriodFor(range: TopRange): LastFmPeriod {
  if (range === 'this_week') return '7day'
  if (range === 'this_year') return '12month'
  if (range === 'all_time') return 'overall'
  return '1month'
}

function hasLastFm(conns: UserConnections | null): boolean {
  return Boolean(conns?.lastfmUsername && conns?.lastfmApiKey && conns.lastfmApiKey !== '***')
}

function hasListenBrainz(conns: UserConnections | null): boolean {
  return Boolean(
    conns?.listenbrainzUsername && conns?.listenbrainzToken && conns.listenbrainzToken !== '***',
  )
}

function hasJellyfin(conns: UserConnections | null): boolean {
  return Boolean(conns?.jellyfinUrl && conns?.jellyfinApiKey && conns?.jellyfinUserId)
}

function hasEmby(conns: UserConnections | null): boolean {
  return Boolean(conns?.embyUrl && conns?.embyApiKey && conns?.embyUserId)
}

async function enrichImages(
  entries: Array<{ artist: string; mbid?: string; imageUrl?: string }>,
  deps: {
    lidarrUrl: string | null
    lidarrApiKey: string | null
    skipTlsVerify: boolean
  },
): Promise<void> {
  if (
    !deps.lidarrUrl ||
    !deps.lidarrApiKey ||
    deps.lidarrApiKey === '***' ||
    !entries.some((e) => !e.imageUrl)
  ) {
    return
  }
  try {
    const lidarr = createLidarrClient(deps.lidarrUrl, deps.lidarrApiKey, deps.skipTlsVerify)
    const seen = new Set<string>()
    const imageCache = new Map<string, string>()

    for (const entry of entries) {
      if (entry.imageUrl || seen.has(entry.artist)) continue
      seen.add(entry.artist)
      try {
        const term = entry.mbid ? `lidarr:${entry.mbid}` : entry.artist
        const results = await lidarr.lookupArtist(term)
        const result = results[0] as Record<string, unknown> | undefined
        const images = (result?.images ?? []) as Array<{
          coverType: string
          remoteUrl?: string
        }>
        const img =
          images.find((i) => i.coverType === 'poster' && i.remoteUrl) ??
          images.find((i) => i.remoteUrl)
        if (img?.remoteUrl) imageCache.set(entry.artist, img.remoteUrl)
      } catch {
        // skip this artist, keep going
      }
    }

    for (const entry of entries) {
      if (!entry.imageUrl && imageCache.has(entry.artist)) {
        entry.imageUrl = imageCache.get(entry.artist)
      }
    }
  } catch {
    // silently fail
  }
}

export function listeningRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.get('/api/v1/listening/top-artists', async (c) => {
    const settings = await deps.getSettings()
    if (!settings) {
      return c.json({ tracks: [], total: 0, offset: 0, limit: 5, source: null })
    }

    const range = parseTopRange(c.req.query('range'))
    const limit = parseIntClamp(c.req.query('limit'), {
      name: 'limit',
      min: 1,
      max: 50,
      default: 5,
    })
    const offset = parseIntClamp(c.req.query('offset'), {
      name: 'offset',
      min: 0,
      max: 10_000,
      default: 0,
    })

    const userId = c.get('userId')
    const userConns = userId ? await getUserConnections(deps.db, userId) : null

    let tracks: TopArtistEntry[] = []
    let total = 0
    let source: 'listenbrainz' | 'lastfm' | null = null
    const label = rangeLabel(range)

    // Priority: ListenBrainz first (calendar-aligned, matches UI labels), Last.fm fallback.
    if (hasListenBrainz(userConns)) {
      try {
        const client = createListenBrainzClient(
          userConns?.listenbrainzUsername ?? '',
          userConns?.listenbrainzToken ?? '',
        )
        const paged = await client.getTopArtistsPaged(range as ListenBrainzRange, {
          offset,
          count: limit,
        })
        tracks = paged.artists.map((a) => ({
          artist: a.name,
          track: `${a.playCount} plays ${label}`,
          source: 'listenbrainz',
          mbid: a.mbid,
        }))
        total = paged.totalCount
        source = 'listenbrainz'
      } catch (err: unknown) {
        console.warn('[listening] ListenBrainz top-artists fetch failed:', err)
      }
    }

    if (tracks.length === 0 && hasLastFm(userConns)) {
      try {
        const client = createLastFmClient(
          userConns?.lastfmUsername ?? '',
          userConns?.lastfmApiKey ?? '',
        )
        // Last.fm paginates by page (1-indexed), so derive page from offset.
        const page = Math.floor(offset / limit) + 1
        const paged = await client.getTopArtistsPaged(lastFmPeriodFor(range), {
          page,
          limit,
        })
        tracks = paged.artists.map((a) => ({
          artist: a.name,
          track: `${a.playCount} plays ${label}`,
          source: 'lastfm',
          mbid: a.mbid,
        }))
        total = paged.totalCount
        source = 'lastfm'
      } catch (err: unknown) {
        console.warn('[listening] Last.fm top-artists fetch failed:', err)
      }
    }

    await enrichImages(tracks, {
      lidarrUrl: settings.lidarrUrl,
      lidarrApiKey: settings.lidarrApiKey,
      skipTlsVerify: settings.skipTlsVerify ?? false,
    })

    return c.json({ tracks, total, offset, limit, source })
  })

  router.get('/api/v1/listening/recent-tracks', async (c) => {
    const settings = await deps.getSettings()
    const limit = parseIntClamp(c.req.query('limit'), {
      name: 'limit',
      min: 1,
      max: 50,
      default: 5,
    })

    const userId = c.get('userId')
    const userConns = userId ? await getUserConnections(deps.db, userId) : null
    const hasSource =
      hasLastFm(userConns) ||
      hasListenBrainz(userConns) ||
      hasJellyfin(userConns) ||
      hasEmby(userConns)

    if (!settings || !hasSource) {
      return c.json({ tracks: [], hasSource, source: null })
    }

    let tracks: RecentTrackEntry[] = []
    let source: 'lastfm' | 'listenbrainz' | 'jellyfin' | 'emby' | null = null

    // Priority: Last.fm (richest metadata) -> LB /listens -> Jellyfin -> Emby.
    if (hasLastFm(userConns)) {
      try {
        const client = createLastFmClient(
          userConns?.lastfmUsername ?? '',
          userConns?.lastfmApiKey ?? '',
        )
        const recent = await client.getRecentTracks(limit)
        tracks = recent.slice(0, limit).map((t) => {
          const images = t.image ?? []
          const bigImage =
            images.find((i) => i.size === 'extralarge')?.['#text'] ||
            images.find((i) => i.size === 'large')?.['#text'] ||
            undefined
          const playedAt = t.date?.uts
            ? new Date(Number(t.date.uts) * 1000).toISOString()
            : undefined
          return {
            artist: t.artist['#text'] ?? 'Unknown',
            track: t.name ?? 'Unknown',
            source: 'lastfm',
            imageUrl: bigImage || undefined,
            playedAt,
            nowPlaying: t['@attr']?.nowplaying === 'true',
            mbid: t.artist.mbid || undefined,
          }
        })
        if (tracks.length > 0) source = 'lastfm'
      } catch (err: unknown) {
        console.warn('[listening] Last.fm recent-tracks fetch failed:', err)
      }
    }

    if (tracks.length === 0 && hasListenBrainz(userConns)) {
      try {
        const client = createListenBrainzClient(
          userConns?.listenbrainzUsername ?? '',
          userConns?.listenbrainzToken ?? '',
        )
        const listens = await client.getListens(limit)
        tracks = listens.slice(0, limit).map((l) => ({
          artist: l.artist,
          track: l.track,
          source: 'listenbrainz',
          playedAt: new Date(l.listenedAt * 1000).toISOString(),
          mbid: l.artistMbid,
        }))
        if (tracks.length > 0) source = 'listenbrainz'
      } catch (err: unknown) {
        console.warn('[listening] ListenBrainz recent-tracks fetch failed:', err)
      }
    }

    if (tracks.length === 0 && hasJellyfin(userConns)) {
      try {
        const jellyfin = createJellyfinClient(
          userConns?.jellyfinUrl ?? '',
          userConns?.jellyfinApiKey ?? '',
          userConns?.jellyfinUserId ?? '',
          { skipTlsVerify: settings.skipTlsVerify ?? false },
        )
        const recent = await jellyfin.getRecentlyPlayed(limit)
        tracks = recent.slice(0, limit).map((r) => ({
          artist: r.artistName,
          track: r.trackName,
          source: 'jellyfin',
          playedAt: r.datePlayed,
        }))
        if (tracks.length > 0) source = 'jellyfin'
      } catch (err: unknown) {
        console.warn('[listening] Jellyfin recent-tracks fetch failed:', err)
      }
    }

    if (tracks.length === 0 && hasEmby(userConns)) {
      try {
        const emby = createEmbyClient(
          userConns?.embyUrl ?? '',
          userConns?.embyApiKey ?? '',
          userConns?.embyUserId ?? '',
          { skipTlsVerify: settings.skipTlsVerify ?? false },
        )
        const recent = await emby.getRecentlyPlayed(limit)
        tracks = recent.slice(0, limit).map((r) => ({
          artist: r.artistName,
          track: r.trackName,
          source: 'emby',
        }))
        if (tracks.length > 0) source = 'emby'
      } catch (err: unknown) {
        console.warn('[listening] Emby recent-tracks fetch failed:', err)
      }
    }

    await enrichImages(tracks, {
      lidarrUrl: settings.lidarrUrl,
      lidarrApiKey: settings.lidarrApiKey,
      skipTlsVerify: settings.skipTlsVerify ?? false,
    })

    return c.json({ tracks, hasSource, source })
  })

  return router
}
