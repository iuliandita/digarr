import { Hono } from 'hono'
import { logAndSanitize } from '@/core/validation'
import type { AppDependencies } from '@/server'
import { adminGuard } from '@/server/middleware/admin-guard'
import type { HonoEnv } from '@/server/types'

type SlskdRouteDeps = Pick<AppDependencies, 'getUserById'> & {
  slskdOrchestrator: NonNullable<AppDependencies['slskdOrchestrator']>
}

export function slskdRoutes(deps: SlskdRouteDeps) {
  const router = new Hono<HonoEnv>()

  router.use('/api/v1/slskd/*', adminGuard(deps.getUserById))
  router.use('/api/v1/slskd/sync', adminGuard(deps.getUserById))

  router.get('/api/v1/slskd/jobs', async (c) => {
    const rawLimit = c.req.query('limit')
    const parsedLimit = rawLimit == null ? null : Number(rawLimit)
    const limit =
      parsedLimit != null && Number.isInteger(parsedLimit)
        ? Math.max(1, Math.min(200, parsedLimit))
        : undefined
    const jobs = await deps.slskdOrchestrator.getActiveJobs(limit)

    return c.json({
      syncing: deps.slskdOrchestrator.isSyncing,
      jobs: jobs.map((job) => ({
        id: job.id,
        targetId: job.targetId,
        recommendationId: job.recommendationId,
        state: job.state,
        releaseTitle: job.releaseTitle,
      })),
    })
  })

  router.post('/api/v1/slskd/sync', async (c) => {
    try {
      void deps.slskdOrchestrator.triggerSync().catch((error) => {
        console.error('[slskd] manual sync failed:', error)
      })
    } catch (error) {
      return c.json({ error: logAndSanitize(error, 'slskd-sync') }, 500)
    }

    return c.body(null, 202)
  })

  return router
}
