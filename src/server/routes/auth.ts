import { lookup } from 'node:dns/promises'
import { type Context, Hono } from 'hono'
import { envConfig } from '@/config/env'
import { generateSessionToken, hashPassword, verifyPassword } from '@/core/auth'
import { encryptField } from '@/core/crypto'
import { normalizeLocale } from '@/core/i18n/locales'
import { getMessages } from '@/core/i18n/messages'
import { isPrivateIp, isPrivateUrl } from '@/core/notifications'
import { clearUserSessions, createSession, deleteSession } from '@/core/sessions'
import { isHttpUrl } from '@/core/validation'
import { updateUserPreferences } from '@/db/queries/users'
import { mergePreferences, type Preferences } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { resolveRequestLocale } from '@/server/locale'
import { changePasswordSchema, registerSchema } from '@/server/schemas/auth'
import { zJson } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

const ALLOWED_PREF_KEYS = new Set([
  'scoreThreshold',
  'scoringWeights',
  'rejectionCooldownDays',
  'topArtistsLimit',
  'librarySeedRatio',
  'scheduleCron',
  'webhookUrl',
  'autoApproveEnabled',
  'autoApproveThreshold',
  'autoApproveMonitorOption',
  'dismissedHints',
  'playlistSize',
  'playlistSchedule',
  'playlistEnabled',
  'qualityProfileId',
  'metadataProfileId',
  'rootFolderId',
  'fanartApiKey',
  'metadataFallbackUrl',
])

const SENSITIVE_PREF_KEYS = ['fanartApiKey'] as const

