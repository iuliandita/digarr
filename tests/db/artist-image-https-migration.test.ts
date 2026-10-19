// @vitest-environment node
import { readFileSync } from 'node:fs'
import { asc, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { artists } from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
const statements = readFileSync('drizzle/0061_artist_image_https.sql', 'utf8').split(
  '--> statement-breakpoint',
)
const migrate = async (db: { execute: (q: ReturnType<typeof sql.raw>) => Promise<unknown> }) => {
  for (const statement of statements) await db.execute(sql.raw(statement))
}

describe('artist image https migration', () => {
  it('upgrades known hosts, leaves other URLs alone, and is safe to re-run', async () => {
    const { db, close } = await makeTestDb()
    try {
      await db.insert(artists).values([
        {
          name: 'A',
          mbid: '00000000-0000-4000-8000-00000000000a',
          imageUrl: 'http://assets.fanart.tv/fanart/a.jpg',
          logoUrl: 'http://assets.fanart.tv/fanart/a.png',
        },
        {
          name: 'B',
          mbid: '00000000-0000-4000-8000-00000000000b',
          imageUrl: 'http://r2.theaudiodb.com/images/b.jpg',
        },
        {
          name: 'C',
          mbid: '00000000-0000-4000-8000-00000000000c',
          imageUrl: 'http://nas.local/c.jpg',
        },
        {
          name: 'D',
          mbid: '00000000-0000-4000-8000-00000000000d',
          imageUrl: 'https://assets.fanart.tv/d.jpg',
        },
        { name: 'E', mbid: '00000000-0000-4000-8000-00000000000e' },
      ])

      await migrate(db)
      await migrate(db)

      const rows = await db
        .select({ name: artists.name, imageUrl: artists.imageUrl, logoUrl: artists.logoUrl })
        .from(artists)
        .orderBy(asc(artists.name))
      expect(rows).toEqual([
        {
          name: 'A',
          imageUrl: 'https://assets.fanart.tv/fanart/a.jpg',
          logoUrl: 'https://assets.fanart.tv/fanart/a.png',
        },
        { name: 'B', imageUrl: 'https://r2.theaudiodb.com/images/b.jpg', logoUrl: null },
        { name: 'C', imageUrl: 'http://nas.local/c.jpg', logoUrl: null },
        { name: 'D', imageUrl: 'https://assets.fanart.tv/d.jpg', logoUrl: null },
        { name: 'E', imageUrl: null, logoUrl: null },
      ])
    } finally {
      await close()
    }
  })
})
