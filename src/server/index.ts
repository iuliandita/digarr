import { resolve } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { envConfig } from '@/config/env'
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

type SubscriptionRow = typeof subscriptions.$inferSelect

import type { TargetInsert, TargetRow, TargetUpdate } from '@/db/queries/targets'
import type { UserPublic } from '@/db/queries/users'
import { VERSION } from '@/version'
import { adminGuard } from './middleware/admin-guard'
import { authGuard } from './middleware/auth'
import { requestLogger } from './middleware/logger'
import { proxyAuthMiddleware } from './middleware/proxy-auth'
import { rateLimiter } from './middleware/rate-limit'
import { setupGuard } from './middleware/setup-guard'
import { adminRoutes } from './routes/admin'
import { analyticsRoutes } from './routes/analytics'
import { artistRoutes } from './routes/artists'
import { authRoutes } from './routes/auth'
import { batchRoutes } from './routes/batches'
import { dashboardRoutes } from './routes/dashboard'
import { discoveryModeRoutes } from './routes/discovery-modes'
import { exportRoutes } from './routes/exports'
import { genreRoutes } from './routes/genres'
import { healthRoutes } from './routes/health'
import { jobRoutes } from './routes/jobs'
import { libraryRoutes } from './routes/library'
import { lidarrRoutes } from './routes/lidarr'
import { listeningRoutes } from './routes/listening'
import { moodRoutes } from './routes/mood'
import { oauthRoutes } from './routes/oauth'
import { oidcRoutes } from './routes/oidc'
import { pipelineRoutes } from './routes/pipeline'
import type { PlaylistDeps } from './routes/playlists'
import { playlistRoutes } from './routes/playlists'
import { recommendationRoutes } from './routes/recommendations'
import type { SearchDeps } from './routes/search'
import { searchRoutes } from './routes/search'
import { settingsRoutes } from './routes/settings'
import { setupRoutes } from './routes/setup'
import { slskdRoutes } from './routes/slskd'
import { subscriptionRoutes } from './routes/subscriptions'
import { targetRoutes } from './routes/targets'
import { userRoutes } from './routes/users'
import type { DiscoveryConnectionSnapshot, HonoEnv } from './types'

