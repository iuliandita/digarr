import { createMiddleware } from 'hono/factory'
import type { HonoEnv } from '@/server/types'

type GetUserById = (id: number) => Promise<{ isAdmin: boolean } | null>

/**
 * Middleware that rejects non-admin users with 403.
 * Legacy token auth (no userId) is NOT admin - users should migrate to session auth.
 * authSkipped (fresh installs) is allowed through because the setup guard already
 * blocks non-setup API paths when setup is not complete.
 */
export function adminGuard(getUserById: GetUserById) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    if (c.get('authSkipped')) return next()
    if (c.get('legacyTokenAuth')) return c.json({ error: 'Admin access required' }, 403)
    const uid = c.get('userId')
    if (!uid) return c.json({ error: 'Admin access required' }, 403)
    const u = await getUserById(uid)
    if (!u?.isAdmin) return c.json({ error: 'Admin access required' }, 403)
    await next()
  })
}

/**
 * Inline admin check for routes that need the isAdmin boolean for branching.
 * authSkipped (fresh installs) grants admin because the setup guard already
 * blocks non-setup paths when setup is not complete.
 */
export async function resolveAdmin(
  userId: number | undefined,
  getUserById: GetUserById,
  authSkipped?: boolean,
  legacyTokenAuth?: boolean,
): Promise<boolean> {
  if (authSkipped) return true
  if (legacyTokenAuth) return false
  if (!userId) return false
  const user = await getUserById(userId)
  return user?.isAdmin ?? false
}
