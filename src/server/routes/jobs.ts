import { Hono } from 'hono'
import type { JobRunRow, JobType } from '@/core/jobs/types'
import type { HealthSummary } from '@/db/queries/jobs'
import type { AppDependencies } from '@/server'
import { adminGuard } from '@/server/middleware/admin-guard'
import type { HonoEnv } from '@/server/types'

const VALID_TYPES = new Set<string>([
  'pipeline',
  'quick_discover',
  'subscription',
  'target',
  'playlist',
  'library_sync',
])
const VALID_STATUSES = new Set<string>(['running', 'completed', 'failed', 'stuck'])

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
    const typeParam = c.req.query('type')
    if (typeParam && !VALID_TYPES.has(typeParam)) {
      return c.json({ error: `Invalid type. Use: ${Array.from(VALID_TYPES).join(', ')}` }, 400)
    }
    const type = typeParam as JobType | undefined
    const statusParam = c.req.query('status')
    if (statusParam && !VALID_STATUSES.has(statusParam)) {
      return c.json({ error: `Invalid status. Use: ${Array.from(VALID_STATUSES).join(', ')}` }, 400)
    }
    const status = statusParam
    const rawLimit = Number(c.req.query('limit'))
    const rawOffset = Number(c.req.query('offset'))
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 100))
    const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0)
    const result = await deps.jobQueries.listJobs({ type, status, limit, offset })
    return c.json(result)
  })

  return router
}
