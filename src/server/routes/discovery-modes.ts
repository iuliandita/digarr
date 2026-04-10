import { Hono } from 'hono'
import { evaluateDiscoveryModeAvailability } from '@/core/discovery-modes/availability'
import type { AppDependencies } from '@/server'
import type { HonoEnv } from '@/server/types'

export function discoveryModeRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.get('/api/discovery-modes', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const snapshot = await deps.getDiscoveryConnectionSnapshot(userId)
    const modes = deps.discoveryModeRegistry.list().map((mode) => ({
      id: mode.id,
      label: mode.label,
      description: mode.description,
      availability: evaluateDiscoveryModeAvailability(mode.id, snapshot),
      easyFields: mode.easyFields,
      advancedFields: mode.advancedFields,
    }))

    return c.json({ modes })
  })

  return router
}
