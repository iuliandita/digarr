import type { MBArtist, MBSearchResult } from '@/core/clients/musicbrainz'
import type { DiscoveryConnectionSnapshot } from '@/core/discovery-modes/availability'
import type { DiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import type { runDiscoveryMode } from '@/core/discovery-modes/run'
import type { PipelineDeps, PipelineOrchestrator } from '@/core/pipeline/orchestrator'
import type { StoreDb } from '@/core/pipeline/store'
import type { DiscoveredArtist } from '@/core/types'

export type DiscoveryModeSubscriptionConfig = {
  modeId: string
  settingsMode: 'easy' | 'advanced'
  settings: Record<string, unknown>
  providerContext?: Record<string, unknown>
  fallbackPolicy?: 'strict' | 'allow-fallback'
}

export type AdapterResult = {
  artists: DiscoveredArtist[]
}

export type AdapterConfigField = {
  key: string
  label: string
  type: 'text' | 'password' | 'number' | 'select'
  required?: boolean
  placeholder?: string
  options?: Array<{ value: string; label: string }>
  helpText?: string
}

export interface SubscriptionAdapter {
  type: string
  label: string
  configFields: AdapterConfigField[]
  fetch(config: Record<string, unknown>, options?: { limit?: number }): Promise<AdapterResult>
}

export type SubscriptionConfig = {
  id: number
  userId: number | null
  sourceType: string
  sourceConfig: Record<string, unknown> | DiscoveryModeSubscriptionConfig
  maxArtistsPerRun: number | null
  scoreThreshold: number | null
  scoringWeightPreset: string | null
  scoringWeightOverrides: Record<string, number> | null
}

export type SubscriptionUpdate = {
  lastRunAt?: Date | null
  lastResultCount?: number | null
  lastError?: string | null
}

export interface MusicBrainzClient {
  lookupArtist(mbid: string): Promise<MBArtist>
  searchArtist(query: string): Promise<MBSearchResult>
  extractStreamingUrls(
    relations: Array<{ type: string; url?: { resource: string } }>,
  ): Record<string, string>
  getReleaseGroups?: (
    artistMbid: string,
  ) => Promise<Array<{ id: string; title: string; type: string; firstReleaseDate?: string }>>
}

export interface LidarrLookupClient {
  lookupArtist(term: string): Promise<
    Array<{
      foreignArtistId: string
      artistName: string
      images?: Array<{ url: string; coverType: string }>
    }>
  >
}

export type SubscriptionRunDeps = {
  db: StoreDb
  queries: SubscriptionQueries
  mbClient: MusicBrainzClient
  lidarr?: LidarrLookupClient
  userId?: number
  jobRecorder: import('@/core/jobs/types').JobRecorder
  // Pipeline context
  libraryMbids: Set<string>
  libraryGenres: string[]
  rejectedMbids: Set<string>
  feedbackHistory: Map<string, { approved: number; total: number }>
  cooldownDays: number
  defaultScoreThreshold: number
  /** Lowercase names of the user's top listened artists - excluded from results. */
  topArtistNames?: Set<string>
  discoveryModeRunner?: typeof runDiscoveryMode
  discoveryModeRegistry?: DiscoveryModeRegistry
  getDiscoveryConnectionSnapshot?: (userId: number) => Promise<DiscoveryConnectionSnapshot>
  pipelineOrchestrator?: Pick<PipelineOrchestrator, 'run'>
  discoveryModePipelineDeps?: Omit<
    PipelineDeps,
    'explicitCandidates' | 'explicitDiscoveryMode' | 'jobRecorder' | 'trigger' | 'userId'
  >
}

export interface SubscriptionQueries {
  updateSubscription(id: number, data: SubscriptionUpdate): Promise<void>
  getBatchStats?(batchId: number): Promise<{ added: number } | null>
}

export type RunResult = {
  runId: number
  batchId: number | null
  artistsFound: number
  artistsNew: number
  error?: string
}
