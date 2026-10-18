// @vitest-environment node
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { listRecommendations } from '@/db/queries/recommendations'
import {
  approvalRequests,
  artists,
  recommendationBatches,
  recommendations,
  users,
} from '@/db/schema'
import { recommendationRoutes } from '@/server/routes/recommendations'
import type { HonoEnv } from '@/server/types'
import { makeDeps } from '../../helpers/test-app'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
let db: Database
let close: () => Promise<void>
let app: Hono<HonoEnv>

const TAB_STATUS = {
  all: undefined,
  pending: 'pending',
  approved: 'added_to_lidarr,add_failed,approved,waiting',
  rejected: 'rejected',
} as const

beforeAll(async () => {
  const h = await makeTestDb()
  db = h.db as unknown as Database
  close = h.close
  await db.insert(users).values([
    { id: 1, username: 'owner', passwordHash: 'x' },
    { id: 2, username: 'other', passwordHash: 'x' },
  ])
  const [batch] = await db.insert(recommendationBatches).values({}).returning()
  const rows: Array<{ userId: number; status: string; sources?: Record<string, number> }> = [
    { userId: 1, status: 'pending' },
    { userId: 1, status: 'pending' },
    { userId: 1, status: 'pending', sources: { album_request: 0 } },
    { userId: 1, status: 'pending' },
    { userId: 1, status: 'approved' },
    { userId: 1, status: 'add_failed' },
    { userId: 1, status: 'waiting' },
    { userId: 1, status: 'rejected' },
    { userId: 1, status: 'duplicate' },
    { userId: 2, status: 'pending' },
    { userId: 2, status: 'rejected' },
    { userId: 2, status: 'rejected' },
  ]
  const catalog = await db
    .insert(artists)
    .values(
      rows.map((_, i) => ({
        mbid: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
        name: `Artist ${i}`,
      })),
    )
    .returning()
  const inserted = await db
    .insert(recommendations)
    .values(
      rows.map((row, i) => ({
        ...row,
        artistId: catalog[i]?.id ?? 0,
        batchId: batch?.id ?? 0,
        score: 0.5,
      })),
    )
    .returning()
  // A pending row with an open approval request leaves Pending but stays in All.
  await db
    .insert(approvalRequests)
    .values({ recommendationId: inserted[3]?.id, userId: 1, options: {} })

  app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    c.set('userId', Number(c.req.header('X-Test-User')))
    await next()
  })
  app.route('/', recommendationRoutes(makeDeps({ db })))
})
afterAll(async () => close())

describe('GET /api/v1/recommendations/counts', () => {
  it.each([
    [1, { all: 8, pending: 2, approved: 3, rejected: 1 }],
    [2, { all: 3, pending: 1, approved: 0, rejected: 2 }],
  ])('returns only user %i counts, matching each tab list total', async (userId, expected) => {
    const res = await app.request('/api/v1/recommendations/counts', {
      headers: { 'X-Test-User': String(userId) },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(expected)
    for (const [tab, status] of Object.entries(TAB_STATUS)) {
      const { total } = await listRecommendations(db, { userId, status, limit: 1 })
      expect(body[tab]).toBe(total)
    }
  })
})
