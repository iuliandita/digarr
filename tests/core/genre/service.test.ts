// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { GenreService } from '@/core/genre/service'
import type { GenreInfo } from '@/core/genre/types'

function makeGenre(overrides: Partial<GenreInfo> = {}): GenreInfo {
  return {
    id: 1,
    name: 'Rock',
    slug: 'rock',
    source: 'library',
    parentGenreId: null,
    artistCount: 5,
    cachedAt: new Date(),
    ...overrides,
  }
}

function makeQueries() {
  return {
    upsertGenre: vi
      .fn()
      .mockImplementation(async (data) => makeGenre({ name: data.name, slug: data.slug })),
    getGenreBySlug: vi.fn().mockResolvedValue(makeGenre()),
    getChildGenres: vi.fn().mockResolvedValue([]),
    searchGenres: vi.fn().mockResolvedValue([]),
    getAllGenres: vi.fn().mockResolvedValue([]),
  }
}

describe('GenreService', () => {
  describe('slugify()', () => {
    it("converts 'Drum and Bass' to 'drum-and-bass'", () => {
      const svc = new GenreService({ genreQueries: makeQueries() })
      expect(svc.slugify('Drum and Bass')).toBe('drum-and-bass')
    })

    it("converts 'Post-Punk' to 'post-punk'", () => {
      const svc = new GenreService({ genreQueries: makeQueries() })
      expect(svc.slugify('Post-Punk')).toBe('post-punk')
    })

    it("strips '&' - 'R&B' becomes 'rb'", () => {
      const svc = new GenreService({ genreQueries: makeQueries() })
      expect(svc.slugify('R&B')).toBe('rb')
    })

    it('collapses multiple dashes', () => {
      const svc = new GenreService({ genreQueries: makeQueries() })
      expect(svc.slugify('A  B')).toBe('a-b')
    })
  })

  describe('isStale()', () => {
    it('returns true when cachedAt is null', () => {
      const svc = new GenreService({ genreQueries: makeQueries() })
      expect(svc.isStale({ cachedAt: null })).toBe(true)
    })

    it('returns true when cachedAt is 8 days ago', () => {
      const svc = new GenreService({ genreQueries: makeQueries() })
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
      expect(svc.isStale({ cachedAt: eightDaysAgo })).toBe(true)
    })

    it('returns false when cachedAt is now', () => {
      const svc = new GenreService({ genreQueries: makeQueries() })
      expect(svc.isStale({ cachedAt: new Date() })).toBe(false)
    })
  })

  describe('seedFromLibrary()', () => {
    it('upserts all unique genres with correct counts', async () => {
      const queries = makeQueries()
      const svc = new GenreService({ genreQueries: queries })

      await svc.seedFromLibrary([
        { genres: ['rock', 'indie'] },
        { genres: ['rock', 'alternative'] },
      ])

      expect(queries.upsertGenre).toHaveBeenCalledTimes(3)
      expect(queries.upsertGenre).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'rock', slug: 'rock', artistCount: 2, source: 'library' }),
      )
      expect(queries.upsertGenre).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'indie',
          slug: 'indie',
          artistCount: 1,
          source: 'library',
        }),
      )
      expect(queries.upsertGenre).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'alternative',
          slug: 'alternative',
          artistCount: 1,
          source: 'library',
        }),
      )
    })

    it('skips genres that slugify to empty string', async () => {
      const queries = makeQueries()
      const svc = new GenreService({ genreQueries: queries })

      await svc.seedFromLibrary([{ genres: ['&&&', 'rock'] }])

      expect(queries.upsertGenre).toHaveBeenCalledTimes(1)
      expect(queries.upsertGenre).toHaveBeenCalledWith(expect.objectContaining({ name: 'rock' }))
    })

    it('handles empty artist list without errors', async () => {
      const queries = makeQueries()
      const svc = new GenreService({ genreQueries: queries })

      await expect(svc.seedFromLibrary([])).resolves.toBeUndefined()
      expect(queries.upsertGenre).not.toHaveBeenCalled()
    })
  })

  describe('getOrFetchGenre()', () => {
    it('returns the cached genre from queries', async () => {
      const genre = makeGenre({ slug: 'metal', name: 'Metal' })
      const queries = makeQueries()
      queries.getGenreBySlug.mockResolvedValue(genre)
      const svc = new GenreService({ genreQueries: queries })

      const result = await svc.getOrFetchGenre('metal')

      expect(queries.getGenreBySlug).toHaveBeenCalledWith('metal')
      expect(result).toEqual(genre)
    })

    it('returns null when genre is not found', async () => {
      const queries = makeQueries()
      queries.getGenreBySlug.mockResolvedValue(null)
      const svc = new GenreService({ genreQueries: queries })

      const result = await svc.getOrFetchGenre('unknown')
      expect(result).toBeNull()
    })
  })

  describe('search()', () => {
    it('delegates to genreQueries.searchGenres with query and limit', async () => {
      const genres = [makeGenre(), makeGenre({ id: 2, name: 'Rockabilly', slug: 'rockabilly' })]
      const queries = makeQueries()
      queries.searchGenres.mockResolvedValue(genres)
      const svc = new GenreService({ genreQueries: queries })

      const result = await svc.search('rock', 10)

      expect(queries.searchGenres).toHaveBeenCalledWith('rock', 10)
      expect(result).toEqual(genres)
    })

    it('passes undefined limit when not provided', async () => {
      const queries = makeQueries()
      const svc = new GenreService({ genreQueries: queries })

      await svc.search('jazz')

      expect(queries.searchGenres).toHaveBeenCalledWith('jazz', undefined)
    })
  })

  describe('getSubGenres()', () => {
    it('delegates to genreQueries.getChildGenres', async () => {
      const children = [makeGenre({ id: 2, parentGenreId: 1 })]
      const queries = makeQueries()
      queries.getChildGenres.mockResolvedValue(children)
      const svc = new GenreService({ genreQueries: queries })

      const result = await svc.getSubGenres(1)

      expect(queries.getChildGenres).toHaveBeenCalledWith(1)
      expect(result).toEqual(children)
    })
  })

  describe('getLibraryGenres()', () => {
    it('delegates to genreQueries.getAllGenres', async () => {
      const all = [makeGenre(), makeGenre({ id: 2, name: 'Jazz', slug: 'jazz' })]
      const queries = makeQueries()
      queries.getAllGenres.mockResolvedValue(all)
      const svc = new GenreService({ genreQueries: queries })

      const result = await svc.getLibraryGenres()

      expect(queries.getAllGenres).toHaveBeenCalledOnce()
      expect(result).toEqual(all)
    })
  })
})
