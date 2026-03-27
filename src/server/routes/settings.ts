import { Hono } from 'hono'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { sendWebhook } from '@/core/notifications'
import { errMsg, isHttpUrl } from '@/core/validation'
import { getUserConnections, updateUserConnections } from '@/db/queries/users'

function isCloudMetadata(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return hostname === '169.254.169.254' || hostname === 'metadata.google.internal'
  } catch {
    return false
  }
}

import type { AppDependencies } from '@/server'
import { resolveAdmin } from '@/server/middleware/admin-guard'
import type { HonoEnv } from '@/server/types'

const SECRET_FIELDS = [
  'lidarrApiKey',
  'listenbrainzToken',
  'lastfmApiKey',
  'aiApiKey',
  'oidcClientSecret',
  'plexToken',
  'jellyfinApiKey',
  'discogsToken',
] as const

type SettingsResponse = Record<string, unknown>

function maskSecrets(settings: Record<string, unknown>): SettingsResponse {
  const masked: SettingsResponse = { ...settings }
  for (const field of SECRET_FIELDS) {
    masked[field] = '***'
  }
  return masked
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
      // For non-admins: always set connection fields from user data (even if null)
      // This prevents leaking global/admin credentials
      if (!isAdmin) {
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
        response.discogsUsername = userConns.discogsUsername ?? ''
        response.discogsToken = userConns.discogsToken
        response._discogsScope = 'user'
      } else {
        // Admin: overlay user connections only when the user has set them
        if (userConns.listenbrainzUsername !== null) {
          response.listenbrainzUsername = userConns.listenbrainzUsername
          response.listenbrainzToken = userConns.listenbrainzToken
          response._listenbrainzScope = 'user'
        }
        if (userConns.lastfmUsername !== null) {
          response.lastfmUsername = userConns.lastfmUsername
          response.lastfmApiKey = userConns.lastfmApiKey
          response._lastfmScope = 'user'
        }
        if (userConns.plexUrl !== null) {
          response.plexUrl = userConns.plexUrl
          response.plexToken = userConns.plexToken
          response._plexScope = 'user'
        }
        if (userConns.jellyfinUrl !== null) {
          response.jellyfinUrl = userConns.jellyfinUrl
          response.jellyfinApiKey = userConns.jellyfinApiKey
          response.jellyfinUserId = userConns.jellyfinUserId
          response._jellyfinScope = 'user'
        }
        if (userConns.discogsUsername !== null) {
          response.discogsUsername = userConns.discogsUsername
          response.discogsToken = userConns.discogsToken
          response._discogsScope = 'user'
        }
      }
    }
  }

  return response
}

