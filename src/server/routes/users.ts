import { Hono } from 'hono'
import { hashPassword } from '@/core/auth'
import type { AppDependencies } from '@/server'
import { readPagination } from '@/server/helpers/pagination'
import { encodeCursor } from '@/server/helpers/pagination-cursor'
import { requireAdmin as requireAdminShared } from '@/server/helpers/require-user'
import { createUserSchema, updateUserSchema, userIdParamSchema } from '@/server/schemas/users'
import { zJson, zParam } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

export function userRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  /** Check if removing admin from targetId would leave zero admins. */
  async function isLastAdmin(targetId: number): Promise<boolean> {
    const all = await deps.listUsers()
    const otherAdmins = all.filter((u) => u.isAdmin && u.id !== targetId)
    return otherAdmins.length === 0
  }

  const requireAdmin = (c: Parameters<typeof requireAdminShared>[0]) =>
    requireAdminShared(c, deps.getUserById)

  // GET /api/v1/users - list all users (admin only)
  router.get('/api/v1/users', async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response

    const page = readPagination(c)
    if (page === null) {
      const userList = await deps.listUsers()
      return c.json(userList)
    }
    const rows = await deps.listUsers({ limit: page.limit + 1, cursor: page.cursor })
    const hasMore = rows.length > page.limit
    const data = hasMore ? rows.slice(0, page.limit) : rows
    const last = data[data.length - 1]
    const nextCursor =
      hasMore && last ? encodeCursor({ id: last.id, ts: last.createdAt.toISOString() }) : null
    return c.json({ data, meta: { limit: page.limit, nextCursor } })
  })

  // POST /api/v1/users - create a new user (admin only)
  router.post('/api/v1/users', zJson(createUserSchema), async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response

    const { username, password, isAdmin } = c.req.valid('json')

    const existing = await deps.getUserByUsername(username)
    if (existing) {
      return c.json({ error: 'Username already taken' }, 409)
    }

    const passwordHash = hashPassword(password)
    const user = await deps.createUser({ username, passwordHash, isAdmin })
    return c.json(user, 201)
  })

  // PATCH /api/v1/users/:id - update user (admin only)
  // Body: { isAdmin?: boolean }
  // Guards: can't remove own admin role, can't remove last admin
  router.patch(
    '/api/v1/users/:id',
    zParam(userIdParamSchema),
    zJson(updateUserSchema),
    async (c) => {
      const auth = await requireAdmin(c)
      if (!auth.ok) return auth.response
      const caller = await deps.getUserById(auth.userId)
      if (!caller) return c.json({ error: 'Admin access required' }, 403)

      const { id: targetId } = c.req.valid('param')
      const body = c.req.valid('json')

      // Guard: admin cannot remove their own admin role
      if (body.isAdmin === false && caller.id === targetId) {
        return c.json({ error: 'Cannot remove your own admin role' }, 400)
      }

      const target = await deps.getUserById(targetId)
      if (!target) return c.json({ error: 'User not found' }, 404)

      // Guard: can't remove admin from last admin user
      if (body.isAdmin === false && target.isAdmin && (await isLastAdmin(targetId))) {
        return c.json({ error: 'Cannot remove admin from the last admin user' }, 400)
      }

      await deps.updateUser(
        targetId,
        typeof body.isAdmin === 'boolean' ? { isAdmin: body.isAdmin } : {},
      )
      return c.body(null, 204)
    },
  )

  // DELETE /api/v1/users/:id - delete user (admin only)
  // Guards: can't delete self, can't delete last admin
  router.delete('/api/v1/users/:id', zParam(userIdParamSchema), async (c) => {
    const auth = await requireAdmin(c)
    if (!auth.ok) return auth.response
    const caller = await deps.getUserById(auth.userId)
    if (!caller) return c.json({ error: 'Admin access required' }, 403)

    const { id: targetId } = c.req.valid('param')

    if (caller.id === targetId) {
      return c.json({ error: 'Cannot delete your own account' }, 400)
    }

    const target = await deps.getUserById(targetId)
    if (!target) return c.json({ error: 'User not found' }, 404)

    // Guard: can't delete the last admin
    if (target.isAdmin && (await isLastAdmin(targetId))) {
      return c.json({ error: 'Cannot delete the last admin user' }, 400)
    }

    await deps.deleteUser(targetId)
    return c.body(null, 204)
  })

  return router
}
