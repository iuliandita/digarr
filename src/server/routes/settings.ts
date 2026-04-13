import { lookup } from 'node:dns/promises'
import { Hono } from 'hono'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { isPrivateIp, isPrivateUrl, sendWebhook } from '@/core/notifications'
import { errMsg, isHttpUrl } from '@/core/validation'
import { getUserConnections, updateUserConnections } from '@/db/queries/users'
import type { Preferences } from '@/db/schema'

function isCloudMetadata(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return hostname === '169.254.169.254' || hostname === 'metadata.google.internal'
  } catch {
    return false
  }
}

import type { AppDependencies } from '@/server'
import { resolveRequestMessages } from '@/server/locale'
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

async function validatePublicServiceUrl(
  url: string,
  label: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isHttpUrl(url)) {
    return { ok: false, message: `${label} must start with http:// or https://` }
  }
  if (isCloudMetadata(url)) {
    return { ok: false, message: 'Cloud metadata endpoints are not allowed' }
  }
  if (isPrivateUrl(url)) {
    return { ok: false, message: `${label} must not point to a private or internal address` }
  }

  try {
    const { address } = await lookup(new URL(url).hostname)
    if (isPrivateIp(address)) {
      return { ok: false, message: `${label} resolves to a private/internal IP` }
    }
  } catch {
    return { ok: false, message: `Could not resolve ${label.toLowerCase()} hostname` }
  }

  return { ok: true }
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

  router.get('/api/settings', async (c) => {
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

  router.patch('/api/settings', async (c) => {
    const body = await c.req.json()
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (key === 'librarySyncIntervalHours') {
        if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 24) {
          return c.json(
            { error: 'librarySyncIntervalHours must be an integer between 1 and 24' },
            400,
          )
        }
      }
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

    if (!isAdmin) {
      for (const [field, label] of [
        ['plexUrl', 'Plex URL'],
        ['jellyfinUrl', 'Jellyfin URL'],
        ['embyUrl', 'Emby URL'],
      ] as const) {
        const url = userUpdate[field]
        if (typeof url === 'string' && url) {
          const validation = await validatePublicServiceUrl(url, label)
          if (!validation.ok) {
            return c.json({ error: validation.message }, 400)
          }
        }
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

  router.post('/api/settings/test/:service', async (c) => {
    const messages = resolveRequestMessages({
      requestLocale: c.req.header('X-Digarr-Locale'),
      acceptLanguage: c.req.header('Accept-Language'),
    })
    const service = c.req.param('service')
    const body = await c.req.json()
    const testUserId = c.get('userId')

    // Admin-only services: lidarr, ai, oidc -- only enforced when user sessions are active
    if (testUserId && (service === 'lidarr' || service === 'ai' || service === 'oidc')) {
      const isAdmin = await resolveAdmin(
        testUserId,
        deps.getUserById,
        c.get('authSkipped'),
        c.get('legacyTokenAuth'),
      )
      if (!isAdmin) {
        return c.json({ success: false, message: messages['common.adminAccessRequired'] }, 403)
      }
    }

    // Fall back to stored credentials when the request sends empty keys
    const stored = await deps.getSettings()
    const userConns = testUserId ? await getUserConnections(deps.db, testUserId) : null

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
        const username = body.username || userConns?.listenbrainzUsername || ''
        const token = body.token || userConns?.listenbrainzToken || ''
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
        const username = body.username || userConns?.lastfmUsername || ''
        const apiKey = body.apiKey || userConns?.lastfmApiKey || ''
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
      case 'emby': {
        const url = body.url || userConns?.embyUrl || ''
        const apiKey = body.apiKey || userConns?.embyApiKey || ''
        const embyUserId = body.userId || userConns?.embyUserId || ''
        if (!url || !apiKey) {
          return c.json({ success: false, message: `Missing ${!url ? 'URL' : 'API key'}` })
        }
        const { createEmbyClient } = await import('@/core/clients/emby')
        const skipTls = body.skipTlsVerify ?? (stored?.skipTlsVerify as boolean) ?? false
        const client = createEmbyClient(url, apiKey, embyUserId, { skipTlsVerify: skipTls })
        const result = await client.testConnection()
        if (result.success && !embyUserId) {
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
        if (issuerUrl) {
          const validation = await validatePublicServiceUrl(issuerUrl, 'OIDC issuer URL')
          if (!validation.ok) {
            return c.json({ success: false, message: validation.message }, 400)
          }
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
    if (
      !(await resolveAdmin(
        userId,
        deps.getUserById,
        c.get('authSkipped'),
        c.get('legacyTokenAuth'),
      ))
    ) {
      return c.json({ success: false, message: 'Admin access required' }, 403)
    }

    const stored = await deps.getSettings()
    const prefs = stored?.preferences
    const url = prefs?.webhookUrl
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
