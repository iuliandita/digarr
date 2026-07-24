import { Hono } from 'hono'
import { isValidMbid } from '@/core/validation'
import type { BlockedAlbumRow } from '@/db/queries/album-blocks'
import { problem } from '@/server/helpers/problem'
import { requireUser } from '@/server/helpers/require-user'
import type { HonoEnv } from '@/server/types'

export type AlbumBlocksRouteDeps = {
  listAlbumBlocks: (userId: number) => Promise<BlockedAlbumRow[]>
  removeAlbumBlock: (params: { userId: number; releaseGroupMbid: string }) => Promise<void>
}

export function albumBlocksRoutes(deps: AlbumBlocksRouteDeps) {
  const router = new Hono<HonoEnv>()

  router.get('/api/v1/album-blocks', async (c) => {
    const auth = requireUser(c)
    if (!auth.ok) return auth.response
    const { userId } = auth
    const items = await deps.listAlbumBlocks(userId)
    return c.json({
      items: items.map((item) => ({ ...item, blockedAt: item.blockedAt.toISOString() })),
    })
  })

  router.delete('/api/v1/album-blocks/:releaseGroupMbid', async (c) => {
    const auth = requireUser(c)
    if (!auth.ok) return auth.response
    const { userId } = auth
    const releaseGroupMbid = c.req.param('releaseGroupMbid')
    if (!isValidMbid(releaseGroupMbid)) {
      return problem(
        c,
        'invalid-id',
        'Invalid release group id',
        400,
        undefined,
        undefined,
        'errors.validation.failed',
      )
    }
    await deps.removeAlbumBlock({ userId, releaseGroupMbid })
    return c.body(null, 204)
  })

  return router
}