export function settingsRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.get('/api/settings', async (c) => {
    const userId = c.get('userId')
    const isAdmin = await resolveAdmin(userId, deps.getUserById, c.get('authSkipped'))
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
    'aiProvider',
    'aiApiKey',
    'aiModel',
    'aiBaseUrl',
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
    'discogsToken',
    'discogsUsername',
  ])

  const ALL_MUTABLE_FIELDS = new Set([...GLOBAL_MUTABLE_FIELDS, ...USER_CONNECTION_FIELDS])

  router.patch('/api/settings', async (c) => {
    const body = await c.req.json()
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (ALL_MUTABLE_FIELDS.has(key)) {
        sanitized[key] = value
      }
    }

    const userId = c.get('userId')
    const isAdmin = await resolveAdmin(userId, deps.getUserById, c.get('authSkipped'))

    // Split fields into user-connection vs global
    const userUpdate: Record<string, string | null> = {}
    const globalFields: Record<string, unknown> = {}

    for (const [key, val] of Object.entries(sanitized)) {
      if (userId && USER_CONNECTION_FIELDS.has(key)) {
        userUpdate[key] = (val as string | null | undefined) ?? null
      } else {
        globalFields[key] = val
      }
    }

    if (!isAdmin && Object.keys(globalFields).length > 0) {
      return c.json({ error: 'Admin access required to modify global settings' }, 403)
    }

    if (userId && Object.keys(userUpdate).length > 0) {
      await updateUserConnections(deps.db, userId, userUpdate)
    }

    if (Object.keys(globalFields).length > 0) {
      await deps.updateSettings(globalFields)
    }

    const prefs = globalFields.preferences as Record<string, unknown> | undefined
    if (prefs?.scheduleCron !== undefined && typeof prefs.scheduleCron === 'string') {
      try {
        deps.restartScheduler(prefs.scheduleCron || null)
      } catch (err: unknown) {
        console.error('Failed to apply cron expression:', err)
        const row = await buildSettingsResponse(deps, userId, isAdmin)
        return c.json({
          ...maskSecrets((row ?? {}) as Record<string, unknown>),
          warning: 'Settings saved but cron expression is invalid',
        })
      }
    }

    if (prefs?.playlistEnabled !== undefined || prefs?.playlistSchedule !== undefined) {
      await deps.restartPlaylistScheduler()
    }

    const response = await buildSettingsResponse(deps, userId, isAdmin)
    if (!response) {
      return c.json({ error: 'Settings not found' }, 404)
    }
    return c.json(maskSecrets(response))
  })

  router.post('/api/settings/test/:service', async (c) => {
    const service = c.req.param('service')
    const body = await c.req.json()

    // SSRF mitigation: reject non-HTTP URLs before they reach service clients
    for (const field of ['url', 'baseUrl'] as const) {
      const val = (body as Record<string, unknown>)[field]
      if (typeof val === 'string' && val && !isHttpUrl(val)) {
        return c.json({ success: false, message: 'URL must start with http:// or https://' }, 400)
      }
      if (typeof val === 'string' && val && isCloudMetadata(val)) {
        return c.json({ success: false, message: 'Cloud metadata endpoints are not allowed' }, 400)
      }
    }

    // Fall back to stored credentials when the request sends empty keys
    const stored = await deps.getSettings()
    const testUserId = c.get('userId')
    const userConns = testUserId ? await getUserConnections(deps.db, testUserId) : null

    // Admin-only services: lidarr, ai -- only enforced when user sessions are active
    if (testUserId && (service === 'lidarr' || service === 'ai')) {
      const caller = await deps.getUserById(testUserId)
      if (!caller?.isAdmin) {
        return c.json({ success: false, message: 'Admin access required' }, 403)
      }
    }

    switch (service) {
      case 'lidarr': {
        const url = body.url || (stored?.lidarrUrl as string) || ''
        const apiKey = body.apiKey || (stored?.lidarrApiKey as string) || ''
        if (!url || !apiKey) {
          return c.json({ success: false, message: `Missing ${!url ? 'URL' : 'API key'}` })
        }
        const client = createLidarrClient(url, apiKey, body.skipTlsVerify)
        const result = await client.testConnection()
        return c.json(result)
      }
      case 'listenbrainz': {
        const username =
          body.username ||
          userConns?.listenbrainzUsername ||
          (stored?.listenbrainzUsername as string) ||
          ''
        const token =
          body.token || userConns?.listenbrainzToken || (stored?.listenbrainzToken as string) || ''
        if (!username) {
          return c.json({ success: false, message: 'Missing username' })
        }
        const client = createListenBrainzClient(username, token)
        const result = await client.testConnection()
        if (result.success && !token) {
          result.message +=
            ' (warning: no API token set -- listening data, subscriptions, and recommendations will not work without it)'
        }
        return c.json(result)
      }
      case 'lastfm': {
        const username =
          body.username || userConns?.lastfmUsername || (stored?.lastfmUsername as string) || ''
        const apiKey =
          body.apiKey || userConns?.lastfmApiKey || (stored?.lastfmApiKey as string) || ''
        if (!username || !apiKey) {
          return c.json({
            success: false,
            message: `Missing ${!username ? 'username' : 'API key'}`,
          })
        }
        const client = createLastFmClient(username, apiKey)
        const result = await client.testConnection()
        return c.json(result)
      }
      case 'ai': {
        try {
          const provider = await deps.providerRegistry.create(
            body.provider || (stored?.aiProvider as string) || '',
            {
              apiKey: body.apiKey || (stored?.aiApiKey as string) || null,
              model: body.model || (stored?.aiModel as string) || '',
              baseUrl: body.baseUrl || (stored?.aiBaseUrl as string) || null,
            },
          )
          const result = await provider.testConnection()
          return c.json(result)
        } catch (err: unknown) {
          return c.json({ success: false, message: errMsg(err) })
        }
      }
      case 'plex': {
        const url = body.url || userConns?.plexUrl || ''
        const token = body.token || userConns?.plexToken || ''
        if (!url || !token) {
          return c.json({ success: false, message: `Missing ${!url ? 'URL' : 'token'}` })
        }
        const { createPlexClient } = await import('@/core/clients/plex')
        const client = createPlexClient(url, token)
        const result = await client.testConnection()
        return c.json(result)
      }
      case 'jellyfin': {
        const url = body.url || userConns?.jellyfinUrl || ''
        const apiKey = body.apiKey || userConns?.jellyfinApiKey || ''
        const jfUserId = body.userId || userConns?.jellyfinUserId || ''
        if (!url || !apiKey) {
          return c.json({ success: false, message: `Missing ${!url ? 'URL' : 'API key'}` })
        }
        const { createJellyfinClient } = await import('@/core/clients/jellyfin')
        const skipTls = body.skipTlsVerify ?? (stored?.skipTlsVerify as boolean) ?? false
        const client = createJellyfinClient(url, apiKey, jfUserId, { skipTlsVerify: skipTls })
        const result = await client.testConnection()
        if (result.success && !jfUserId) {
          result.message += ' (warning: no user ID set -- listening data will not work without it)'
        }
        return c.json(result)
      }
      case 'discogs': {
        const token = body.token || userConns?.discogsToken || ''
        const username = body.username || userConns?.discogsUsername || ''
        if (!token || !username) {
          return c.json({
            success: false,
            message: `Missing ${!username ? 'username' : 'personal access token'}`,
          })
        }
        const { createDiscogsClient } = await import('@/core/clients/discogs')
        const client = createDiscogsClient(token, username)
        const result = await client.testConnection()
        return c.json(result)
      }
      case 'spotify': {
        const spotifyUserId = c.get('userId')
        if (!spotifyUserId) return c.json({ success: false, message: 'Login required' })
        const { getOAuthToken } = await import('@/db/queries/oauth-tokens')
        const oauthToken = await getOAuthToken(deps.db, spotifyUserId, 'spotify')
        if (!oauthToken || oauthToken.accessToken.startsWith('pending:')) {
          return c.json({ success: false, message: 'Spotify not connected' })
        }
        const { createSpotifyClient } = await import('@/core/clients/spotify')
        const client = createSpotifyClient(oauthToken.accessToken)
        const result = await client.testConnection()
        return c.json(result)
      }
      case 'oidc': {
        const issuerUrl = body.issuerUrl || (stored?.oidcIssuerUrl as string) || ''
        const clientId = body.clientId || (stored?.oidcClientId as string) || ''
        const clientSecret = body.clientSecret || (stored?.oidcClientSecret as string) || ''
        if (issuerUrl && !isHttpUrl(issuerUrl)) {
          return c.json(
            { success: false, message: 'Issuer URL must start with http:// or https://' },
            400,
          )
        }
        if (issuerUrl && isCloudMetadata(issuerUrl)) {
          return c.json(
            { success: false, message: 'Cloud metadata endpoints are not allowed' },
            400,
          )
        }
        if (!issuerUrl || !clientId) {
          return c.json({ success: false, message: 'Issuer URL and Client ID are required' })
        }
        const { OidcService } = await import('@/core/auth/oidc')
        const svc = new OidcService({
          issuerUrl,
          clientId,
          clientSecret: clientSecret || undefined,
          scopes: 'openid',
        })
        return c.json(await svc.testConnection())
      }
      default:
        return c.json({ error: `Unknown service: ${service}` }, 400)
    }
  })

  // Test webhook by sending a test payload to the configured URL
  router.post('/api/settings/test-webhook', async (c) => {
    const userId = c.get('userId')
    if (!(await resolveAdmin(userId, deps.getUserById, c.get('authSkipped')))) {
      return c.json({ success: false, message: 'Admin access required' }, 403)
    }

    const stored = await deps.getSettings()
    const prefs = stored?.preferences as Record<string, unknown> | undefined
    const url = prefs?.webhookUrl as string | undefined
    if (!url) {
      return c.json({ success: false, message: 'No webhook URL configured' })
    }
    try {
      await sendWebhook(url, {
        event: 'batch_complete',
        batchId: 0,
        stats: { discovered: 3, added: 3, failed: 0 },
        message: 'Test notification from digarr.',
        timestamp: new Date().toISOString(),
      })
      return c.json({ success: true, message: 'Test webhook sent' })
    } catch (err: unknown) {
      return c.json({ success: false, message: errMsg(err) })
    }
  })

  return router
}
