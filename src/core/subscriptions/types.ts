import type { MBArtist, MBSearchResult } from '@/core/clients/musicbrainz'
import type { StoreDb } from '@/core/pipeline/store'
import type { DiscoveredArtist } from '@/core/types'

/** What an adapter returns from fetch(). */
export type AdapterResult = {
  artists: DiscoveredArtist[]
}

/** Describes one field of an adapter's sourceConfig for the UI form. */
export type AdapterConfigField = {
  key: string
  label: string
  type: 'text' | 'password' | 'number' | 'select'
  required?: boolean
  placeholder?: string
  options?: Array<{ value: string; label: string }>
  helpText?: string
}

/** Pluggable adapter that knows how to fetch artists for a subscription. */
export interface SubscriptionAdapter {
  /** Unique identifier matching subscriptions.sourceType values (e.g. 'lastfm', 'genre'). */
  type: string
  /** Human-readable name shown in the subscription form. */
  label: string
  /** Describes which config fields the adapter needs. */
  configFields: AdapterConfigField[]
  /** Fetch artists based on the subscription config. */
  fetch(config: Record<string, unknown>, options?: { limit?: number }): Promise<AdapterResult>
}

/** Subscription row data the runner needs -- a subset of the full DB row. */
export type SubscriptionConfig = {
  id: number
  userId: number | null
  sourceType: string
  sourceConfig: Record<string, unknown>
  maxArtistsPerRun: number | null
  scoreThreshold: number | null
  scoringWeightPreset: string | null
  scoringWeightOverrides: Record<string, number> | null
}

/** Run record shape returned from insertRun (mirrors subscriptionRuns.$inferSelect). */
export type SubscriptionRunRow = {
  id: number
  subscriptionId: number
  startedAt: Date
  completedAt: Date | null
  artistsFound: number | null
  artistsNew: number | null
  error: string | null
  batchId: number | null
}

/** Data needed to create a run record. */
export type RunInsert = {
  subscriptionId: number
  batchId?: number | null
}

/** Data needed to complete a run record. */
export type RunComplete = {
  completedAt: Date
  artistsFound?: number
  artistsNew?: number
  error?: string | null
  batchId?: number | null
}

/** Data for updating subscription metadata after a run. */
export type SubscriptionUpdate = {
  lastRunAt?: Date | null
  lastResultCount?: number | null
  lastError?: string | null
}

/** MusicBrainz client interface used by the runner (must satisfy resolve.ts requirements). */
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

/** Minimal Lidarr lookup interface used by the runner. */
export interface LidarrLookupClient {
  lookupArtist(term: string): Promise<
    Array<{
      foreignArtistId: string
      artistName: string
      images?: Array<{ url: string; coverType: string }>
    }>
  >
}

/** All dependencies the generic subscription runner needs. */
export type SubscriptionRunDeps = {
  db: StoreDb
  queries: SubscriptionQueries
  mbClient: MusicBrainzClient
  lidarr?: LidarrLookupClient
  userId?: number
  // Pipeline context
  libraryMbids: Set<string>
  libraryGenres: string[]
  rejectedMbids: Set<string>
  feedbackHistory: Map<string, { approved: number; total: number }>
  cooldownDays: number
  defaultScoreThreshold: number
  /** Lowercase names of the user's top listened artists -- excluded from results. */
  topArtistNames?: Set<string>
}

/** DB query interface for the subscription runner. */
export interface SubscriptionQueries {
  insertRun(data: RunInsert): Promise<SubscriptionRunRow>
  completeRun(id: number, data: RunComplete): Promise<void>
  updateSubscription(id: number, data: SubscriptionUpdate): Promise<void>
}

/** Return type from a completed runSubscription call. */
export type RunResult = {
  runId: number
  batchId: number | null
  artistsFound: number
  artistsNew: number
  error?: string
}
