export type GenreInfo = {
  id: number
  name: string
  slug: string
  source: string
  parentGenreId: number | null
  artistCount: number
  cachedAt: Date | null
}
