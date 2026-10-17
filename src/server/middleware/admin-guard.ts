import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { adminRequired } from '@/server/helpers/auth-problems'
import type { HonoEnv } from '@/server/types'

type GetUserById = (id: number) => Promise<{ isAdmin: boolean } | null>

export function effectiveIsAdmin(c: Context<HonoEnv>, user: { isAdmin: boolean } | null): boolean {
  if (c.get('legacyTokenAuth')) return false
  const scope = c.get('apiTokenScope')
  if (scope && scope !== 'admin') return false
  return user?.isAdmin ?? false
}

/** Fresh installs pass because the setup guard already blocks non-setup API paths. */
export async function resolveAdmin(
  c: Context<HonoEnv>,
  getUserById: GetUserById,
): Promise<boolean> {
  if (c.get('authSkipped')) return true
  const uid = c.get('userId')
  return effectiveIsAdmin(c, uid ? await getUserById(uid) : null)
}

export function adminGuard(getUserById: GetUserById) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    if (!(await resolveAdmin(c, getUserById))) return adminRequired(c)
    await next()
  })
}
