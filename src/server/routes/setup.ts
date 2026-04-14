import { Hono } from 'hono'
import { validatePublicServiceUrl } from '@/core/url-safety'
import type { SetupConfig } from '@/db/queries/settings'
import { updateUserConnections } from '@/db/queries/users'
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

    const body = (await c.req.json()) as Record<string, unknown>
    const sanitized = Object.fromEntries(
      Object.entries(body).filter(([key]) => GLOBAL_SETUP_FIELDS.has(key)),
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
    // Emby is optional -- only validate if partially provided
    if (body.embyUrl && (!body.embyApiKey || !body.embyUserId)) {
      missing.push('embyApiKey and embyUserId (required when embyUrl is set)')
    }

    if (missing.length > 0) {
      return c.json({ error: 'Missing required fields', fields: missing }, 400)
    }

    if (typeof body.embyUrl === 'string' && body.embyUrl) {
      const validation = await validatePublicServiceUrl(body.embyUrl, 'Emby URL')
      if (!validation.ok) {
        return c.json({ error: validation.message }, 400)
      }
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

    // Persist Emby credentials on the users row and auto-create the playlist
    // target if Emby was configured during setup. Both are needed: the target
    // drives playlist push, while the users.emby_* columns drive library sync,
    // the discovery plugin, and the listening-history fallback.
    if (body.embyUrl && body.embyApiKey && body.embyUserId && userId) {
      try {
        await updateUserConnections(deps.db, userId, {
          embyUrl: body.embyUrl as string,
          embyApiKey: body.embyApiKey as string,
          embyUserId: body.embyUserId as string,
        })
      } catch (err) {
        // Best-effort, but log loudly: a silent failure here leaves library
        // sync, the discovery plugin, and the listening fallback all seeing
        // NULL Emby credentials while the setup wizard reports success.
        console.warn(
          '[setup] updateUserConnections failed for emby; credentials not persisted:',
          err,
        )
      }
      try {
        await deps.targetQueries.createTarget({
          type: 'emby-playlist',
          name: 'Emby',
          config: {
            url: body.embyUrl as string,
            apiKey: body.embyApiKey as string,
            userId: body.embyUserId as string,
            skipTlsVerify: sanitized.skipTlsVerify ?? false,
          },
          userId,
        })
      } catch (err) {
        // Best-effort -- surface failures later via the targets UI
        console.warn('[setup] createTarget failed for emby-playlist:', err)
      }
    }

    return c.json({ success: true }, 200)
  })

  return router
}
