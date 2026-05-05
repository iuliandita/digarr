import type { Context } from 'hono'
import {
  adminRequired,
  notAuthenticated,
  sessionAuthRequired,
} from '@/server/helpers/auth-problems'
import { resolveAdmin } from '@/server/middleware/admin-guard'
import type { HonoEnv } from '@/server/types'

// Shared session/admin gate helpers. Every route file was re-implementing the
// same three gates with tiny drift; centralising here keeps the error copy
// and legacy-token handling consistent across the API.

type GetUserById = (id: number) => Promise<{ isAdmin: boolean } | null>

export type RequireUserResult = { ok: true; userId: number } | { ok: false; response: Response }

/** Caller is authenticated (session OR legacy token). Does not enforce session-only. */
export function requireUser(c: Context<HonoEnv>): RequireUserResult {
  const userId = c.get('userId')
  if (!userId) {
    return { ok: false, response: notAuthenticated(c) }
  }
  return { ok: true, userId }
}

/** Caller is authenticated by a real session. Rejects legacy-token auth (userId=1). */
export function requireSessionUser(c: Context<HonoEnv>): RequireUserResult {
  const auth = requireUser(c)
  if (!auth.ok) return auth
  if (c.get('legacyTokenAuth')) {
    return { ok: false, response: sessionAuthRequired(c) }
  }
  return auth
}

/** Caller is an admin. Honours authSkipped (fresh install) and rejects legacy tokens. */
export async function requireAdmin(
  c: Context<HonoEnv>,
  getUserById: GetUserById,
): Promise<RequireUserResult> {
  if (c.get('authSkipped')) {
    return { ok: true, userId: c.get('userId') ?? 0 }
  }
  const auth = requireUser(c)
  if (!auth.ok) return auth
  const isAdmin = await resolveAdmin(auth.userId, getUserById, false, c.get('legacyTokenAuth'))
  if (!isAdmin) {
    return { ok: false, response: adminRequired(c) }
  }
  return auth
}
