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
