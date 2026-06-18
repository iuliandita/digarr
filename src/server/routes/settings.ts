import { Hono } from 'hono'
import { envConfig } from '@/config/env'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { sendWebhook } from '@/core/notifications'
import { validateAiBaseUrl } from '@/core/url-safety'
import { logAndSanitize } from '@/core/validation'
import { getUserConnections, updateUserConnections } from '@/db/queries/users'
import type { Preferences } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { problem } from '@/server/helpers/problem'
import { resolveRequestMessages } from '@/server/locale'
import { resolveAdmin } from '@/server/middleware/admin-guard'
import { updateSettingsSchema } from '@/server/schemas/settings'
import { zJson } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

const SECRET_FIELDS = [
  'lidarrApiKey',
  'listenbrainzToken',
  'lastfmApiKey',
  'aiApiKey',
  'audiodbApiKey',
  'oidcClientSecret',
  'plexToken',
  'jellyfinApiKey',
  'embyApiKey',
  'discogsToken',
] as const

type SettingsResponse = Record<string, unknown>

function maskSecrets(settings: Record<string, unknown>): SettingsResponse {
  const masked: SettingsResponse = { ...settings }
  for (const field of SECRET_FIELDS) {
    if (typeof masked[field] === 'string' && masked[field].length > 0) {
      masked[field] = '***'
    }
  }
  return masked
}

function mergePreferenceUpdate(
  current: Partial<Preferences> | null | undefined,
  incoming: Partial<Preferences>,
): Partial<Preferences> {
  const merged: Partial<Preferences> = {
    ...(current ?? {}),
    ...incoming,
  }

  if (current?.scoringWeights && incoming.scoringWeights) {
    merged.scoringWeights = {
      ...current.scoringWeights,
      ...incoming.scoringWeights,
    }
  }

  return merged
}

type ProbeTestResult = {
  success: boolean
  message: string
  details?: Record<string, unknown>
}

// Returns a problem+json response on probe failure with the detail sanitized
// to avoid leaking upstream error bodies. Successful probes keep message as
// the stable UI field and include cheap optional metadata when available.
function probeResult(
  c: Parameters<typeof problem>[0],
  result: ProbeTestResult,
  fallbackMessage: string,
  latencyMs?: number,
) {
  if (result.success) {
    const version = result.details?.version
    return c.json(
      {
        message: result.message,
        ...(typeof version === 'string' && version.length > 0 ? { version } : {}),
        ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      },
      200,
    )
  }
  return problem(
    c,
    'probe-failed',
    'Probe failed',
    502,
    fallbackMessage,
    undefined,
    'common.unknownError',
  )
}

async function runProbe(
  c: Parameters<typeof problem>[0],
  probe: () => Promise<ProbeTestResult>,
  fallbackMessage: string,
) {
  const startedAt = performance.now()
  const result = await probe()
  return probeResult(
    c,
    result,
    fallbackMessage,
    Math.max(0, Math.round(performance.now() - startedAt)),
  )
}

/** Strip global connection fields that should not leak to non-admin users. */
function stripForNonAdmin(settings: Record<string, unknown>): SettingsResponse {
  const stripped: SettingsResponse = {}

  // Non-admins see: lidarrUrl (read-only context), aiProvider, aiModel (no keys),
  // setupComplete, preferences (for scoring weights), skipTlsVerify
  const ALLOWED_GLOBAL = new Set([
    'id',
    'setupComplete',
    'lidarrUrl',
    'aiProvider',
    'aiModel',
    'skipTlsVerify',
    'preferences',
  ])

  for (const [key, val] of Object.entries(settings)) {
    if (ALLOWED_GLOBAL.has(key) || key.startsWith('_')) {
      stripped[key] = val
    }
  }

  // Strip webhook URL from preferences for non-admins
  if (stripped.preferences && typeof stripped.preferences === 'object') {
    const prefs = { ...(stripped.preferences as Record<string, unknown>) }
    delete prefs.webhookUrl
    // Keep scheduleCron visible but not editable (frontend hides the tab)
    stripped.preferences = prefs
  }

  return stripped
}

