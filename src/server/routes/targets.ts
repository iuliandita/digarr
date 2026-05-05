import { Hono } from 'hono'
import type { ServiceTestResult } from '@/core/types'
import type { TargetInsert, TargetRow, TargetUpdate } from '@/db/queries/targets'
import { notAuthenticated } from '@/server/helpers/auth-problems'
import { readPagination } from '@/server/helpers/pagination'
import { type Cursor, encodeCursor } from '@/server/helpers/pagination-cursor'
import { problem } from '@/server/helpers/problem'
import { adminGuard } from '@/server/middleware/admin-guard'
import {
  createTargetSchema,
  targetIdParamSchema,
  updateTargetSchema,
} from '@/server/schemas/targets'
import { zJson, zParam } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

type TargetDeps = {
  targetQueries: {
    createTarget: (data: TargetInsert) => Promise<{ id: number }>
    getTargetsByUser: (userId: number) => Promise<TargetRow[]>
    getAllTargets: (opts?: { limit?: number; cursor?: Cursor | null }) => Promise<TargetRow[]>
    getTarget: (id: number) => Promise<TargetRow | null>
    updateTarget: (id: number, data: TargetUpdate) => Promise<void>
    deleteTarget: (id: number) => Promise<void>
  }
  getUserById: (id: number) => Promise<{ isAdmin: boolean } | null>
  testTargetConnection: (
    type: string,
    config: Record<string, unknown>,
  ) => Promise<ServiceTestResult>
}

export function targetRoutes(deps: TargetDeps) {
  const router = new Hono<HonoEnv>()

  // Returns all targets. Each target includes `owned: true` if it belongs to the caller.
  // Non-owners see masked configs and cannot modify/delete.
  router.get('/api/v1/targets', async (c) => {
    const userId = c.get('userId')
    if (!userId) return notAuthenticated(c)
    const page = readPagination(c)
    const shape = (t: TargetRow) => ({
      ...t,
      config: maskConfig(t.config),
      owned: t.userId === userId,
    })
    if (page === null) {
      const allTargets = await deps.targetQueries.getAllTargets()
      return c.json(allTargets.map(shape))
    }
    const rows = await deps.targetQueries.getAllTargets({
      limit: page.limit + 1,
      cursor: page.cursor,
    })
    const hasMore = rows.length > page.limit
    const data = hasMore ? rows.slice(0, page.limit) : rows
    const last = data[data.length - 1]
    const nextCursor =
      hasMore && last ? encodeCursor({ id: last.id, ts: last.createdAt.toISOString() }) : null
    return c.json({ data: data.map(shape), meta: { limit: page.limit, nextCursor } })
  })

  router.post(
    '/api/v1/targets',
    adminGuard(deps.getUserById),
    zJson(createTargetSchema),
    async (c) => {
      const userId = c.get('userId')
      if (!userId) return notAuthenticated(c)
      const { type, name, config } = c.req.valid('json')

      const result = await deps.targetQueries.createTarget({
        type,
        name,
        config,
        userId,
      })
      return c.json(result, 201)
    },
  )

  router.patch(
    '/api/v1/targets/:id',
    adminGuard(deps.getUserById),
    zParam(targetIdParamSchema),
    zJson(updateTargetSchema),
    async (c) => {
      const userId = c.get('userId')
      if (!userId) return notAuthenticated(c)

      const { id } = c.req.valid('param')
      const target = await deps.targetQueries.getTarget(id)
      if (!target || target.userId !== userId) {
        return problem(
          c,
          'target-not-found',
          'Target not found',
          404,
          undefined,
          undefined,
          'errors.target.notFound',
        )
      }

      const allowed: TargetUpdate = c.req.valid('json')
      await deps.targetQueries.updateTarget(id, allowed)
      return c.body(null, 204)
    },
  )

  router.delete(
    '/api/v1/targets/:id',
    adminGuard(deps.getUserById),
    zParam(targetIdParamSchema),
    async (c) => {
      const userId = c.get('userId')
      if (!userId) return notAuthenticated(c)

      const { id } = c.req.valid('param')
      const target = await deps.targetQueries.getTarget(id)
      if (!target || target.userId !== userId) {
        return problem(
          c,
          'target-not-found',
          'Target not found',
          404,
          undefined,
          undefined,
          'errors.target.notFound',
        )
      }

      await deps.targetQueries.deleteTarget(id)
      return c.body(null, 204)
    },
  )

  router.post('/api/v1/targets/:id/test', zParam(targetIdParamSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return notAuthenticated(c)

    const { id } = c.req.valid('param')
    const target = await deps.targetQueries.getTarget(id)
    if (!target || target.userId !== userId) {
      return problem(
        c,
        'target-not-found',
        'Target not found',
        404,
        undefined,
        undefined,
        'errors.target.notFound',
      )
    }

    const result = await deps.testTargetConnection(target.type, target.config)
    return c.json(result)
  })

  return router
}

function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config }
  for (const key of ['apiKey', 'token', 'password', 'secret']) {
    if (typeof masked[key] === 'string') masked[key] = '***'
  }
  return masked
}
