import { Hono } from 'hono'
import type { SetupConfig } from '@/db/queries/settings'
import { SetupAlreadyCompleteError, SetupOwnerRequiredError } from '@/db/queries/setup'
import type { AppDependencies } from '@/server'
import { notAuthenticated } from '@/server/helpers/auth-problems'
import { problem } from '@/server/helpers/problem'
import { setupCompleteSchema } from '@/server/schemas/setup'
import { zJson } from '@/server/schemas/validator'
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

  router.get('/api/v1/setup/status', async (c) => {
    const complete = await deps.isSetupComplete()
    return c.json({ setupComplete: complete })
  })

  router.post('/api/v1/setup/complete', zJson(setupCompleteSchema), async (c) => {
    const alreadyDone = await deps.isSetupComplete()
    if (alreadyDone) {
      return c.json({ error: 'Setup already complete' }, 409)
    }

    const body = c.req.valid('json') as Record<string, unknown>
    const sanitized = Object.fromEntries(
      Object.entries(body).filter(([key, value]) => GLOBAL_SETUP_FIELDS.has(key) && value != null),
    )

    const missing: string[] = []
    if (!sanitized.aiProvider) missing.push('aiProvider')
    if (!sanitized.aiModel) missing.push('aiModel')
    const hasValue = (value: unknown) => typeof value === 'string' && value.trim().length > 0
    // Lidarr is optional - only validate if partially provided
    if ((sanitized.lidarrUrl || sanitized.lidarrApiKey) && !hasValue(sanitized.lidarrApiKey)) {
      missing.push('lidarrApiKey (required when lidarrUrl is set)')
    }
    if ((sanitized.lidarrUrl || sanitized.lidarrApiKey) && !hasValue(sanitized.lidarrUrl)) {
      missing.push('lidarrUrl (required when lidarrApiKey is set)')
    }
    // Emby is optional - only validate if partially provided
    if (
      (body.embyUrl || body.embyApiKey || body.embyUserId) &&
      (!hasValue(body.embyUrl) || !hasValue(body.embyApiKey) || !hasValue(body.embyUserId))
    ) {
      missing.push('embyUrl, embyApiKey and embyUserId (required together)')
    }

    if (missing.length > 0) {
      return c.json({ error: 'Missing required fields', fields: missing }, 400)
    }

    const userId = c.get('userId')
    if ((sanitized.lidarrUrl || body.embyUrl) && !userId) return notAuthenticated(c)

    try {
      await deps.completeSetup(sanitized as SetupConfig, {
        userId,
        ...(body.embyUrl
          ? {
              emby: {
                url: body.embyUrl as string,
                apiKey: body.embyApiKey as string,
                userId: body.embyUserId as string,
              },
            }
          : {}),
      })
    } catch (error) {
      if (error instanceof SetupOwnerRequiredError) return notAuthenticated(c)
      if (error instanceof SetupAlreadyCompleteError) {
        return c.json({ error: 'Setup already complete' }, 409)
      }
      return problem(
        c,
        'setup-failed',
        'Setup could not be saved',
        500,
        undefined,
        undefined,
        'setup.failed',
      )
    }

    return c.body(null, 204)
  })

  return router
}
