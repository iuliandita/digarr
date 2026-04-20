import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createDeezerClient } from '@/core/clients/deezer'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { createWikidataClient } from '@/core/clients/wikidata'
import type { TopTrack, TopTracksCache } from '@/db/schema'
import { artists } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { rateLimiter } from '@/server/middleware/rate-limit'

const ENRICHMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const ENRICHMENT_NEG_TTL_MS = 24 * 60 * 60 * 1000

export function artistRoutes(deps: AppDependencies) {
  const router = new Hono()
  const deezer = createDeezerClient()
  const mb = createMusicBrainzClient()
  const wikidata = createWikidataClient()

  router.get('/api/v1/artists/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid artist ID' }, 400)
    const artist = await deps.getArtistById(id)
    if (!artist) {
      return c.json({ error: 'Artist not found' }, 404)
    }
    return c.json(artist)
  })

  router.get('/api/v1/artists/:id/top-tracks', async (c) => {
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
      // Search multiple results and require an unambiguous exact name match.
      // If Deezer has 2+ artists with the same name, skip and fall through
      // to MusicBrainz recordings (MBID-based, always correct).
      const results = await deezer.searchArtists(artist.name, 10)
      const exactMatches = results.filter((r) => r.name.toLowerCase() === artist.name.toLowerCase())
      if (exactMatches.length === 1 && exactMatches[0]) deezerId = exactMatches[0].id
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

    // Cache track names/durations (preview URLs are not cached - fetched fresh each time)
    const toCache = tracks.map((t) => ({ name: t.name, durationMs: t.durationMs }))
    const topTracksCache: TopTracksCache = { tracks: toCache, cachedAt: new Date().toISOString() }
    await deps.db.update(artists).set({ topTracks: topTracksCache }).where(eq(artists.id, id))

    return c.json({ tracks })
  })

  // Proxy Deezer preview audio to avoid CORS issues in browsers
  router.get(
    '/api/v1/preview/audio',
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

  router.get('/api/v1/artists/:id/enrichment', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid artist ID' }, 400)
    const localeRaw = c.req.query('locale') ?? 'en'
    const locale = /^[a-zA-Z-]{2,10}$/.test(localeRaw) ? localeRaw : 'en'

    const row = await deps.db.query.artists.findFirst({ where: eq(artists.id, id) })
    if (!row) return c.json({ error: 'Artist not found' }, 404)

    const emptyPayload = { description: null, externalLinks: {}, wikidataId: null }

    const settings = await deps.getSettings()
    if (!settings?.wikidataEnabled) return c.json(emptyPayload)

    const now = Date.now()
    const failedAt = row.wikidataFailedAt?.getTime() ?? 0
    if (failedAt && now - failedAt < ENRICHMENT_NEG_TTL_MS) {
      return c.json(emptyPayload)
    }

    const fetchedAt = row.wikidataFetchedAt?.getTime() ?? 0
    const cached = row.description as Record<string, string> | null
    if (fetchedAt && now - fetchedAt < ENRICHMENT_TTL_MS && cached?.[locale]) {
      return c.json({
        description: cached[locale],
        externalLinks: row.externalLinks ?? {},
        wikidataId: row.wikidataId,
      })
    }

    const result = await wikidata.getArtistEnrichment(row.mbid, locale)
    if (!result.wikidataId && !result.description) {
      await deps.db.update(artists).set({ wikidataFailedAt: new Date() }).where(eq(artists.id, id))
      return c.json(emptyPayload)
    }

    const mergedDescription: Record<string, string> = {
      ...(cached ?? {}),
      ...(result.description ? { [locale]: result.description } : {}),
    }
    await deps.db
      .update(artists)
      .set({
        description: mergedDescription,
        externalLinks: {
          ...((row.externalLinks as Record<string, string> | null) ?? {}),
          ...result.externalLinks,
        },
        wikidataId: result.wikidataId,
        wikidataFetchedAt: new Date(),
        wikidataFailedAt: null,
      })
      .where(eq(artists.id, id))

    return c.json({
      description: result.description,
      externalLinks: result.externalLinks,
      wikidataId: result.wikidataId,
    })
  })

  router.get('/api/v1/albums/:mbid', async (c) => {
    const mbid = c.req.param('mbid')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbid)) {
      return c.json({ error: 'Invalid MBID format' }, 400)
    }
    const releaseGroups = await mb.getReleaseGroups(mbid)
    return c.json(releaseGroups)
  })

  return router
}
