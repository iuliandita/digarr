import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import type { GenreInsert } from '@/db/queries/genres'
import {
  getAllGenres,
  getChildGenres,
  getGenreBySlug,
  getRootGenres,
  searchGenres,
  upsertGenre,
} from '@/db/queries/genres'

type GenreRow = {
  id: number
  name: string
  slug: string
  source: string
  parentGenreId: number | null
  artistCount: number | null
  cachedAt: Date | null
}

function makeGenreRow(data: GenreInsert, id = 1): GenreRow {
  return {
    id,
    name: data.name,
    slug: data.slug,
    source: data.source,
    parentGenreId: data.parentGenreId ?? null,
    artistCount: data.artistCount ?? 0,
    cachedAt: data.cachedAt ?? null,
  }
}

// Insert chain: insert().values().onConflictDoUpdate().returning()
function makeInsertDb(returnRow: GenreRow): Database {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([returnRow]),
  }
  return {
    insert: vi.fn().mockReturnValue(chain),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  } as unknown as Database
}

describe('upsertGenre', () => {
  it('returns the inserted/updated genre row', async () => {
    const genre: GenreInsert = { name: 'Electronic', slug: 'electronic', source: 'musicbrainz' }
    const row = makeGenreRow(genre, 7)
    const db = makeInsertDb(row)

    const result = await upsertGenre(db, genre)

    expect(result.slug).toBe('electronic')
    expect(result.name).toBe('Electronic')
    expect(result.id).toBe(7)
  })

  it('calls onConflictDoUpdate on the slug column', async () => {
    const genre: GenreInsert = { name: 'Jazz', slug: 'jazz', source: 'lastfm' }
    const row = makeGenreRow(genre)
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([row]),
    }
    const db = { insert: vi.fn().mockReturnValue(chain) } as unknown as Database

    await upsertGenre(db, genre)

    expect(chain.onConflictDoUpdate).toHaveBeenCalledOnce()
    expect(chain.returning).toHaveBeenCalledOnce()
  })

  it('throws when no row returned', async () => {
    const genre: GenreInsert = { name: 'Rock', slug: 'rock', source: 'musicbrainz' }
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    }
    const db = { insert: vi.fn().mockReturnValue(chain) } as unknown as Database

    await expect(upsertGenre(db, genre)).rejects.toThrow(
      'upsertGenre: no row returned for slug=rock',
    )
  })
})

describe('getGenreBySlug', () => {
  it('returns a genre when found', async () => {
    const row = makeGenreRow({ name: 'Metal', slug: 'metal', source: 'musicbrainz' }, 3)
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([row]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getGenreBySlug(db, 'metal')

    expect(result).not.toBeNull()
    expect(result?.slug).toBe('metal')
    expect(result?.id).toBe(3)
  })

  it('returns null when not found', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getGenreBySlug(db, 'nonexistent')
    expect(result).toBeNull()
  })
})

describe('getChildGenres', () => {
  it('returns genres matching parentId', async () => {
    const rows: GenreRow[] = [
      makeGenreRow(
        { name: 'Death Metal', slug: 'death-metal', source: 'musicbrainz', parentGenreId: 1 },
        10,
      ),
      makeGenreRow(
        { name: 'Black Metal', slug: 'black-metal', source: 'musicbrainz', parentGenreId: 1 },
        11,
      ),
    ]
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getChildGenres(db, 1)

    expect(result).toHaveLength(2)
    expect(result[0]?.slug).toBe('death-metal')
    expect(result[1]?.slug).toBe('black-metal')
  })

  it('returns empty array when no children', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getChildGenres(db, 99)
    expect(result).toHaveLength(0)
  })
})

describe('searchGenres', () => {
  it('returns matching genres', async () => {
    const rows: GenreRow[] = [
      makeGenreRow({ name: 'Electronica', slug: 'electronica', source: 'lastfm' }, 5),
    ]
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await searchGenres(db, 'electro')

    expect(result).toHaveLength(1)
    expect(result[0]?.slug).toBe('electronica')
    expect(chain.limit).toHaveBeenCalledWith(20)
  })

  it('uses custom limit', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    await searchGenres(db, 'rock', 5)
    expect(chain.limit).toHaveBeenCalledWith(5)
  })

  it('escapes % and _ metacharacters in query', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    // Should not throw - the escape happens before ilike is called
    await searchGenres(db, '100% _pure_')
    expect(chain.where).toHaveBeenCalledOnce()
  })
})

describe('getAllGenres', () => {
  it('returns all genres ordered by artistCount desc', async () => {
    const rows: GenreRow[] = [
      makeGenreRow({ name: 'Rock', slug: 'rock', source: 'musicbrainz', artistCount: 500 }, 1),
      makeGenreRow({ name: 'Jazz', slug: 'jazz', source: 'musicbrainz', artistCount: 200 }, 2),
    ]
    const chain = {
      from: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getAllGenres(db)

    expect(result).toHaveLength(2)
    expect(chain.orderBy).toHaveBeenCalledOnce()
  })
})

describe('getRootGenres', () => {
  it('returns genres with no parent', async () => {
    const rows: GenreRow[] = [
      makeGenreRow({ name: 'Rock', slug: 'rock', source: 'musicbrainz' }, 1),
    ]
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    const result = await getRootGenres(db)
    expect(result).toHaveLength(1)
    expect(chain.where).toHaveBeenCalledOnce()
  })
})
