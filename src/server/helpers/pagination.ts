// Opt-in cursor pagination. Clients that do not send `limit` or `cursor`
// keep receiving the legacy naked-array response; clients that send
// either receive a `{ data, meta }` envelope. This avoids breaking
// existing integrations while letting new callers opt into pagination.

import type { Context } from 'hono'
import { type Cursor, decodeCursor } from '@/server/helpers/pagination-cursor'
import { parseIntClamp } from '@/server/helpers/parse-int-clamp'

export type PaginationParams = {
  limit: number
  cursor: Cursor | null
}

export type Paginated<T> = {
  data: T[]
  meta: {
    limit: number
    nextCursor: string | null
  }
}

/** Returns `{limit, cursor}` when either query param is present, `null` otherwise. */
export function readPagination(
  c: Context,
  opts: { min?: number; max?: number; default?: number } = {},
): PaginationParams | null {
  const rawLimit = c.req.query('limit')
  const rawCursor = c.req.query('cursor')
  if (rawLimit == null && rawCursor == null) return null

  const limit = parseIntClamp(rawLimit ?? null, {
    name: 'limit',
    min: opts.min ?? 1,
    max: opts.max ?? 500,
    default: opts.default ?? 50,
  })
  const cursor = rawCursor ? decodeCursor(rawCursor) : null
  return { limit, cursor }
}
