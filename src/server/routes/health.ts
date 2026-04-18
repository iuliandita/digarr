import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { isShuttingDown } from '@/core/lifecycle'
import { errMsg } from '@/core/validation'
import type { Database } from '@/db'

type HealthDeps = {
  db: Database
}

export function healthRoutes(deps: HealthDeps) {
  const router = new Hono()

  router.get('/health', async (c) => {
    if (isShuttingDown()) {
      return c.json({ status: 'draining' }, 503)
    }
    try {
      await deps.db.execute(sql`SELECT 1`)
      return c.json({ status: 'ok' })
    } catch (err: unknown) {
      console.error('[health] DB check failed:', errMsg(err))
      return c.json({ status: 'error', db: 'unavailable' }, 503)
    }
  })

  return router
}
