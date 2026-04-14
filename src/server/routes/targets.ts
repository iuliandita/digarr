import { Hono } from 'hono'
import { TARGET_TYPES } from '@/core/targets/types'
import type { ServiceTestResult } from '@/core/types'
import type { TargetInsert, TargetRow, TargetUpdate } from '@/db/queries/targets'
import { resolveAdmin } from '@/server/middleware/admin-guard'
import type { HonoEnv } from '@/server/types'

const VALID_TARGET_TYPES: ReadonlySet<string> = new Set(TARGET_TYPES)

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

  router.post('/api/targets', async (c) => {
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

    const body = await c.req.json()
    const { type, name, config } = body as {
      type?: string
      name?: string
      config?: Record<string, unknown>
    }

    if (!type || !name || !config) {
      return c.json({ error: 'type, name, and config are required' }, 400)
    }
    if (!VALID_TARGET_TYPES.has(type)) {
      return c.json({ error: `Invalid target type: ${type}` }, 400)
    }

    // SSRF check for URL fields
    if (typeof config.url === 'string') {
      if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
        return c.json({ error: 'URL must start with http:// or https://' }, 400)
      }
    }

    const result = await deps.targetQueries.createTarget({
      type,
      name,
      config,
      userId,
    })
    return c.json(result, 201)
  })

  router.patch('/api/targets/:id', async (c) => {
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

    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid target ID' }, 400)
    const target = await deps.targetQueries.getTarget(id)
    if (!target || target.userId !== userId) {
      return c.json({ error: 'Target not found' }, 404)
    }

    const body = await c.req.json()
    const allowed: TargetUpdate = {}
    if (body.name !== undefined) allowed.name = body.name
    if (body.config !== undefined) allowed.config = body.config
    if (body.enabled !== undefined) allowed.enabled = body.enabled

    await deps.targetQueries.updateTarget(id, allowed)
    return c.json({ success: true })
  })

  router.delete('/api/targets/:id', async (c) => {
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

    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid target ID' }, 400)
    const target = await deps.targetQueries.getTarget(id)
    if (!target || target.userId !== userId) {
      return c.json({ error: 'Target not found' }, 404)
    }

    await deps.targetQueries.deleteTarget(id)
    return c.body(null, 204)
  })

  router.post('/api/targets/:id/test', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid target ID' }, 400)
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
