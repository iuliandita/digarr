import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Database } from '@/db'

type HealthDeps = {
  db: Database
}

export function healthRoutes(deps: HealthDeps) {
  const router = new Hono()

  router.get('/health', async (c) => {
    try {
      await deps.db.execute(sql`SELECT 1`)
      return c.json({ status: 'ok' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ status: 'error', db: message }, 503)
    }
  })

  return router
}
