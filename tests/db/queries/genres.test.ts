import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import type { GenreInsert } from '@/db/queries/genres'
import { getGenreBySlug, searchGenres, upsertGenre } from '@/db/queries/genres'

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
