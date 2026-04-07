import { Hono } from 'hono'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createLidarrLibrarySource } from '@/core/library/sources/lidarr'
import { getArtistsByGenre, getGenreEnrichments } from '@/db/queries/artists'
import { getGenreArtists } from '@/db/queries/recommendations'
import type { AppDependencies } from '@/server'
import type { HonoEnv } from '@/server/types'

export function genreRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.get('/api/genres', async (c) => {
    const [genres, enrichments] = await Promise.all([
      deps.genreService.getLibraryGenres(),
      getGenreEnrichments(deps.db, 3),
    ])
    const enriched = genres
      .map((g) => {
        const e = enrichments.get(g.name)
        return {
          ...g,
          artistCount: e?.liveCount ?? 0,
          exampleArtists: e?.examples ?? [],
        }
      })
      .filter((g) => g.artistCount > 0)
    return c.json(enriched)
  })

  router.get('/api/genres/search', async (c) => {
    const q = c.req.query('q') ?? ''
    if (q.length < 2) {
      return c.json({ error: 'Query must be at least 2 characters' }, 400)
    }
    const results = await deps.genreService.search(q)
    return c.json(results)
  })

  router.get('/api/genres/:slug', async (c) => {
    const slug = c.req.param('slug')
    const genre = await deps.genreService.getOrFetchGenre(slug)
    if (!genre) {
      return c.json({ error: 'Genre not found' }, 404)
    }
    const [subGenres, libraryArtists] = await Promise.all([
      deps.genreService.getSubGenres(genre.id),
      getArtistsByGenre(deps.db, genre.name),
    ])
    return c.json({ ...genre, subGenres, libraryArtists })
  })

  router.get('/api/genres/:slug/artists', async (c) => {
    const slug = c.req.param('slug')
    const view = (c.req.query('view') ?? 'recommended') as 'recommended' | 'trending' | 'deep_cuts'
    const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') ?? 20) || 20))
    const userId = c.get('userId')

    const VALID_VIEWS = new Set(['recommended', 'trending', 'deep_cuts'])
    if (!VALID_VIEWS.has(view)) {
      return c.json({ error: 'Invalid view. Use recommended, trending, or deep_cuts.' }, 400)
    }

    const genre = await deps.genreService.getOrFetchGenre(slug)
    if (!genre) {
      return c.json({ error: 'Genre not found' }, 404)
    }

    const artists = await getGenreArtists(deps.db, genre.name, view, limit, userId)
    return c.json({ artists })
  })

  router.post('/api/genres/seed', async (c) => {
    const settings = await deps.getSettings()
    if (!settings?.lidarrUrl || !settings?.lidarrApiKey) {
      return c.json({ error: 'Lidarr not configured' }, 400)
    }

    const lidarr = createLidarrClient(
      settings.lidarrUrl as string,
      settings.lidarrApiKey as string,
      (settings.skipTlsVerify as boolean) ?? false,
    )

    // Fire-and-forget
    createLidarrLibrarySource(lidarr)
      .listArtists()
      .then((artists) =>
        deps.genreService.seedFromLibrary(
          artists.map((artist) => ({ genres: artist.genres ?? [] })),
        ),
      )
      .catch((err: unknown) => {
        console.error('Genre seed failed:', err)
      })

    return c.json({ message: 'Genre seed started' }, 202)
  })

  return router
}
