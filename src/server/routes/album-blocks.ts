import { Hono } from 'hono'
import type { BlockedAlbumRow } from '@/db/queries/album-blocks'
import { problem } from '@/server/helpers/problem'
import type { HonoEnv } from '@/server/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AlbumBlocksRouteDeps = {
  listAlbumBlocks: (userId: number) => Promise<BlockedAlbumRow[]>
  removeAlbumBlock: (params: { userId: number; releaseGroupMbid: string }) => Promise<void>
}

export function albumBlocksRoutes(deps: AlbumBlocksRouteDeps) {
  const router = new Hono<HonoEnv>()

  router.get('/api/v1/album-blocks', async (c) => {
    const userId = c.get('userId')
    if (typeof userId !== 'number') {
      return problem(
        c,
        'unauthorized',
        'Unauthorized',
        401,
        undefined,
        undefined,
        'errors.auth.unauthorized',
      )
    }
    const items = await deps.listAlbumBlocks(userId)
    return c.json({
      items: items.map((item) => ({ ...item, blockedAt: item.blockedAt.toISOString() })),
    })
  })

  router.delete('/api/v1/album-blocks/:releaseGroupMbid', async (c) => {
    const userId = c.get('userId')
    if (typeof userId !== 'number') {
      return problem(
        c,
        'unauthorized',
        'Unauthorized',
        401,
        undefined,
        undefined,
        'errors.auth.unauthorized',
      )
    }
    const releaseGroupMbid = c.req.param('releaseGroupMbid')
    if (!UUID_RE.test(releaseGroupMbid)) {
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
