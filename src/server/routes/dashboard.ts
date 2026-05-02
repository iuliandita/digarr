import { Hono } from 'hono'
import type { AppDependencies } from '@/server'
import { parseOptionalClampedInt } from '@/server/helpers/parse-int-clamp'
import { resolveAdmin } from '@/server/middleware/admin-guard'
import type { HonoEnv } from '@/server/types'

export function dashboardRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.get('/api/v1/dashboard/taste', async (c) => {
    const userId = c.get('userId')
    const taste = await deps.dashboardQueries.getTopGenresForUser(userId)
    return c.json(taste)
  })

  router.get('/api/v1/dashboard/activity', async (c) => {
    const userId = c.get('userId')
    const limit = parseOptionalClampedInt(c.req.query('limit'), { min: 1, max: 20, default: 5 })
    if (limit == null) {
      return c.json({ error: 'limit must be an integer' }, 400)
    }

    const isAdmin = await resolveAdmin(
      userId,
      deps.getUserById,
      c.get('authSkipped'),
      c.get('legacyTokenAuth'),
    )

    const activity = await deps.dashboardQueries.getRecentActivity(userId, isAdmin, limit)
    return c.json(activity)
  })

  return router
}
