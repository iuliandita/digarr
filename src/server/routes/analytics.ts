import { Hono } from 'hono'
import {
  getApprovalTrend,
  getBatchesWithCounts,
  getOverviewStats,
  getScoreDistribution,
  getSourceEffectiveness,
  getTimeToAct,
  getTopGenres,
} from '@/db/queries/analytics'
import type { AppDependencies } from '@/server'

export function analyticsRoutes(deps: AppDependencies) {
  const router = new Hono()

  router.get('/api/v1/analytics/overview', async (c) => {
    const stats = await getOverviewStats(deps.db)
    return c.json(stats)
  })

  router.get('/api/v1/analytics/batches', async (c) => {
    const batches = await getBatchesWithCounts(deps.db)
    return c.json(batches)
  })

  router.get('/api/v1/analytics/genres', async (c) => {
    const genres = await getTopGenres(deps.db)
    return c.json(genres)
  })

  router.get('/api/v1/analytics/sources', async (c) => {
    const sources = await getSourceEffectiveness(deps.db)
    return c.json(sources)
  })

  router.get('/api/v1/analytics/scores', async (c) => {
    const dist = await getScoreDistribution(deps.db)
    return c.json(dist)
  })

  router.get('/api/v1/analytics/trend', async (c) => {
    const trend = await getApprovalTrend(deps.db)
    return c.json(trend)
  })

  router.get('/api/v1/analytics/time-to-act', async (c) => {
    const tta = await getTimeToAct(deps.db)
    return c.json(tta)
  })

  return router
}