async function buildSettingsResponse(
  deps: AppDependencies,
  userId: number | undefined,
  isAdmin: boolean,
): Promise<Record<string, unknown> | null> {
  const row = await deps.getSettings()
  if (!row) return null

  let response: Record<string, unknown> = { ...row }

  // Non-admins get a stripped view of global settings
  if (!isAdmin) {
    response = stripForNonAdmin(response)
  }

  if (userId) {
    const userConns = await getUserConnections(deps.db, userId)
    if (userConns) {
      response.listenbrainzUsername = userConns.listenbrainzUsername ?? ''
      response.listenbrainzToken = userConns.listenbrainzToken
      response._listenbrainzScope = 'user'
      response.lastfmUsername = userConns.lastfmUsername ?? ''
      response.lastfmApiKey = userConns.lastfmApiKey
      response._lastfmScope = 'user'
      response.plexUrl = userConns.plexUrl ?? ''
      response.plexToken = userConns.plexToken
      response._plexScope = 'user'
      response.jellyfinUrl = userConns.jellyfinUrl ?? ''
      response.jellyfinApiKey = userConns.jellyfinApiKey
      response.jellyfinUserId = userConns.jellyfinUserId ?? ''
      response._jellyfinScope = 'user'
      response.embyUrl = userConns.embyUrl ?? ''
      response.embyApiKey = userConns.embyApiKey
      response.embyUserId = userConns.embyUserId ?? ''
      response._embyScope = 'user'
      response.discogsUsername = userConns.discogsUsername ?? ''
      response.discogsToken = userConns.discogsToken
      response._discogsScope = 'user'
    }
  }

  return response
}

