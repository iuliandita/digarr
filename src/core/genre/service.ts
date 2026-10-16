import type { GenreInfo } from './types'

export interface GenreQueries {
  upsertGenre: (data: {
    name: string
    slug: string
    source: string
    parentGenreId?: number | null
    artistCount?: number | null
    cachedAt?: Date | null
  }) => Promise<GenreInfo>
  getGenreBySlug: (slug: string) => Promise<GenreInfo | null>
  getChildGenres: (parentId: number) => Promise<GenreInfo[]>
  searchGenres: (query: string, limit?: number) => Promise<GenreInfo[]>
  getAllGenres: () => Promise<GenreInfo[]>
}

export class GenreService {
  private readonly queries: GenreQueries

  constructor(deps: { genreQueries: GenreQueries }) {
    this.queries = deps.genreQueries
  }

  slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
  }

  async seedFromLibrary(artists: Array<{ genres: string[] }>): Promise<void> {
    const counts = new Map<string, number>()
    for (const artist of artists) {
      for (const g of artist.genres) {
        if (g) counts.set(g, (counts.get(g) ?? 0) + 1)
      }
    }

    for (const [name, count] of counts) {
      const slug = this.slugify(name)
      if (!slug) continue
      await this.queries.upsertGenre({
        name,
        slug,
        source: 'library',
        artistCount: count,
        cachedAt: new Date(),
      })
    }
  }

  async getOrFetchGenre(slug: string): Promise<GenreInfo | null> {
    return this.queries.getGenreBySlug(slug)
  }

  async search(query: string, limit?: number): Promise<GenreInfo[]> {
    return this.queries.searchGenres(query, limit)
  }

  async getSubGenres(parentId: number): Promise<GenreInfo[]> {
    return this.queries.getChildGenres(parentId)
  }

  async getLibraryGenres(): Promise<GenreInfo[]> {
    return this.queries.getAllGenres()
  }
}
