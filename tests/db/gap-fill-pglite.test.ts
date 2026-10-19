// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import { getArtistsForGapFill } from '@/db/queries/gap-fill'
import * as schema from '@/db/schema'

const VARIOUS_ARTISTS = '89ad4ac3-39f7-470e-963a-56509c546377'
const NORMAL = '5b11f4ce-a62d-471e-81fc-a69a8278c7da'

let db: ReturnType<typeof drizzle<typeof schema>>

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
})

describe('getArtistsForGapFill on a real Postgres engine', () => {
  it('excludes special-purpose MBIDs without applying text functions to the uuid column', async () => {
    await db.insert(schema.libraryArtists).values([
      {
        source: 'lidarr',
        sourceArtistId: '1',
        name: 'Various Artists',
        nameNormalized: 'various artists',
        mbid: VARIOUS_ARTISTS,
      },
      {
        source: 'lidarr',
        sourceArtistId: '2',
        name: 'Nirvana',
        nameNormalized: 'nirvana',
        mbid: NORMAL,
      },
    ])

    const rows = await getArtistsForGapFill(db as never, 1, 10)

    expect(rows.map((r) => r.mbid)).toEqual([NORMAL])
  })
})
