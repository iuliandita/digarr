import { Hono } from 'hono'
import { envConfig } from '@/config/env'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { createTidalClient } from '@/core/clients/tidal'
import {
  decryptChannelSecrets,
  encryptChannelSecrets,
  maskChannelSecrets,
  restoreMaskedChannelSecrets,
} from '@/core/crypto'
import { dispatch } from '@/core/notifications'
import type { NotificationChannel, NotificationEvent } from '@/core/notifications/types'
import { redactSecrets } from '@/core/providers/retry'
import { validateAiBaseUrl } from '@/core/url-safety'
import { getUserConnections, updateUserConnections } from '@/db/queries/users'
import { mergePreferences, type Preferences } from '@/db/schema'
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
  'subsonicPassword',
  'tidalClientSecret',
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

// Returns a problem+json response on probe failure. The upstream failure
// message is surfaced as `detail` (secrets redacted, whitespace collapsed,
// length capped) so admins can act on it - a bare "unknown error" hides the
// provider body that names the missing model or malformed field.
function probeResult(
  c: Parameters<typeof problem>[0],
  result: ProbeTestResult,
  fallbackMessage: string,
  latencyMs?: number,
) {
  if (result.success) {
    const version = result.details?.version
    // Whitelisted structured extras (the media-server library pickers):
    // never spread details wholesale, probes may stash internals there.
    const sectionId = result.details?.sectionId
    const sections = result.details?.sections
    const libraryId = result.details?.libraryId
    const libraries = result.details?.libraries
    return c.json(
      {
        message: result.message,
        ...(typeof version === 'string' && version.length > 0 ? { version } : {}),
        ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
        ...(typeof sectionId === 'string' ? { sectionId } : {}),
        ...(Array.isArray(sections) ? { sections } : {}),
        ...(typeof libraryId === 'string' ? { libraryId } : {}),
        ...(Array.isArray(libraries) ? { libraries } : {}),
      },
      200,
    )
  }
  const detail =
    redactSecrets(result.message ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300) || fallbackMessage
  return problem(c, 'probe-failed', 'Probe failed', 502, detail, undefined, 'common.unknownError')
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

  // Strip webhook URL and notification channels (secret-bearing) from
  // preferences for non-admins - notification config is admin-only.
  if (stripped.preferences && typeof stripped.preferences === 'object') {
    const prefs = { ...(stripped.preferences as Record<string, unknown>) }
    delete prefs.webhookUrl
    delete prefs.channels
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
      response.plexSectionId = userConns.plexSectionId ?? ''
      response._plexScope = 'user'
      response.jellyfinUrl = userConns.jellyfinUrl ?? ''
      response.jellyfinApiKey = userConns.jellyfinApiKey
      response.jellyfinUserId = userConns.jellyfinUserId ?? ''
      response.jellyfinLibraryId = userConns.jellyfinLibraryId ?? ''
      response._jellyfinScope = 'user'
      response.embyUrl = userConns.embyUrl ?? ''
      response.embyApiKey = userConns.embyApiKey
      response.embyUserId = userConns.embyUserId ?? ''
      response.embyLibraryId = userConns.embyLibraryId ?? ''
      response._embyScope = 'user'
      response.discogsUsername = userConns.discogsUsername ?? ''
      response.discogsToken = userConns.discogsToken
      response._discogsScope = 'user'
      response.subsonicUrl = userConns.subsonicUrl ?? ''
      response.subsonicUsername = userConns.subsonicUsername ?? ''
      response.subsonicPassword = userConns.subsonicPassword
      response._subsonicScope = 'user'
    }
  }

  // Notification channel secrets must never leave the server (plaintext OR
  // ciphertext). Mask them in a copied preferences object so the stored row is
  // not mutated. Non-admins already had channels stripped above.
  if (response.preferences && typeof response.preferences === 'object') {
    const prefs = { ...(response.preferences as Record<string, unknown>) }
    if (Array.isArray(prefs.channels)) {
      prefs.channels = maskChannelSecrets(prefs.channels as NotificationChannel[])
      response.preferences = prefs
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
    'tidalClientId',
    'tidalClientSecret',
  ])

  const USER_CONNECTION_FIELDS = new Set([
    'listenbrainzUsername',
    'listenbrainzToken',
    'lastfmUsername',
    'lastfmApiKey',
    'plexUrl',
    'plexToken',
    'plexSectionId',
    'jellyfinUrl',
    'jellyfinApiKey',
    'jellyfinUserId',
    'jellyfinLibraryId',
    'embyUrl',
    'embyApiKey',
    'embyUserId',
    'embyLibraryId',
    'discogsToken',
    'discogsUsername',
    'subsonicUrl',
    'subsonicUsername',
    'subsonicPassword',
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

    // Restore masked channel secrets from the stored (encrypted) channel of the
    // same id, then encrypt any new plaintext secrets before persistence. Keeps
    // channel botToken/token/urls encrypted at rest in the settings row.
    if (incomingPrefs && Array.isArray(incomingPrefs.channels)) {
      const byId = new Map((storedSettings?.preferences?.channels ?? []).map((ch) => [ch.id, ch]))
      const restored = restoreMaskedChannelSecrets(incomingPrefs.channels, byId)
      incomingPrefs.channels = encryptChannelSecrets(restored)
    }

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

    if (incomingPrefs?.digestCron !== undefined) {
      try {
        await deps.restartDigestNotifier?.()
      } catch (err: unknown) {
        console.error('Failed to apply digest cron expression:', err)
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
        // sectionId: '' in the body means "auto-detect" (do not fall back to
        // the stored value, the user is explicitly clearing it in the picker).
        const sectionId =
          typeof body.sectionId === 'string' ? body.sectionId : (userConns?.plexSectionId ?? null)
        if (!url || !token) {
          return missingInput(`Missing ${!url ? 'URL' : 'token'}`)
        }
        const { createPlexClient } = await import('@/core/clients/plex')
        const client = createPlexClient(url, token, { sectionId })
        return runProbe(c, () => client.testConnection(), messages['common.unknownError'])
      }
      case 'jellyfin': {
        const url = body.url || userConns?.jellyfinUrl || ''
        const apiKey = body.apiKey || userConns?.jellyfinApiKey || ''
        const jfUserId = body.userId || userConns?.jellyfinUserId || ''
        // libraryId: '' in the body means "all libraries" (do not fall back to
        // the stored value, the user is explicitly clearing it in the picker).
        const jfLibraryId =
          typeof body.libraryId === 'string'
            ? body.libraryId
            : (userConns?.jellyfinLibraryId ?? null)
        if (!url || !apiKey) {
          return missingInput(`Missing ${!url ? 'URL' : 'API key'}`)
        }
        const { createJellyfinClient } = await import('@/core/clients/jellyfin')
        const skipTls = body.skipTlsVerify ?? (stored?.skipTlsVerify as boolean) ?? false
        const client = createJellyfinClient(url, apiKey, jfUserId, {
          skipTlsVerify: skipTls,
          libraryId: jfLibraryId,
        })
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
        const embyLibraryId =
          typeof body.libraryId === 'string' ? body.libraryId : (userConns?.embyLibraryId ?? null)
        if (!url || !apiKey) {
          return missingInput(`Missing ${!url ? 'URL' : 'API key'}`)
        }
        const { createEmbyClient } = await import('@/core/clients/emby')
        const skipTls = body.skipTlsVerify ?? (stored?.skipTlsVerify as boolean) ?? false
        const client = createEmbyClient(url, apiKey, embyUserId, {
          skipTlsVerify: skipTls,
          libraryId: embyLibraryId,
        })
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
      case 'subsonic': {
        const url = body.url || userConns?.subsonicUrl || ''
        const user = body.username || userConns?.subsonicUsername || ''
        const password = body.password || userConns?.subsonicPassword || ''
        if (!url || !user || !password) {
          return missingInput(`Missing ${!url ? 'URL' : !user ? 'username' : 'password'}`)
        }
        const { createSubsonicClient } = await import('@/core/clients/subsonic')
        const skipTls = body.skipTlsVerify ?? (stored?.skipTlsVerify as boolean) ?? false
        const client = createSubsonicClient(url, user, password, { skipTlsVerify: skipTls })
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
      case 'tidal': {
        const clientId = body.clientId || (stored?.tidalClientId as string) || ''
        const clientSecret = body.clientSecret || (stored?.tidalClientSecret as string) || ''
        if (!clientId || !clientSecret) {
          return missingInput(`Missing ${!clientId ? 'client ID' : 'client secret'}`)
        }
        const client = createTidalClient({ clientId, clientSecret })
        return runProbe(c, () => client.testConnection(), messages['common.unknownError'])
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
    const merged = mergePreferences(stored?.preferences)
    const storedChannels = merged.channels ?? []
    const byId = new Map(storedChannels.map((ch) => [ch.id, ch]))

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const requestedId =
      c.req.query('id') ?? (typeof body.id === 'string' ? (body.id as string) : undefined)

    // Resolve the channel under test: an inline config posted from the editor
    // (may carry '***' placeholders to restore from the stored channel), an
    // explicit id, or the first stored channel as a fallback.
    let resolved: NotificationChannel | undefined
    if (typeof body.type === 'string' && typeof body.id === 'string') {
      const [restored] = restoreMaskedChannelSecrets([body as unknown as NotificationChannel], byId)
      resolved = restored
    } else if (requestedId) {
      resolved = byId.get(requestedId)
    } else {
      resolved = storedChannels[0]
    }

    if (!resolved) {
      return problem(
        c,
        'webhook-not-configured',
        'No notification channel configured',
        400,
        undefined,
        undefined,
        'common.unknownError',
      )
    }

    // Decrypt stored/restored ciphertext (plaintext inline values pass through),
    // then force enabled + batch_complete so a Test button works even on a
    // disabled or not-yet-subscribed channel.
    const [decrypted] = decryptChannelSecrets([resolved])
    const testEvents: NotificationEvent[] = ['batch_complete']
    const channel = { ...decrypted, enabled: true, events: testEvents } as NotificationChannel

    const [result] = await dispatch([channel], 'batch_complete', {
      event: 'batch_complete',
      batchId: 0,
      stats: { discovered: 3, added: 3, failed: 0 },
      message: 'Test notification from digarr.',
      timestamp: new Date().toISOString(),
    })
    if (result?.ok) {
      return c.body(null, 204)
    }
    const detail =
      redactSecrets(result?.error ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300) || 'Notification test failed'
    return problem(
      c,
      'webhook-test-failed',
      'Webhook test failed',
      502,
      detail,
      undefined,
      'common.unknownError',
    )
  })

  return router
}
