import { Hono } from 'hono'
import { envConfig } from '@/config/env'
import { generateSessionToken, hashPassword, verifyPassword } from '@/core/auth'
import { clearUserSessions, createSession, deleteSession } from '@/core/sessions'
import { updateUserPreferences } from '@/db/queries/users'
import { mergePreferences, type Preferences } from '@/db/schema'
import type { AppDependencies } from '@/server'
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
])

export function authRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  // Register a new user. First user becomes admin.
  router.post('/api/auth/register', async (c) => {
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

    const body = await c.req.json()
    const { username, password } = body as { username?: string; password?: string }

    if (!username || !password) {
      return c.json({ error: 'Username and password are required' }, 400)
    }
    if (username.length < 2 || username.length > 50) {
      return c.json({ error: 'Username must be 2-50 characters' }, 400)
    }
    if (password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400)
    }

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

  // Login with username + password
  router.post('/api/auth/login', async (c) => {
    const body = await c.req.json()
    const { username, password } = body as { username?: string; password?: string }

    if (!username || !password) {
      return c.json({ error: 'Username and password are required' }, 400)
    }

    const user = await deps.getUserByUsername(username)
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return c.json({ error: 'Invalid credentials' }, 401)
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

  // Change password for the current session user (requires session auth, not legacy token)
  router.post('/api/auth/change-password', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Password change requires a user account' }, 403)
    }

    const body = await c.req.json()
    const { currentPassword, newPassword } = body as {
      currentPassword?: string
      newPassword?: string
    }

    if (!currentPassword || !newPassword) {
      return c.json({ error: 'Current password and new password are required' }, 400)
    }
    if (newPassword.length < 8) {
      return c.json({ error: 'New password must be at least 8 characters' }, 400)
    }

    const user = await deps.getUserById(userId)
    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Need the full row with passwordHash for verification
    const fullUser = await deps.getUserByUsername(user.username)
    if (!fullUser || !verifyPassword(currentPassword, fullUser.passwordHash)) {
      return c.json({ error: 'Current password is incorrect' }, 401)
    }

    const newHash = hashPassword(newPassword)
    await deps.updatePassword(userId, newHash)

    // Invalidate all sessions for this user, then create a fresh one
    await clearUserSessions(userId)
    const newToken = generateSessionToken()
    await createSession(userId, newToken)

    return c.json({ ok: true, token: newToken })
  })

  // Get the authenticated user's merged preferences
  router.get('/api/auth/me/preferences', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Not authenticated' }, 401)
    const user = await deps.getUserById(userId)
    if (!user) return c.json({ error: 'User not found' }, 404)
    const merged = mergePreferences(user.preferences)
    return c.json(merged)
  })

  // Update the authenticated user's preferences (partial merge)
  router.patch('/api/auth/me/preferences', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Not authenticated' }, 401)
    const body = await c.req.json()
    const user = await deps.getUserById(userId)
    if (!user) return c.json({ error: 'User not found' }, 404)
    // Filter to allowed preference keys only
    const filtered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (ALLOWED_PREF_KEYS.has(key)) {
        filtered[key] = value
      }
    }
    // Merge incoming with existing to preserve fields not being updated
    const current = (user.preferences ?? {}) as Record<string, unknown>
    const updated = { ...current, ...filtered }
    await updateUserPreferences(deps.db, userId, updated as Preferences)
    return c.json({ success: true })
  })

  return router
}
