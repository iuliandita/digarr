import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import type { GenreInsert } from '@/db/queries/genres'
import { getGenreBySlug, getRootGenres, searchGenres, upsertGenre } from '@/db/queries/genres'

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

describe('upsertGenre', () => {
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

describe('searchGenres', () => {
  it.each([
    ['default', undefined, 20],
    ['custom', 5, 5],
  ])('applies the %s limit', async (_name, limit, expected) => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    const db = { select: vi.fn().mockReturnValue(chain) } as unknown as Database

    await searchGenres(db, 'rock', limit)
    expect(chain.limit).toHaveBeenCalledWith(expected)
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
