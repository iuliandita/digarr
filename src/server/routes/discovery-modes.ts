import { Hono } from 'hono'
import { evaluateDiscoveryModeAvailability } from '@/core/discovery-modes/availability'
import { createDefaultDiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import type { AppDependencies } from '@/server'
import { notAuthenticated } from '@/server/helpers/auth-problems'
import type { HonoEnv } from '@/server/types'

const EMPTY_DISCOVERY_SNAPSHOT = {
  hasListenBrainz: false,
  hasSpotify: false,
  hasLastfm: false,
  hasDiscogs: false,
  hasLibrarySync: false,
}

export function discoveryModeRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()
  const discoveryModeRegistry = deps.discoveryModeRegistry ?? createDefaultDiscoveryModeRegistry()
  const getDiscoveryConnectionSnapshot =
    deps.getDiscoveryConnectionSnapshot ?? (async () => EMPTY_DISCOVERY_SNAPSHOT)

  router.get('/api/v1/discovery-modes', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
    }

    const snapshot = await getDiscoveryConnectionSnapshot(userId)
    const modes = discoveryModeRegistry.list().map((mode) => ({
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
