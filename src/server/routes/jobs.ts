import { Hono } from 'hono'
import type { JobRunRow, JobType } from '@/core/jobs/types'
import type { HealthSummary } from '@/db/queries/jobs'
import type { AppDependencies } from '@/server'
import { adminGuard } from '@/server/middleware/admin-guard'
import { jobIdParamSchema, listJobsQuerySchema } from '@/server/schemas/jobs'
import { zParam, zQuery } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

type JobRouteDeps = Pick<AppDependencies, 'getUserById'> & {
  jobQueries: {
    listJobs: (filters?: {
      type?: JobType
      status?: string
      limit?: number
      offset?: number
    }) => Promise<{ items: JobRunRow[]; total: number }>
    getJobById: (id: number) => Promise<JobRunRow | null>
    getJobHealth: (nextRun: Date | null) => Promise<HealthSummary>
  }
  scheduler: { nextRun: Date | null }
}

export function jobRoutes(deps: JobRouteDeps) {
  const router = new Hono<HonoEnv>()

  router.use('/api/jobs/*', adminGuard(deps.getUserById))
  router.use('/api/jobs', adminGuard(deps.getUserById))

  // Health summary - must be before /:id to avoid matching 'health' as an id
  router.get('/api/jobs/health', async (c) => {
    const health = await deps.jobQueries.getJobHealth(deps.scheduler.nextRun)
    return c.json(health)
  })

  // Single job detail
  router.get('/api/jobs/:id', zParam(jobIdParamSchema), async (c) => {
    const { id } = c.req.valid('param')
    const job = await deps.jobQueries.getJobById(id)
    if (!job) return c.json({ error: 'Job not found' }, 404)
    return c.json(job)
  })

  // Paginated job list
  router.get('/api/jobs', zQuery(listJobsQuerySchema), async (c) => {
    const { type, status, limit: rawLimit, offset: rawOffset } = c.req.valid('query')
    const limit = rawLimit ?? 50
    const offset = rawOffset ?? 0
    const result = await deps.jobQueries.listJobs({
      type: type as JobType | undefined,
      status,
      limit,
      offset,
    })
    return c.json(result)
  })

  return router
}
