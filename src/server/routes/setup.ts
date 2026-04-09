import { Hono } from 'hono'
import type { SetupConfig } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import type { HonoEnv } from '@/server/types'

export function setupRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()
  const GLOBAL_SETUP_FIELDS = new Set([
    'lidarrUrl',
    'lidarrApiKey',
    'skipTlsVerify',
    'aiProvider',
    'aiApiKey',
    'aiModel',
    'aiBaseUrl',
    'preferences',
  ])

  router.get('/api/setup/status', async (c) => {
    const complete = await deps.isSetupComplete()
    return c.json({ setupComplete: complete })
  })

  router.post('/api/setup/complete', async (c) => {
    const alreadyDone = await deps.isSetupComplete()
    if (alreadyDone) {
      return c.json({ error: 'Setup already complete' }, 409)
    }

    const body = await c.req.json()
    const sanitized = Object.fromEntries(
      Object.entries(body as Record<string, unknown>).filter(([key]) =>
        GLOBAL_SETUP_FIELDS.has(key),
      ),
    )

    const missing: string[] = []
    if (!sanitized.aiProvider) missing.push('aiProvider')
    if (!sanitized.aiModel) missing.push('aiModel')
    // Lidarr is optional -- only validate if partially provided
    if (sanitized.lidarrUrl && !sanitized.lidarrApiKey) {
      missing.push('lidarrApiKey (required when lidarrUrl is set)')
    }
    if (!sanitized.lidarrUrl && sanitized.lidarrApiKey) {
      missing.push('lidarrUrl (required when lidarrApiKey is set)')
    }

    if (missing.length > 0) {
      return c.json({ error: 'Missing required fields', fields: missing }, 400)
    }

    await deps.completeSetup(sanitized as SetupConfig)

    // Auto-create Lidarr target if Lidarr was configured during setup
    const userId = c.get('userId')
    if (sanitized.lidarrUrl && sanitized.lidarrApiKey && userId) {
      try {
        await deps.targetQueries.createTarget({
          type: 'lidarr',
          name: 'Lidarr',
          config: {
            url: sanitized.lidarrUrl,
            apiKey: sanitized.lidarrApiKey,
            skipTlsVerify: sanitized.skipTlsVerify ?? false,
          },
          userId,
        })
      } catch {
        // Best-effort -- the boot-time backfill will handle it on next restart
      }
    }

    return c.json({ success: true }, 200)
  })

  return router
}
