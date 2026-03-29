import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createDeezerClient } from '@/core/clients/deezer'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import type { TopTrack, TopTracksCache } from '@/db/schema'
import { artists } from '@/db/schema'
import type { AppDependencies } from '@/server'

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function artistRoutes(deps: AppDependencies) {
  const router = new Hono()
  const deezer = createDeezerClient()
  const mb = createMusicBrainzClient()

  router.get('/api/artists/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid artist ID' }, 400)
    const artist = await deps.getArtistById(id)
    if (!artist) {
      return c.json({ error: 'Artist not found' }, 404)
    }
    return c.json(artist)
  })

  router.get('/api/artists/:id/top-tracks', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid artist ID' }, 400)
    const artist = await deps.getArtistById(id)
    if (!artist) {
      return c.json({ error: 'Artist not found' }, 404)
    }

    // Return cached tracks if fresh (< 30 days)
    const cached = artist.topTracks as TopTracksCache | null
    if (cached?.tracks && cached.cachedAt) {
      const age = Date.now() - new Date(cached.cachedAt).getTime()
      if (age < CACHE_TTL_MS) {
        return c.json({ tracks: cached.tracks })
      }
    }

    // Fetch from Deezer
    let tracks: TopTrack[] = []

    // Try to extract Deezer artist ID from streaming URLs first (more precise than name search)
    const deezerUrl = (artist.streamingUrls as Record<string, string> | null)?.deezer
    const deezerIdMatch = deezerUrl?.match(/deezer\.com\/(?:\w+\/)?artist\/(\d+)/)
    if (deezerIdMatch?.[1]) {
      tracks = await deezer.getArtistTopTracks(Number(deezerIdMatch[1]), 5)
    }

    // Fall back to name search
    if (tracks.length === 0) {
      const [topResult] = await deezer.searchArtists(artist.name, 1)
      if (topResult) {
        tracks = await deezer.getArtistTopTracks(topResult.id, 5)
      }
    }

    // Fallback: MusicBrainz recordings (titles only, no preview)
    if (tracks.length === 0) {
      try {
        const recordings = await mb.getRecordings(artist.mbid, 5)
        tracks = recordings.map((r) => ({ name: r.title }))
      } catch {
        // MB fallback failed, return empty
      }
    }

    // Cache result in DB (self-contained timestamp, independent of artist cachedAt)
    const topTracksCache: TopTracksCache = { tracks, cachedAt: new Date().toISOString() }
    await deps.db.update(artists).set({ topTracks: topTracksCache }).where(eq(artists.id, id))

    return c.json({ tracks })
  })

  // Proxy Deezer preview audio to avoid CORS issues in browsers
  router.get('/api/preview/audio', async (c) => {
    const url = c.req.query('url')
    if (!url || !url.startsWith('https://cdns-preview-')) {
      return c.json({ error: 'Invalid preview URL' }, 400)
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok || !res.body) {
        return c.json({ error: 'Preview not available' }, 502)
      }
      return new Response(res.body, {
        headers: {
          'Content-Type': res.headers.get('Content-Type') ?? 'audio/mpeg',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    } catch {
      return c.json({ error: 'Preview fetch failed' }, 502)
    }
  })

  router.get('/api/albums/:mbid', async (c) => {
    const mbid = c.req.param('mbid')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbid)) {
      return c.json({ error: 'Invalid MBID format' }, 400)
    }
    const releaseGroups = await mb.getReleaseGroups(mbid)
    return c.json(releaseGroups)
  })

  return router
}
