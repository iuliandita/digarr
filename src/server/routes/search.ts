import { Hono } from 'hono'
import type { SearchSourceDescriptor } from '@/core/search/catalog'
import type { MergedSearchResult } from '@/core/search/multi-source'
import { parseOptionalClampedInt } from '@/server/helpers/parse-int-clamp'
import type { HonoEnv } from '@/server/types'

export type SearchDeps = {
  listSources: (userId?: number) => Promise<SearchSourceDescriptor[]>
  search: (
    query: string,
    opts?: { limit?: number; sources?: string[]; userId?: number },
  ) => Promise<MergedSearchResult[]>
}

export function searchRoutes(deps: SearchDeps) {
  const router = new Hono<HonoEnv>()

  router.get('/api/v1/search/sources', async (c) => {
    const userId = c.get('userId')
    const sources = await deps.listSources(userId)
    return c.json({ sources })
  })

  router.get('/api/v1/search', async (c) => {
    const query = c.req.query('q')
    if (!query || query.trim() === '') {
      return c.json({ error: 'q parameter is required' }, 400)
    }
    const limit = parseOptionalClampedInt(c.req.query('limit'), { min: 1, max: 50, default: 20 })
    if (limit == null) {
      return c.json({ error: 'limit must be an integer' }, 400)
    }
    const sourcesParam = c.req.query('sources')?.split(',').filter(Boolean)
    const userId = c.get('userId')

    try {
      const results = await deps.search(query, { limit, sources: sourcesParam, userId })
      return c.json({ results })
    } catch (err: unknown) {
      console.error('[search] failed:', err instanceof Error ? err.message : String(err))
      return c.json({ error: 'Search failed' }, 500)
    }
  })

  return router
}
