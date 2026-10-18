import { Hono } from 'hono'
import {
  encryptChannelSecrets,
  maskChannelSecrets,
  restoreMaskedChannelSecrets,
} from '@/core/crypto'
import { updateUserNotificationChannels } from '@/db/queries/users'
import type { AppDependencies } from '@/server'
import { requireSessionUser } from '@/server/helpers/require-user'
import { userNotificationChannelsSchema } from '@/server/schemas/user-notifications'
import { zJson } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

export function userNotificationRoutes(deps: Pick<AppDependencies, 'db' | 'getUserById'>) {
  const router = new Hono<HonoEnv>()
  router.get('/api/v1/auth/me/notification-channels', async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response
    const user = await deps.getUserById(auth.userId)
    if (!user) return c.json({ error: 'User not found' }, 404)
    return c.json({ channels: maskChannelSecrets(user.preferences?.channels ?? []) })
  })
  router.patch(
    '/api/v1/auth/me/notification-channels',
    zJson(userNotificationChannelsSchema),
    async (c) => {
      const auth = requireSessionUser(c)
      if (!auth.ok) return auth.response
      const user = await deps.getUserById(auth.userId)
      if (!user) return c.json({ error: 'User not found' }, 404)
      const stored = new Map(
        (user.preferences?.channels ?? []).map((channel) => [channel.id, channel]),
      )
      const channels = restoreMaskedChannelSecrets(c.req.valid('json').channels, stored)
      await updateUserNotificationChannels(deps.db, auth.userId, encryptChannelSecrets(channels))
      return c.body(null, 204)
    },
  )
  return router
}
