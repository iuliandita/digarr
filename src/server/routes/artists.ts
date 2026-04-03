import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createDeezerClient } from '@/core/clients/deezer'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import type { TopTrack, TopTracksCache } from '@/db/schema'
import { artists } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { rateLimiter } from '@/server/middleware/rate-limit'

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

    // Resolve Deezer artist ID (cached or fresh)
    let deezerId: number | null = null
    const deezerUrl = (artist.streamingUrls as Record<string, string> | null)?.deezer
    const deezerIdMatch = deezerUrl?.match(/deezer\.com\/(?:\w+\/)?artist\/(\d+)/)
    if (deezerIdMatch?.[1]) {
      deezerId = Number(deezerIdMatch[1])
    } else {
      const [topResult] = await deezer.searchArtists(artist.name, 1)
      if (topResult) deezerId = topResult.id
    }

    // Always fetch fresh from Deezer (preview URLs are signed and expire)
    let tracks: TopTrack[] = []
    if (deezerId) {
      tracks = await deezer.getArtistTopTracks(deezerId, 5)
    }

    // Fallback: use cached track names if Deezer fails but we have prior data
    if (tracks.length === 0) {
      const cached = artist.topTracks as TopTracksCache | null
      if (cached?.tracks?.length) {
        // Strip expired preview URLs from cached data
        tracks = cached.tracks.map((t) => ({ name: t.name, durationMs: t.durationMs }))
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

    // Cache track names/durations (preview URLs are not cached -- fetched fresh each time)
    const toCache = tracks.map((t) => ({ name: t.name, durationMs: t.durationMs }))
    const topTracksCache: TopTracksCache = { tracks: toCache, cachedAt: new Date().toISOString() }
    await deps.db.update(artists).set({ topTracks: topTracksCache }).where(eq(artists.id, id))

    return c.json({ tracks })
  })

  // Proxy Deezer preview audio to avoid CORS issues in browsers
  router.get(
    '/api/preview/audio',
    rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'preview' }),
    async (c) => {
      const url = c.req.query('url')
      if (!url || !url.match(/^https:\/\/cdn[st]-?preview[a-z0-9-]*\.dzcdn\.net\//)) {
        return c.json({ error: 'Invalid preview URL' }, 400)
      }
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10_000)
        const res = await fetch(url, { signal: controller.signal })
        clearTimeout(timer)
        const contentType = res.headers.get('Content-Type') ?? ''
        if (!res.ok || !contentType.startsWith('audio/')) {
          return c.json({ error: 'Preview not available', status: res.status, contentType }, 502)
        }
        const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
        const cl = res.headers.get('Content-Length')
        if (cl && Number(cl) > MAX_PREVIEW_BYTES) {
          return c.json({ error: 'Preview too large' }, 502)
        }
        const audioBuffer = await res.arrayBuffer()
        if (audioBuffer.byteLength > MAX_PREVIEW_BYTES) {
          return c.json({ error: 'Preview too large' }, 502)
        }
        return new Response(audioBuffer, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(audioBuffer.byteLength),
            'Cache-Control': 'public, max-age=300',
          },
        })
      } catch {
        return c.json({ error: 'Preview fetch failed' }, 502)
      }
    },
  )

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
