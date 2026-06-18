// Per-domain slices of the old AppDependencies bag. Route files that only
// consume a subset can now import the narrower slice they need so their
// tests can mock less scaffolding. The full AppDependencies type in
// src/server/index.ts is an intersection of all slices and stays
// structurally compatible - existing callers do not need to change.

import type { OidcService } from '@/core/auth/oidc'
import type { DiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import type { GenreService } from '@/core/genre/service'
import type { SupportedLocale } from '@/core/i18n/locales'
import type { AlbumCoverage } from '@/core/library/album-coverage'
import type { LibraryHealthService } from '@/core/library/health'
import type { SkyHookWarmer } from '@/core/library/skyhook-warmer'
import type { LibrarySyncStore } from '@/core/library/store'
import type { SyncOrchestrator } from '@/core/library/sync'
import type { PipelineOrchestrator } from '@/core/pipeline/orchestrator'
import type { SubscriptionScheduler } from '@/core/pipeline/subscription-scheduler'
import type { AiProviderRegistry } from '@/core/providers/registry'
import type { ServiceTestResult } from '@/core/types'
import type { ArtistRow } from '@/db/queries/artists'
import type { BatchRow } from '@/db/queries/batches'
import type { ActivityEntry, TasteGenre } from '@/db/queries/dashboard'
import type {
  ListRecommendationsFilters,
  ListRecommendationsResult,
  RecommendationWithArtist,
  StatusUpdateExtra,
} from '@/db/queries/recommendations'
import type { SettingsRow, SetupConfig } from '@/db/queries/settings'
import type { SubscriptionInsert, SubscriptionUpdate } from '@/db/queries/subscriptions'
import type { subscriptions } from '@/db/schema'
import type { Cursor } from '@/server/helpers/pagination-cursor'

type SubscriptionRow = typeof subscriptions.$inferSelect

import type { TargetInsert, TargetRow, TargetUpdate } from '@/db/queries/targets'
import type { UserPublic } from '@/db/queries/users'
import type { PlaylistDeps } from './routes/playlists'
import type { SearchDeps } from './routes/search'
import type { DiscoveryConnectionSnapshot } from './types'

// ---- DB / storage ----

export interface DbDeps {
  db: import('@/db').Database
  storeDb: import('@/core/pipeline/store').StoreDb
}

// ---- Settings / setup ----

export interface SettingsDeps {
  isSetupComplete: () => Promise<boolean>
  getSettings: () => Promise<SettingsRow | null>
  updateSettings: (partial: Record<string, unknown>) => Promise<void>
  completeSetup: (config: SetupConfig) => Promise<unknown>
}

// ---- Users / auth ----

export interface UserDeps {
  createUser: (data: {
    username: string
    passwordHash: string
    isAdmin?: boolean
  }) => Promise<UserPublic>
  getUserByUsername: (
    username: string,
  ) => Promise<{ id: number; username: string; passwordHash: string; isAdmin: boolean } | null>
  getUserById: (id: number) => Promise<UserPublic | null>
  getUserCount: () => Promise<number>
  updatePassword: (id: number, passwordHash: string) => Promise<void>
  updateUserPreferredLocale: (id: number, preferredLocale: SupportedLocale | null) => Promise<void>
  getOidcService: () => Promise<OidcService | null>
  getUserByOidcSubject: (subject: string) => Promise<{ id: number; username: string } | null>
  getUserByEmail: (email: string) => Promise<{ id: number; username: string } | null>
  updateUser: (
    id: number,
    data: { isAdmin?: boolean; email?: string; oidcSubject?: string },
  ) => Promise<void>
  listUsers: (opts?: { limit?: number; cursor?: Cursor | null }) => Promise<UserPublic[]>
  deleteUser: (id: number) => Promise<void>
}

// ---- Pipeline / scheduler / jobs ----

export interface PipelineDeps {
  orchestrator: PipelineOrchestrator
  scheduler: SubscriptionScheduler
  providerRegistry: AiProviderRegistry
  getLastBatch: () => Promise<{ id: number; createdAt: Date | string; status: string } | null>
  restartScheduler: (cron: string | null) => void
  restartPlaylistScheduler: () => Promise<void>
  restartLibraryMaintenanceScheduler?: (intervalHours: number) => void
}

export interface JobDeps {
  jobRecorder: import('@/core/jobs/types').JobRecorder
  jobQueries: {
    listJobs: (
      filters?: import('@/db/queries/jobs').ListJobsFilters,
    ) => Promise<{ items: import('@/core/jobs/types').JobRunRow[]; total: number }>
    getJobById: (id: number) => Promise<import('@/core/jobs/types').JobRunRow | null>
    getJobHealth: (nextRun: Date | null) => Promise<import('@/db/queries/jobs').HealthSummary>
    getJobsForSubscription: (
      subId: number,
      limit?: number,
    ) => Promise<import('@/core/jobs/types').JobRunRow[]>
  }
}

// ---- Recommendations / batches / artists ----

export interface RecommendationDeps {
  listRecommendations: (filters?: ListRecommendationsFilters) => Promise<ListRecommendationsResult>
  getRecommendation: (id: number) => Promise<RecommendationWithArtist | null>
  updateRecommendationStatus: (
    id: number,
    status: string,
    extra?: StatusUpdateExtra,
  ) => Promise<void>
  rejectRecommendation: (
    params: import('@/db/queries/recommendations').RejectRecommendationParams,
  ) => Promise<number | null>
  bulkUpdateStatus: (ids: number[], status: string) => Promise<void>
  filterOwnedIds: (ids: number[], userId: number | undefined) => Promise<number[]>
  listBatches: (opts?: { limit?: number; cursor?: Cursor | null }) => Promise<BatchRow[]>
  getBatch: (id: number) => Promise<BatchRow | null>
  getArtistById: (id: number) => Promise<ArtistRow | null>
  getFeedbackHistory: (userId?: number) => Promise<Map<string, { approved: number; total: number }>>
  listArtistBlocks: (params: {
    userId: number
    limit?: number
    cursor?: import('@/db/queries/artist-blocks').ListBlocksCursor | null
    q?: string | null
  }) => Promise<{
    items: import('@/db/queries/artist-blocks').BlockedArtistRow[]
    nextCursor: import('@/db/queries/artist-blocks').ListBlocksCursor | null
  }>
  removeArtistBlock: (params: { userId: number; artistId: number }) => Promise<boolean>
  addArtistBlock: (params: {
    userId: number
    artistId: number
    reason?: import('@/core/recommendations/rejection-reasons').RejectionReason | null
    reasonText?: string | null
  }) => Promise<void>
}

// ---- Subscriptions ----

export interface SubscriptionDeps {
  subscriptionQueries: {
    createSubscription: (data: SubscriptionInsert) => Promise<SubscriptionRow>
    getSubscription: (id: number) => Promise<SubscriptionRow | null>
    getSubscriptionsByUser: (
      userId: number,
      opts?: { limit?: number; cursor?: Cursor | null },
    ) => Promise<SubscriptionRow[]>
    getEnabledSubscriptions: () => Promise<SubscriptionRow[]>
    updateSubscription: (id: number, data: SubscriptionUpdate) => Promise<void>
    deleteSubscription: (id: number) => Promise<void>
  }
  runSubscription: (id: number) => Promise<void>
}

// ---- Targets ----

export interface TargetDeps {
  targetQueries: {
    createTarget: (data: TargetInsert) => Promise<{ id: number }>
    getTargetsByUser: (
      userId: number,
      opts?: { limit?: number; cursor?: Cursor | null },
    ) => Promise<TargetRow[]>
    getAllTargets: (opts?: { limit?: number; cursor?: Cursor | null }) => Promise<TargetRow[]>
    getTarget: (id: number) => Promise<TargetRow | null>
    updateTarget: (id: number, data: TargetUpdate) => Promise<void>
    deleteTarget: (id: number) => Promise<void>
  }
  testTargetConnection: (
    type: string,
    config: Record<string, unknown>,
  ) => Promise<ServiceTestResult>
  getEnabledTargetsForUser: (
    userId: number,
  ) => Promise<import('@/core/targets/types').DestinationTarget[]>
}

// ---- Library ----

export interface LibraryDeps {
  genreService: GenreService
  libraryHealth: LibraryHealthService
  skyhookWarmer?: SkyHookWarmer | null
  librarySync: SyncOrchestrator
  librarySyncStore: LibrarySyncStore
  albumCoverage?: {
    getCoverageForArtist: (userId: number, artistMbid: string) => Promise<AlbumCoverage>
  }
}

// ---- Slskd (optional) ----

export interface SlskdDeps {
  slskdOrchestrator?: {
    readonly isSyncing: boolean
    triggerSync: () => Promise<void>
    warmup: () => Promise<void>
    getActiveJobs: (limit?: number) => Promise<
      Array<{
        id: number
        targetId: number
        recommendationId: number | null
        state: string
        releaseTitle: string
      }>
    >
  }
}

// ---- Dashboard ----

export interface DashboardDeps {
  dashboardQueries: {
    getTopGenresForUser: (userId: number | undefined) => Promise<TasteGenre[]>
    getRecentActivity: (
      userId: number | undefined,
      isAdmin: boolean,
      limit?: number,
    ) => Promise<ActivityEntry[]>
  }
}

// ---- Discovery modes ----

export interface DiscoveryDeps {
  discoveryModeRegistry?: DiscoveryModeRegistry
  getDiscoveryConnectionSnapshot?: (userId: number) => Promise<DiscoveryConnectionSnapshot>
  runDiscoveryMode?: (
    request: DiscoveryModeRequest,
    options?: { existingJobId?: number },
  ) => Promise<{ batchId: number; artistsFound?: number }>
}

// ---- Playlist / search (already externalised) ----

export interface OptionalRouteDeps {
  playlistDeps?: PlaylistDeps
  search?: SearchDeps
}

// Full app dependencies. Intersecting the per-domain slices keeps the
// structural shape identical so existing route factories that take
// `AppDependencies` keep compiling without changes.
export type AppDependencies = DbDeps &
  SettingsDeps &
  UserDeps &
  PipelineDeps &
  JobDeps &
  RecommendationDeps &
  SubscriptionDeps &
  TargetDeps &
  LibraryDeps &
  SlskdDeps &
  DashboardDeps &
  DiscoveryDeps &
  OptionalRouteDeps
