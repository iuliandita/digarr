import { Hono } from 'hono'
import * as z from 'zod'
import { REJECTION_REASONS } from '@/core/recommendations/rejection-reasons'
import type { BlockedArtistRow, ListBlocksCursor } from '@/db/queries/artist-blocks'
import { type Cursor, decodeCursor, encodeCursor } from '@/server/helpers/pagination-cursor'
import { parseOptionalClampedInt, parsePositiveIntParam } from '@/server/helpers/parse-int-clamp'
import { problem } from '@/server/helpers/problem'
import { zJson } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

export type ArtistBlocksRouteDeps = {
  listArtistBlocks: (params: {
    userId: number
    limit?: number
    cursor?: ListBlocksCursor | null
    q?: string | null
  }) => Promise<{ items: BlockedArtistRow[]; nextCursor: ListBlocksCursor | null }>
  removeArtistBlock: (params: { userId: number; artistId: number }) => Promise<boolean>
  addArtistBlock: (params: {
    userId: number
    artistId: number
    reason?:
      | 'already_own'
      | 'wrong_style'
      | 'not_interested'
      | 'tried_didnt_like'
      | 'not_right_now'
      | 'other'
      | null
    reasonText?: string | null
  }) => Promise<void>
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ASCII control chars from user-supplied freeform text is the point
const stripControlChars = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, '')

const createBlockSchema = z.object({
  artistId: z.number().int().positive(),
  reason: z.enum(REJECTION_REASONS).nullish(),
  reasonText: z
    .string()
    .transform((s) => stripControlChars(s).trim())
    .pipe(z.string().max(200))
    .nullish(),
})

function cursorToInternal(c: Cursor): ListBlocksCursor {
  return { id: c.id, ts: Date.parse(c.ts) }
}

function cursorFromInternal(c: ListBlocksCursor): Cursor {
  return { id: c.id, ts: new Date(c.ts).toISOString() }
}

export function artistBlocksRoutes(deps: ArtistBlocksRouteDeps) {
  const router = new Hono<HonoEnv>()

  router.get('/api/v1/artist-blocks', async (c) => {
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
    const limit = parseOptionalClampedInt(c.req.query('limit'), { min: 1, max: 200, default: 50 })
    if (limit == null) {
      return problem(
        c,
        'invalid-limit',
        'Invalid limit',
        400,
        undefined,
        undefined,
        'errors.validation.failed',
      )
    }
    const cursorRaw = c.req.query('cursor')
    const q = c.req.query('q') ?? null
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null
    const result = await deps.listArtistBlocks({
      userId,
      limit,
      cursor: cursor ? cursorToInternal(cursor) : null,
      q,
    })
    return c.json({
      items: result.items.map((item) => ({
        ...item,
        blockedAt: item.blockedAt.toISOString(),
      })),
      nextCursor: result.nextCursor ? encodeCursor(cursorFromInternal(result.nextCursor)) : null,
    })
  })

  router.delete('/api/v1/artist-blocks/:artistId', async (c) => {
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
    const artistId = parsePositiveIntParam(c.req.param('artistId'))
    if (artistId == null) {
      return problem(
        c,
        'invalid-id',
        'Invalid artist id',
        400,
        undefined,
        undefined,
        'errors.validation.failed',
      )
    }
    await deps.removeArtistBlock({ userId, artistId })
    return c.body(null, 204)
  })

  router.post('/api/v1/artist-blocks', zJson(createBlockSchema), async (c) => {
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
    const body = c.req.valid('json')
    await deps.addArtistBlock({
      userId,
      artistId: body.artistId,
      reason: body.reason ?? null,
      reasonText: body.reasonText ?? null,
    })
    return c.body(null, 204)
  })

  return router
}