export function settingsRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.get('/api/v1/settings', async (c) => {
    const userId = c.get('userId')
    const isAdmin = await resolveAdmin(
      userId,
      deps.getUserById,
      c.get('authSkipped'),
      c.get('legacyTokenAuth'),
    )
    const response = await buildSettingsResponse(deps, userId, isAdmin)
    if (!response) {
      return c.json({ error: 'Settings not found' }, 404)
    }
    return c.json(maskSecrets(response))
  })

  const GLOBAL_MUTABLE_FIELDS = new Set([
    'lidarrUrl',
    'lidarrApiKey',
    'skipTlsVerify',
    'librarySyncIntervalHours',
    'aiProvider',
    'aiApiKey',
    'aiModel',
    'aiBaseUrl',
    'audiodbApiKey',
    'audiodbProxyImages',
    'wikidataEnabled',
    'preferences',
    'oidcIssuerUrl',
    'oidcClientId',
    'oidcClientSecret',
    'oidcScopes',
  ])

  const USER_CONNECTION_FIELDS = new Set([
    'listenbrainzUsername',
    'listenbrainzToken',
    'lastfmUsername',
    'lastfmApiKey',
    'plexUrl',
    'plexToken',
    'jellyfinUrl',
    'jellyfinApiKey',
    'jellyfinUserId',
    'embyUrl',
    'embyApiKey',
    'embyUserId',
    'discogsToken',
    'discogsUsername',
  ])

  const ALL_MUTABLE_FIELDS = new Set([...GLOBAL_MUTABLE_FIELDS, ...USER_CONNECTION_FIELDS])

  router.patch('/api/v1/settings', zJson(updateSettingsSchema), async (c) => {
    const body = c.req.valid('json')
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value === undefined) continue
      if (ALL_MUTABLE_FIELDS.has(key)) {
        sanitized[key] = value
      }
    }

    const userId = c.get('userId')
    const isAdmin = await resolveAdmin(
      userId,
      deps.getUserById,
      c.get('authSkipped'),
      c.get('legacyTokenAuth'),
    )
    const storedSettings =
      Object.hasOwn(sanitized, 'preferences') || Object.hasOwn(sanitized, 'skipTlsVerify')
        ? await deps.getSettings()
        : null

    // Split fields into user-connection vs global
    const userUpdate: Record<string, string | null> = {}
    const globalFields: Record<string, unknown> = {}

    for (const [key, val] of Object.entries(sanitized)) {
      if (USER_CONNECTION_FIELDS.has(key)) {
        if (userId) {
          userUpdate[key] = (val as string | null | undefined) ?? null
        }
        continue
      }
      globalFields[key] = val
    }

    const incomingPrefs =
      globalFields.preferences && typeof globalFields.preferences === 'object'
        ? (globalFields.preferences as Partial<Preferences>)
        : undefined

    if (incomingPrefs) {
      globalFields.preferences = mergePreferenceUpdate(storedSettings?.preferences, incomingPrefs)
    }

    if (!isAdmin && Object.keys(globalFields).length > 0) {
      return c.json({ error: 'Admin access required to modify global settings' }, 403)
    }

    if (typeof globalFields.aiBaseUrl === 'string' && globalFields.aiBaseUrl.length > 0) {
      // The admin may patch aiProvider in the same request, or rely on the existing stored
      // provider. Use the incoming provider when present so the validation matches the
      // post-save state, otherwise fall back to what's persisted.
      const provider =
        typeof globalFields.aiProvider === 'string' && globalFields.aiProvider.length > 0
          ? globalFields.aiProvider
          : ((await deps.getSettings())?.aiProvider ?? '')
      const validation = await validateAiBaseUrl(
        globalFields.aiBaseUrl,
        provider as string,
        'AI base URL',
      )
      if (!validation.ok) {
        return problem(c, 'invalid-base-url', 'Invalid AI base URL', 400, validation.message)
      }
    }

    if (userId && Object.keys(userUpdate).length > 0) {
      await updateUserConnections(deps.db, userId, userUpdate)
    }

    if (Object.keys(globalFields).length > 0) {
      await deps.updateSettings(globalFields)
    }

    if (
      incomingPrefs?.scheduleCron !== undefined &&
      typeof incomingPrefs.scheduleCron === 'string'
    ) {
      try {
        deps.restartScheduler(incomingPrefs.scheduleCron || null)
      } catch (err: unknown) {
        console.error('Failed to apply cron expression:', err)
        const row = await buildSettingsResponse(deps, userId, isAdmin)
        return c.json({
          ...maskSecrets((row ?? {}) as Record<string, unknown>),
          warning: 'Settings saved but cron expression is invalid',
        })
      }
    }

    if (
      incomingPrefs?.playlistEnabled !== undefined ||
      incomingPrefs?.playlistSchedule !== undefined
    ) {
      await deps.restartPlaylistScheduler()
    }

    if (typeof sanitized.librarySyncIntervalHours === 'number') {
      deps.restartLibraryMaintenanceScheduler?.(sanitized.librarySyncIntervalHours)
    }

    const response = await buildSettingsResponse(deps, userId, isAdmin)
    if (!response) {
      return c.json({ error: 'Settings not found' }, 404)
    }
    return c.json(maskSecrets(response))
  })

  router.post('/api/v1/settings/test/:service', async (c) => {
    const messages = resolveRequestMessages({
      requestLocale: c.req.header('X-Digarr-Locale'),
      acceptLanguage: c.req.header('Accept-Language'),
    })
    const service = c.req.param('service')
    const isAdmin = await resolveAdmin(
      c.get('userId'),
      deps.getUserById,
      c.get('authSkipped'),
      c.get('legacyTokenAuth'),
    )
    if (!isAdmin) {
      return problem(
        c,
        'admin-required',
        'Admin access required',
        403,
        undefined,
        undefined,
        'common.adminAccessRequired',
      )
    }

    const body = await c.req.json()
    const testUserId = c.get('userId')

    // Fall back to stored credentials when the request sends empty keys
    const stored = await deps.getSettings()
    const userConns = testUserId ? await getUserConnections(deps.db, testUserId) : null

    const missingInput = (message: string) =>
      problem(c, 'probe-missing-input', 'Missing probe input', 400, message)

    switch (service) {
      case 'lidarr': {
        const url = body.url || (stored?.lidarrUrl as string) || ''
        const apiKey = body.apiKey || (stored?.lidarrApiKey as string) || ''
        if (!url || !apiKey) {
          return missingInput(`Missing ${!url ? 'URL' : 'API key'}`)
        }
        const client = createLidarrClient(url, apiKey, body.skipTlsVerify)
        return runProbe(c, () => client.testConnection(), messages['common.unknownError'])
      }
      case 'listenbrainz': {
        const username = body.username || userConns?.listenbrainzUsername || ''
        const token = body.token || userConns?.listenbrainzToken || ''
        if (!username) {
          return missingInput('Missing username')
        }
        const client = createListenBrainzClient(username, token)
        return runProbe(
          c,
          async () => {
            const result = await client.testConnection()
            if (result.success && !token) {
              result.message +=
                ' (warning: no API token set - listening data, subscriptions, and recommendations will not work without it)'
            }
            return result
          },
          messages['common.unknownError'],
        )
      }
      case 'lastfm': {
        const username = body.username || userConns?.lastfmUsername || ''
        const apiKey = body.apiKey || userConns?.lastfmApiKey || ''
        if (!username || !apiKey) {
          return missingInput(`Missing ${!username ? 'username' : 'API key'}`)
        }
        const client = createLastFmClient(username, apiKey)
        return runProbe(c, () => client.testConnection(), messages['common.unknownError'])
      }
      case 'ai': {
        try {
          // Admin check above gates the stored-apiKey fallback: legacy tokens
          // and non-admin sessions cannot reach this branch, so we will never
          // leak a stored credential to a lower-privilege caller.
          const effectiveProvider = body.provider || (stored?.aiProvider as string) || ''
          const effectiveBaseUrl = body.baseUrl || (stored?.aiBaseUrl as string) || ''
          if (effectiveBaseUrl) {
            const validation = await validateAiBaseUrl(
              effectiveBaseUrl,
              effectiveProvider,
              'AI base URL',
            )
            if (!validation.ok) {
              return problem(c, 'invalid-base-url', 'Invalid AI base URL', 400, validation.message)
            }
          }
          const provider = await deps.providerRegistry.create(effectiveProvider, {
            apiKey: body.apiKey || (stored?.aiApiKey as string) || null,
            model: body.model || (stored?.aiModel as string) || '',
            baseUrl: effectiveBaseUrl || null,
            timeoutSeconds: envConfig.aiTimeoutSeconds ?? null,
          })
          return runProbe(c, () => provider.testConnection(), messages['common.unknownError'])
        } catch (_err: unknown) {
          return problem(
            c,
            'probe-failed',
            'Probe failed',
            502,
            messages['common.unknownError'],
            undefined,
            'common.unknownError',
          )
        }
      }
      case 'plex': {
        const url = body.url || userConns?.plexUrl || ''
        const token = body.token || userConns?.plexToken || ''
        if (!url || !token) {
          return missingInput(`Missing ${!url ? 'URL' : 'token'}`)
        }
        const { createPlexClient } = await import('@/core/clients/plex')
        const client = createPlexClient(url, token)
        return runProbe(c, () => client.testConnection(), messages['common.unknownError'])
      }
      case 'jellyfin': {
        const url = body.url || userConns?.jellyfinUrl || ''
        const apiKey = body.apiKey || userConns?.jellyfinApiKey || ''
        const jfUserId = body.userId || userConns?.jellyfinUserId || ''
        if (!url || !apiKey) {
          return missingInput(`Missing ${!url ? 'URL' : 'API key'}`)
        }
        const { createJellyfinClient } = await import('@/core/clients/jellyfin')
        const skipTls = body.skipTlsVerify ?? (stored?.skipTlsVerify as boolean) ?? false
        const client = createJellyfinClient(url, apiKey, jfUserId, { skipTlsVerify: skipTls })
        return runProbe(
          c,
          async () => {
            const result = await client.testConnection()
            if (result.success && !jfUserId) {
              result.message +=
                ' (warning: no user ID set - listening data will not work without it)'
            }
            return result
          },
          messages['common.unknownError'],
        )
      }
      case 'emby': {
        const url = body.url || userConns?.embyUrl || ''
        const apiKey = body.apiKey || userConns?.embyApiKey || ''
        const embyUserId = body.userId || userConns?.embyUserId || ''
        if (!url || !apiKey) {
          return missingInput(`Missing ${!url ? 'URL' : 'API key'}`)
        }
        const { createEmbyClient } = await import('@/core/clients/emby')
        const skipTls = body.skipTlsVerify ?? (stored?.skipTlsVerify as boolean) ?? false
        const client = createEmbyClient(url, apiKey, embyUserId, { skipTlsVerify: skipTls })
        return runProbe(
          c,
          async () => {
            const result = await client.testConnection()
            if (result.success && !embyUserId) {
              result.message +=
                ' (warning: no user ID set - listening data will not work without it)'
            }
            return result
          },
          messages['common.unknownError'],
        )
      }
      case 'discogs': {
        const token = body.token || userConns?.discogsToken || ''
        const username = body.username || userConns?.discogsUsername || ''
        if (!token || !username) {
          return missingInput(`Missing ${!username ? 'username' : 'personal access token'}`)
        }
        const { createDiscogsClient } = await import('@/core/clients/discogs')
        const client = createDiscogsClient(token, username)
        return runProbe(c, () => client.testConnection(), messages['common.unknownError'])
      }
      case 'spotify': {
        const spotifyUserId = c.get('userId')
        if (!spotifyUserId) return missingInput('Login required')
        const { getOAuthToken } = await import('@/db/queries/oauth-tokens')
        const oauthToken = await getOAuthToken(deps.db, spotifyUserId, 'spotify')
        if (!oauthToken || oauthToken.accessToken.startsWith('pending:')) {
          return missingInput('Spotify not connected')
        }
        const { createSpotifyClient } = await import('@/core/clients/spotify')
        const client = createSpotifyClient(oauthToken.accessToken)
        return runProbe(c, () => client.testConnection(), messages['common.unknownError'])
      }
      case 'oidc': {
        const issuerUrl = body.issuerUrl || (stored?.oidcIssuerUrl as string) || ''
        const clientId = body.clientId || (stored?.oidcClientId as string) || ''
        const clientSecret = body.clientSecret || (stored?.oidcClientSecret as string) || ''
        if (!issuerUrl || !clientId) {
          return missingInput('Issuer URL and Client ID are required')
        }
        const { OidcService } = await import('@/core/auth/oidc')
        const svc = new OidcService({
          issuerUrl,
          clientId,
          clientSecret: clientSecret || undefined,
          scopes: 'openid',
        })
        return runProbe(c, () => svc.testConnection(), messages['common.unknownError'])
      }
      default:
        return problem(c, 'unknown-service', `Unknown service: ${service}`, 400)
    }
  })

  // Test webhook by sending a test payload to the configured URL
  router.post('/api/v1/settings/test-webhook', async (c) => {
    const userId = c.get('userId')
    if (
      !(await resolveAdmin(
        userId,
        deps.getUserById,
        c.get('authSkipped'),
        c.get('legacyTokenAuth'),
      ))
    ) {
      return problem(
        c,
        'admin-required',
        'Admin access required',
        403,
        undefined,
        undefined,
        'common.adminAccessRequired',
      )
    }

    const stored = await deps.getSettings()
    const prefs = stored?.preferences
    const url = prefs?.webhookUrl
    if (!url) {
      return problem(
        c,
        'webhook-not-configured',
        'No webhook URL configured',
        400,
        undefined,
        undefined,
        'common.unknownError',
      )
    }
    try {
      await sendWebhook(url, {
        event: 'batch_complete',
        batchId: 0,
        stats: { discovered: 3, added: 3, failed: 0 },
        message: 'Test notification from digarr.',
        timestamp: new Date().toISOString(),
      })
      return c.body(null, 204)
    } catch (err: unknown) {
      return problem(
        c,
        'webhook-test-failed',
        'Webhook test failed',
        502,
        logAndSanitize(err, 'webhook-test'),
        undefined,
        'common.unknownError',
      )
    }
  })

  return router
}