export function authRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  const getRequestMessages = (c: Context<HonoEnv>) =>
    getMessages(
      resolveRequestLocale({
        requestLocale: c.req.header('X-Digarr-Locale'),
        acceptLanguage: c.req.header('Accept-Language'),
      }),
    )

  function requireSessionUser(c: Context<HonoEnv>) {
    const userId = c.get('userId')
    if (!userId) {
      return { ok: false as const, response: c.json({ error: 'Not authenticated' }, 401) }
    }
    if (c.get('legacyTokenAuth')) {
      return {
        ok: false as const,
        response: c.json({ error: 'Session authentication required' }, 403),
      }
    }
    return { ok: true as const, userId }
  }

  // Register a new user. First user becomes admin.
  router.post('/api/auth/register', zJson(registerSchema), async (c) => {
    // Registration closed by default after first user. Set DIGARR_DISABLE_REGISTRATION=false to open.
    const userCount = await deps.getUserCount()
    if (userCount > 0 && envConfig.disableRegistration) {
      return c.json(
        {
          error:
            'Registration is disabled. Set DIGARR_DISABLE_REGISTRATION=false to allow open registration.',
        },
        403,
      )
    }

    const { username, password } = c.req.valid('json')

    const existingUser = await deps.getUserByUsername(username)
    if (existingUser) {
      return c.json({ error: 'Username already taken' }, 409)
    }

    const isAdmin = userCount === 0

    const passwordHash = hashPassword(password)
    const user = await deps.createUser({ username, passwordHash, isAdmin })

    const token = generateSessionToken()
    await createSession(user.id, token)

    return c.json({ user, token }, 201)
  })

  // Login with username + password.
  // Keeps manual validation so the "credentials required" error stays
  // i18n'd via the request-locale messages bundle -- login is the most
  // user-visible error surface and the existing locales cover it.
  router.post('/api/auth/login', async (c) => {
    const messages = getRequestMessages(c)
    const body = (await c.req.json().catch(() => null)) as {
      username?: unknown
      password?: unknown
    } | null
    const username = typeof body?.username === 'string' ? body.username : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!username || !password) {
      return c.json({ error: messages['auth.credentialsRequired'] }, 400)
    }

    const user = await deps.getUserByUsername(username)
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return c.json({ error: messages['auth.invalidCredentials'] }, 401)
    }

    const token = generateSessionToken()
    await createSession(user.id, token)

    const { passwordHash: _, ...publicUser } = user
    return c.json({ user: publicUser, token })
  })

  // Logout (invalidate session token)
  router.post('/api/auth/logout', async (c) => {
    const header = c.req.header('Authorization')
    if (header?.startsWith('Bearer ')) {
      await deleteSession(header.slice(7))
    }
    return c.json({ ok: true })
  })

  // Get current user from session token
  router.get('/api/auth/me', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Not authenticated' }, 401)
    }
    const user = await deps.getUserById(userId)
    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }
    return c.json(user)
  })

  router.get('/api/auth/validate', (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Not authenticated' }, 401)
    }
    return c.body(null, 204)
  })

  router.patch('/api/auth/me/locale', async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response

    const body = await c.req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'preferredLocale must be a string or null' }, 400)
    }

    const { preferredLocale: rawPreferredLocale } = body as { preferredLocale?: unknown }
    if (rawPreferredLocale !== null && typeof rawPreferredLocale !== 'string') {
      return c.json({ error: 'preferredLocale must be a string or null' }, 400)
    }

    const user = await deps.getUserById(auth.userId)
    if (!user) return c.json({ error: 'User not found' }, 404)

    const preferredLocale = rawPreferredLocale === null ? null : normalizeLocale(rawPreferredLocale)

    if (rawPreferredLocale !== null && !preferredLocale) {
      return c.json({ error: 'Unsupported locale' }, 400)
    }

    await deps.updateUserPreferredLocale(auth.userId, preferredLocale)
    return c.json({ success: true, preferredLocale })
  })

  // Change password for the current session user (requires session auth, not legacy token)
  router.post('/api/auth/change-password', zJson(changePasswordSchema), async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response

    const { currentPassword, newPassword } = c.req.valid('json')

    const user = await deps.getUserById(auth.userId)
    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Need the full row with passwordHash for verification
    const fullUser = await deps.getUserByUsername(user.username)
    if (!fullUser || !verifyPassword(currentPassword, fullUser.passwordHash)) {
      return c.json({ error: 'Current password is incorrect' }, 401)
    }

    const newHash = hashPassword(newPassword)
    await deps.updatePassword(auth.userId, newHash)

    // Invalidate all sessions for this user, then create a fresh one
    await clearUserSessions(auth.userId)
    const newToken = generateSessionToken()
    await createSession(auth.userId, newToken)

    return c.json({ ok: true, token: newToken })
  })

  // Get the authenticated user's merged preferences
  router.get('/api/auth/me/preferences', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Not authenticated' }, 401)
    const user = await deps.getUserById(userId)
    if (!user) return c.json({ error: 'User not found' }, 404)
    const merged = mergePreferences(user.preferences)
    // Decrypt sensitive fields, then mask for the response
    const response = { ...merged } as Record<string, unknown>
    for (const key of SENSITIVE_PREF_KEYS) {
      const val = response[key]
      if (typeof val === 'string' && val) {
        response[key] = '***'
      }
    }
    return c.json(response)
  })

  // Update the authenticated user's preferences (partial merge)
  router.patch('/api/auth/me/preferences', async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response
    const body = await c.req.json()
    const user = await deps.getUserById(auth.userId)
    if (!user) return c.json({ error: 'User not found' }, 404)
    // Filter to allowed preference keys only
    const filtered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (ALLOWED_PREF_KEYS.has(key)) {
        filtered[key] = value
      }
    }

    // SSRF protection: validate metadataFallbackUrl against private IP ranges
    const fallbackUrl = filtered.metadataFallbackUrl
    if (typeof fallbackUrl === 'string' && fallbackUrl) {
      if (!isHttpUrl(fallbackUrl)) {
        return c.json({ error: 'Metadata fallback URL must use http:// or https://' }, 400)
      }
      if (isPrivateUrl(fallbackUrl)) {
        return c.json({ error: 'Metadata fallback URL must not point to a private address' }, 400)
      }
      try {
        const hostname = new URL(fallbackUrl).hostname
        const { address } = await lookup(hostname)
        if (isPrivateIp(address)) {
          return c.json({ error: 'Metadata fallback URL resolves to a private/internal IP' }, 400)
        }
      } catch {
        return c.json({ error: 'Could not resolve metadata fallback URL hostname' }, 400)
      }
    }

    // Encrypt sensitive preference values before storage (skip masked placeholders)
    for (const key of SENSITIVE_PREF_KEYS) {
      const val = filtered[key]
      if (val === '***') {
        delete filtered[key]
      } else if (typeof val === 'string' && val) {
        filtered[key] = encryptField(val)
      }
    }

    // Merge incoming with existing to preserve fields not being updated
    const current = (user.preferences ?? {}) as Record<string, unknown>
    const updated = { ...current, ...filtered }
    await updateUserPreferences(deps.db, auth.userId, updated as Preferences)
    return c.json({ success: true })
  })

  return router
}
