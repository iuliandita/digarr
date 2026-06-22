import type { SupportedLocale } from '@/core/i18n/locales'

export type TasteProfile = {
  topArtists: Array<{
    name: string
    mbid?: string
    playCount: number
    source: string
  }>
  topGenres: Array<{ name: string; weight: number }>
  listeningPatterns: {
    totalListens: number
    recentTrend: 'increasing' | 'stable' | 'decreasing'
  }
  responseLocale?: SupportedLocale
  promptLocale?: SupportedLocale | null
  _rawPrompt?: string
}

export type AiRecommendation = {
  artistName: string
  reasoning: string
  confidence: number
  genres: string[]
  suggestedAlbum?: string
}

export type DiscoveredArtist = {
  name: string
  mbid?: string
  similarityScore: number
  aiReasoning?: string
  suggestedAlbum?: string
  genres?: string[]
  source: string
  sourceUrl?: string
  /** Release-group MBID when this discovery is an album candidate (release-radar). */
  releaseGroupMbid?: string
  /** ISO release date (firstReleaseDate) for album candidates; feeds recency. */
  releaseDate?: string
}

export type ResolvedArtist = {
  mbid: string
  name: string
  disambiguation?: string
  tags: string[]
  genres: string[]
  imageUrl?: string
  logoUrl?: string
  imageFailed?: boolean
  streamingUrls: Record<string, string>
  suggestedAlbum?: { releaseGroupId?: string; title: string; type?: string }
  discoveries: DiscoveredArtist[]
  beginYear?: number
  endYear?: number
  /** 'album' when this resolves to a first-class album recommendation. */
  kind?: 'artist' | 'album'
  /** Release-group MBID for album-kind; feeds the filter-stage album dedup/block. */
  releaseGroupMbid?: string
  /** ISO release date for album-kind; feeds the recency signal. */
  releaseDate?: string
}

export type ScoredArtist = ResolvedArtist & {
  score: number
  sourceScores: Record<string, number>
  aiReasoning?: string
}

export type PipelineStage =
  | 'collect'
  | 'analyze'
  | 'discover'
  | 'resolve'
  | 'score'
  | 'filter'
  | 'store'
  | 'complete'

export type PipelineProgress = {
  stage: PipelineStage
  current?: number
  total?: number
  message?: string
}

export type PipelineStatus = {
  running: boolean
  stage?: PipelineStage
  progress?: { current: number; total: number }
  lastRun?: { batchId: number; completedAt: string; status: string }
}

export type ServiceTestResult = {
  success: boolean
  message: string
  details?: Record<string, unknown>
}
