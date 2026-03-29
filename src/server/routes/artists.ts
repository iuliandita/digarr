import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createDeezerClient } from '@/core/clients/deezer'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import type { TopTrack } from '@/db/schema'
import { artists } from '@/db/schema'
import type { AppDependencies } from '@/server'

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function artistRoutes(deps: AppDependencies) {
  const router = new Hono()

  router.get('/api/artists/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const artist = await deps.getArtistById(id)
    if (!artist) {
      return c.json({ error: 'Artist not found' }, 404)
    }
    return c.json(artist)
  })

  router.get('/api/artists/:id/top-tracks', async (c) => {
    const id = Number(c.req.param('id'))
    const artist = await deps.getArtistById(id)
    if (!artist) {
      return c.json({ error: 'Artist not found' }, 404)
    }

    // Return cached tracks if fresh (< 30 days)
    const cachedTracks = artist.topTracks as TopTrack[] | null
    if (cachedTracks && artist.cachedAt) {
      const age = Date.now() - new Date(artist.cachedAt).getTime()
      if (age < CACHE_TTL_MS) {
        return c.json({ tracks: cachedTracks })
      }
    }

    // Fetch from Deezer
    const deezer = createDeezerClient()
    let tracks: TopTrack[] = []

    const [topResult] = await deezer.searchArtists(artist.name, 1)
    if (topResult) {
      tracks = await deezer.getArtistTopTracks(topResult.id, 5)
    }

    // Fallback: MusicBrainz recordings (titles only, no preview)
    if (tracks.length === 0) {
      const mb = createMusicBrainzClient()
      try {
        const recordings = await mb.getRecordings(artist.mbid, 5)
        tracks = recordings.map((r) => ({ name: r.title }))
      } catch {
        // MB fallback failed, return empty
      }
    }

    // Cache result in DB
    await deps.db
      .update(artists)
      .set({ topTracks: tracks, cachedAt: new Date() })
      .where(eq(artists.id, id))

    return c.json({ tracks })
  })

  router.get('/api/albums/:mbid', async (c) => {
    const mbid = c.req.param('mbid')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbid)) {
      return c.json({ error: 'Invalid MBID format' }, 400)
    }
    const mb = createMusicBrainzClient()
    const releaseGroups = await mb.getReleaseGroups(mbid)
    return c.json(releaseGroups)
  })

  return router
}
