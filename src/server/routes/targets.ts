import { Hono } from 'hono'
import type { ServiceTestResult } from '@/core/types'
import type { TargetInsert, TargetRow, TargetUpdate } from '@/db/queries/targets'
import { resolveAdmin } from '@/server/middleware/admin-guard'
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
    getAllTargets: () => Promise<TargetRow[]>
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
  router.get('/api/targets', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const allTargets = await deps.targetQueries.getAllTargets()
    return c.json(
      allTargets.map((t) => ({
        ...t,
        config: maskConfig(t.config),
        owned: t.userId === userId,
      })),
    )
  })

  router.post('/api/targets', zJson(createTargetSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    if (
      !(await resolveAdmin(
        userId,
        deps.getUserById,
        c.get('authSkipped'),
        c.get('legacyTokenAuth'),
      ))
    )
      return c.json({ error: 'Admin access required' }, 403)

    const { type, name, config } = c.req.valid('json')

    const result = await deps.targetQueries.createTarget({
      type,
      name,
      config,
      userId,
    })
    return c.json(result, 201)
  })

  router.patch(
    '/api/targets/:id',
    zParam(targetIdParamSchema),
    zJson(updateTargetSchema),
    async (c) => {
      const userId = c.get('userId')
      if (!userId) return c.json({ error: 'Unauthorized' }, 401)

      if (
        !(await resolveAdmin(
          userId,
          deps.getUserById,
          c.get('authSkipped'),
          c.get('legacyTokenAuth'),
        ))
      )
        return c.json({ error: 'Admin access required' }, 403)

      const { id } = c.req.valid('param')
      const target = await deps.targetQueries.getTarget(id)
      if (!target || target.userId !== userId) {
        return c.json({ error: 'Target not found' }, 404)
      }

      const allowed: TargetUpdate = c.req.valid('json')
      await deps.targetQueries.updateTarget(id, allowed)
      return c.json({ success: true })
    },
  )

  router.delete('/api/targets/:id', zParam(targetIdParamSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    if (
      !(await resolveAdmin(
        userId,
        deps.getUserById,
        c.get('authSkipped'),
        c.get('legacyTokenAuth'),
      ))
    )
      return c.json({ error: 'Admin access required' }, 403)

    const { id } = c.req.valid('param')
    const target = await deps.targetQueries.getTarget(id)
    if (!target || target.userId !== userId) {
      return c.json({ error: 'Target not found' }, 404)
    }

    await deps.targetQueries.deleteTarget(id)
    return c.body(null, 204)
  })

  router.post('/api/targets/:id/test', zParam(targetIdParamSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const { id } = c.req.valid('param')
    const target = await deps.targetQueries.getTarget(id)
    if (!target || target.userId !== userId) {
      return c.json({ error: 'Target not found' }, 404)
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