export type AppDependencies = {
  db: import('@/db').Database
  storeDb: import('@/core/pipeline/store').StoreDb
  orchestrator: PipelineOrchestrator
  scheduler: SubscriptionScheduler
  providerRegistry: AiProviderRegistry
  isSetupComplete: () => Promise<boolean>
  getSettings: () => Promise<SettingsRow | null>
  updateSettings: (partial: Record<string, unknown>) => Promise<void>
  completeSetup: (config: SetupConfig) => Promise<unknown>
  // Pipeline status
  getLastBatch: () => Promise<{ id: number; createdAt: Date | string; status: string } | null>
  // Recommendation query functions
  listRecommendations: (filters?: ListRecommendationsFilters) => Promise<ListRecommendationsResult>
  getRecommendation: (id: number) => Promise<RecommendationWithArtist | null>
  updateRecommendationStatus: (
    id: number,
    status: string,
    extra?: StatusUpdateExtra,
  ) => Promise<void>
  bulkUpdateStatus: (ids: number[], status: string) => Promise<void>
  filterOwnedIds: (ids: number[], userId: number | undefined) => Promise<number[]>
  // Batch query functions
  listBatches: () => Promise<BatchRow[]>
  getBatch: (id: number) => Promise<BatchRow | null>
  // Artist query functions
  getArtistById: (id: number) => Promise<ArtistRow | null>
  restartScheduler: (cron: string | null) => void
  restartPlaylistScheduler: () => Promise<void>
  restartLibraryMaintenanceScheduler?: (intervalHours: number) => void
  // User query functions
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
  // OIDC + user management
  getOidcService: () => Promise<OidcService | null>
  getUserByOidcSubject: (subject: string) => Promise<{ id: number; username: string } | null>
  getUserByEmail: (email: string) => Promise<{ id: number; username: string } | null>
  updateUser: (
    id: number,
    data: { isAdmin?: boolean; email?: string; oidcSubject?: string },
  ) => Promise<void>
  listUsers: () => Promise<UserPublic[]>
  deleteUser: (id: number) => Promise<void>
  // Genre service
  genreService: GenreService
  // Library health service
  libraryHealth: LibraryHealthService
  // SkyHook cache warmer (optional - absent if Lidarr is not configured)
  skyhookWarmer?: SkyHookWarmer | null
  // Library sync orchestrator + store
  librarySync: SyncOrchestrator
  librarySyncStore: LibrarySyncStore
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
  albumCoverage?: {
    getCoverageForArtist: (userId: number, artistMbid: string) => Promise<AlbumCoverage>
  }
  // Subscription query functions
  subscriptionQueries: {
    createSubscription: (data: SubscriptionInsert) => Promise<SubscriptionRow>
    getSubscription: (id: number) => Promise<SubscriptionRow | null>
    getSubscriptionsByUser: (userId: number) => Promise<SubscriptionRow[]>
    getEnabledSubscriptions: () => Promise<SubscriptionRow[]>
    updateSubscription: (id: number, data: SubscriptionUpdate) => Promise<void>
    deleteSubscription: (id: number) => Promise<void>
  }
  // Manual subscription trigger
  runSubscription: (id: number) => Promise<void>
  // Target management
  targetQueries: {
    createTarget: (data: TargetInsert) => Promise<{ id: number }>
    getTargetsByUser: (userId: number) => Promise<TargetRow[]>
    getAllTargets: () => Promise<TargetRow[]>
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
  getFeedbackHistory: () => Promise<Map<string, { approved: number; total: number }>>
  dashboardQueries: {
    getTopGenresForUser: (userId: number | undefined) => Promise<TasteGenre[]>
    getRecentActivity: (
      userId: number | undefined,
      isAdmin: boolean,
      limit?: number,
    ) => Promise<ActivityEntry[]>
  }
  discoveryModeRegistry?: DiscoveryModeRegistry
  getDiscoveryConnectionSnapshot?: (userId: number) => Promise<DiscoveryConnectionSnapshot>
  runDiscoveryMode?: (
    request: DiscoveryModeRequest,
    options?: { existingJobId?: number },
  ) => Promise<{ batchId: number; artistsFound?: number }>
  // Job recording & queries
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
  // Playlist deps (optional - omit in test environments without a DB)
  playlistDeps?: PlaylistDeps
  // Search deps (optional - absent when no search sources are configured)
  search?: SearchDeps
}

export function createApp(deps: AppDependencies) {
  const app = new Hono<HonoEnv>()

  // Log all requests first - before auth/cors so we capture everything
  app.use('*', requestLogger())

  if (!envConfig.allowedOrigin && process.env.NODE_ENV === 'production') {
    console.warn(
      'ALLOWED_ORIGIN is not set in production - CORS will reject cross-origin requests. Set ALLOWED_ORIGIN to your app URL.',
    )
  }
  app.use(
    '*',
    cors({
      origin:
        envConfig.allowedOrigin ?? (process.env.NODE_ENV === 'production' ? () => undefined : '*'),
    }),
  )
  app.use(
    '*',
    secureHeaders({
      xFrameOptions: 'DENY',
      xContentTypeOptions: 'nosniff',
      referrerPolicy: 'strict-origin-when-cross-origin',
      crossOriginOpenerPolicy: 'same-origin',
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:'],
        fontSrc: ["'self'"],
        frameSrc: ["'self'", 'https://open.spotify.com'],
      },
    }),
  )
  app.use(
    '*',
    proxyAuthMiddleware({
      enabled: envConfig.proxyAuthEnabled,
      trustedProxies:
        envConfig.proxyAuthTrustedProxies
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) ?? [],
      getUserByUsername: deps.getUserByUsername,
      createUser: deps.createUser,
      getUserCount: deps.getUserCount,
    }),
  )
  app.use(
    '*',
    authGuard({
      hasUsers: async () => (await deps.getUserCount()) > 0,
      isSetupComplete: deps.isSetupComplete,
    }),
  )
  app.use('*', setupGuard(deps.isSetupComplete))

  // Auth status (optional auth - tells the frontend whether auth is required
  // AND whether the caller is already authenticated via session cookie / bearer
  // token / proxy auth. Never returns a raw session token: the cookie handles
  // authentication on subsequent requests.
  //
  // Deployment-fingerprint fields (version, proxyAuthEnabled) live on
  // `/api/auth/meta` behind auth so an unauthenticated attacker cannot
  // enumerate the build or infer deployment topology. `oidcEnabled` stays
  // here because the login screen needs it to render the SSO button.
  app.get('/api/auth/status', async (c) => {
    const [userCount, setupComplete] = await Promise.all([
      deps.getUserCount(),
      deps.isSetupComplete(),
    ])
    const userId = c.get('userId')
    const user = typeof userId === 'number' ? await deps.getUserById(userId) : null
    const settings = await deps.getSettings()
    const oidcEnabled = !!(settings?.oidcIssuerUrl && settings.oidcClientId)

    return c.json({
      authenticated: !!user,
      userId: user?.id,
      isAdmin: user?.isAdmin ?? false,
      required: userCount > 0 || !!envConfig.authToken || setupComplete,
      hasUsers: userCount > 0,
      oidcEnabled,
    })
  })

  // Authenticated-only deployment metadata. Splits fingerprint-sensitive
  // fields off the public /api/auth/status surface. Not listed in
  // PUBLIC_PATHS / OPTIONAL_AUTH_PATHS, so authGuard enforces a 401 for
  // unauthenticated callers.
  app.get('/api/auth/meta', async (c) => {
    const settings = await deps.getSettings()
    return c.json({
      version: VERSION,
      oidcEnabled: !!(settings?.oidcIssuerUrl && settings.oidcClientId),
      proxyAuthEnabled: envConfig.proxyAuthEnabled,
    })
  })

  app.route(
    '/',
    oidcRoutes({
      getOidcService: deps.getOidcService,
      getUserByOidcSubject: deps.getUserByOidcSubject,
      getUserByEmail: deps.getUserByEmail,
      getUserByUsername: deps.getUserByUsername,
      createUser: deps.createUser,
      getUserCount: deps.getUserCount,
      updateUser: deps.updateUser,
    }),
  )
  // Rate limit auth endpoints: 10 attempts per minute for login/register
  app.use('/api/auth/login', rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'auth' }))
  app.use('/api/auth/register', rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'reg' }))
  app.use('/api/auth/change-password', rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'chpw' }))
  // Rate limit AI-consuming endpoints to prevent API budget exhaustion
  app.use('/api/mood/discover', rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'mood' }))
  app.use(
    '/api/pipeline/quick-discover',
    rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'qdsc' }),
  )
  app.route('/', authRoutes(deps))
  app.route('/', oauthRoutes(deps))
  app.route('/', healthRoutes({ db: deps.db }))
  app.route('/', setupRoutes(deps))
  app.route('/', settingsRoutes(deps))
  app.route('/', pipelineRoutes(deps))
  app.route('/', recommendationRoutes(deps))
  app.route('/', batchRoutes(deps))
  app.use('/api/admin/*', adminGuard(deps.getUserById))
  app.use('/api/analytics/*', adminGuard(deps.getUserById))

  app.route(
    '/',
    adminRoutes({
      db: deps.db,
      getUserById: deps.getUserById,
      getSettings: deps.getSettings,
      generateReasoning: async (artistName, genres) => {
        const settings = await deps.getSettings()
        const s = settings as Record<string, unknown> | null
        if (!s?.aiProvider) throw new Error('No AI provider configured')
        const provider = await deps.providerRegistry.create(s.aiProvider as string, {
          apiKey: (s.aiApiKey as string) ?? null,
          model: (s.aiModel as string) ?? '',
          baseUrl: (s.aiBaseUrl as string) ?? null,
        })
        const genreList = genres.length > 0 ? genres.join(', ') : 'unknown'
        const results = await provider.getRecommendations({
          topArtists: [],
          topGenres: [],
          listeningPatterns: { totalListens: 0, recentTrend: 'stable' },
          _rawPrompt: `Describe the artist "${artistName}" (genres: ${genreList}) in 2-3 sentences. First describe what they sound like and what they're known for, then explain why fans of ${genreList} might enjoy them. Return ONLY a JSON array with one element: [{"artistName":"${artistName}","reasoning":"...","confidence":0.8,"genres":${JSON.stringify(genres)}}]`,
        })
        return results[0]?.reasoning ?? `${artistName} is an artist in the ${genreList} genre.`
      },
    }),
  )
  app.route('/', analyticsRoutes(deps))
  app.route('/', artistRoutes(deps))
  app.route('/', lidarrRoutes(deps))
  app.route('/', listeningRoutes(deps))
  app.route('/', discoveryModeRoutes(deps))
  app.route('/', genreRoutes(deps))
  app.route('/', subscriptionRoutes(deps))
  app.route('/', userRoutes(deps))
  app.route('/', targetRoutes(deps))
  if (deps.slskdOrchestrator) {
    app.route(
      '/',
      slskdRoutes({
        getUserById: deps.getUserById,
        slskdOrchestrator: deps.slskdOrchestrator,
      }),
    )
  }
  app.route('/', dashboardRoutes(deps))
  app.route(
    '/',
    jobRoutes({
      getUserById: deps.getUserById,
      jobQueries: deps.jobQueries,
      scheduler: {
        get nextRun() {
          return deps.scheduler.nextRun('main-pipeline')
        },
      },
    }),
  )
  app.route('/', exportRoutes(deps))
  if (deps.playlistDeps) {
    app.route('/', playlistRoutes(deps.playlistDeps))
  }
  app.route(
    '/',
    moodRoutes({
      getSettings: deps.getSettings,
      getUserById: deps.getUserById,
      providerRegistry: deps.providerRegistry,
    }),
  )
  app.route(
    '/',
    libraryRoutes({
      libraryHealth: deps.libraryHealth,
      skyhookWarmer: deps.skyhookWarmer,
      librarySync: deps.librarySync,
      librarySyncStore: deps.librarySyncStore,
      getSettings: deps.getSettings,
      albumCoverage: deps.albumCoverage ?? {
        getCoverageForArtist: async () => {
          throw new Error('Album coverage service not configured')
        },
      },
      getUserById: deps.getUserById,
    }),
  )
  if (deps.search) {
    app.route('/', searchRoutes(deps.search))
  }

  // Serve built SPA in production (dev uses Vite's dev server with proxy)
  // Absolute path required: @hono/node-server serveStatic resolves relative
  // to the module directory (dist/server/), not process.cwd()
  if (process.env.NODE_ENV === 'production') {
    const webRoot = resolve(process.cwd(), 'dist/web')
    app.use('/*', serveStatic({ root: webRoot }))
    app.get('*', serveStatic({ root: webRoot, path: 'index.html' }))
  }

  return app
}
