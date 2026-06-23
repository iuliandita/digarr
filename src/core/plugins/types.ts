import type { ServiceTestResult } from '@/core/types'

export type TopArtistEntry = {
  name: string
  mbid?: string
  playCount: number
  source: string
  genres?: string[]
}

export type SimilarArtistEntry = {
  name: string
  mbid?: string
  similarityScore: number
  source: string
}

export type ListeningActivityEntry = {
  listen_count: number
  from_ts: number
  to_ts: number
}

export type GenreArtistEntry = {
  name: string
  mbid?: string
  listeners: number
  source: string
}

export type SourceCapability =
  | 'topArtists'
  | 'similarArtists'
  | 'genreArtists'
  | 'recentListening'
  | 'listeningActivity'

export interface DiscoverySource {
  id: string
  name: string
  capabilities: SourceCapability[]
  getTopArtists(limit?: number): Promise<TopArtistEntry[]>
  getSimilarArtists(artistName: string, mbid?: string): Promise<SimilarArtistEntry[]>
  testConnection(): Promise<ServiceTestResult>
  getListeningActivity?(): Promise<ListeningActivityEntry[]>
  getGenreArtists?(genre: string, options?: { limit?: number }): Promise<GenreArtistEntry[]>
  getRecentListening?(limit?: number): Promise<{ name: string; track?: string; playedAt: Date }[]>
}
