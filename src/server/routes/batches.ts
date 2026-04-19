import { Hono } from 'hono'
import type { AppDependencies } from '@/server'
import { readPagination } from '@/server/helpers/pagination'
import { encodeCursor } from '@/server/helpers/pagination-cursor'

export function batchRoutes(deps: AppDependencies) {
  const router = new Hono()

  router.get('/api/v1/batches', async (c) => {
    const page = readPagination(c)
    if (page === null) {
      const batches = await deps.listBatches()
      return c.json(batches)
    }
    const rows = await deps.listBatches({ limit: page.limit + 1, cursor: page.cursor })
    const hasMore = rows.length > page.limit
    const data = hasMore ? rows.slice(0, page.limit) : rows
    const last = data[data.length - 1]
    const nextCursor =
      hasMore && last ? encodeCursor({ id: last.id, ts: last.createdAt.toISOString() }) : null
    return c.json({ data, meta: { limit: page.limit, nextCursor } })
  })

  router.get('/api/v1/batches/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid batch ID' }, 400)
    const batch = await deps.getBatch(id)
    if (!batch) {
      return c.json({ error: 'Batch not found' }, 404)
    }
    return c.json(batch)
  })

  return router
}
