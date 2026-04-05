import { Hono } from 'hono'
import type { JobType } from '@/core/jobs/types'
import type { AppDependencies } from '@/server'
import { adminGuard } from '@/server/middleware/admin-guard'
import type { HonoEnv } from '@/server/types'

type JobRouteDeps = Pick<AppDependencies, 'getUserById'> & {
  jobQueries: {
    listJobs: (filters?: {
      type?: JobType
      status?: string
      limit?: number
      offset?: number
    }) => Promise<{ items: unknown[]; total: number }>
    getJobById: (id: number) => Promise<unknown | null>
    getJobHealth: (nextRun: Date | null) => Promise<unknown>
  }
  scheduler: { nextRun: Date | null }
}

export function jobRoutes(deps: JobRouteDeps) {
  const router = new Hono<HonoEnv>()

  router.use('/api/jobs/*', adminGuard(deps.getUserById))
  router.use('/api/jobs', adminGuard(deps.getUserById))

  // Health summary -- must be before /:id to avoid matching 'health' as an id
  router.get('/api/jobs/health', async (c) => {
    const health = await deps.jobQueries.getJobHealth(deps.scheduler.nextRun)
    return c.json(health)
  })

  // Single job detail
  router.get('/api/jobs/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (Number.isNaN(id)) return c.json({ error: 'Invalid job ID' }, 400)
    const job = await deps.jobQueries.getJobById(id)
    if (!job) return c.json({ error: 'Job not found' }, 404)
    return c.json(job)
  })

  // Paginated job list
  router.get('/api/jobs', async (c) => {
    const type = c.req.query('type') as JobType | undefined
    const status = c.req.query('status')
    const limit = Math.min(Number(c.req.query('limit')) || 50, 100)
    const offset = Number(c.req.query('offset')) || 0
    const result = await deps.jobQueries.listJobs({ type, status, limit, offset })
    return c.json(result)
  })

  return router
}
