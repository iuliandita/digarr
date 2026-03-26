import { resolve } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { envConfig } from '@/config/env'
import type { OidcService } from '@/core/auth/oidc'
import type { GenreService } from '@/core/genre/service'
import type { LibraryHealthService } from '@/core/library/health'
import type { SkyHookWarmer } from '@/core/library/skyhook-warmer'
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
import type { subscriptionRuns, subscriptions } from '@/db/schema'

type SubscriptionRow = typeof subscriptions.$inferSelect
type SubscriptionRunRow = typeof subscriptionRuns.$inferSelect

import type { TargetInsert, TargetRow, TargetUpdate } from '@/db/queries/targets'
import type { UserPublic } from '@/db/queries/users'
import { VERSION } from '@/version'
import { adminGuard } from './middleware/admin-guard'
import { authGuard } from './middleware/auth'
import { requestLogger } from './middleware/logger'
import { proxyAuthMiddleware } from './middleware/proxy-auth'
import { rateLimiter } from './middleware/rate-limit'
import { setupGuard } from './middleware/setup-guard'
import { analyticsRoutes } from './routes/analytics'
import { artistRoutes } from './routes/artists'
import { authRoutes } from './routes/auth'
import { batchRoutes } from './routes/batches'
import { dashboardRoutes } from './routes/dashboard'
import { exportRoutes } from './routes/exports'
import { genreRoutes } from './routes/genres'
import { healthRoutes } from './routes/health'
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
import { subscriptionRoutes } from './routes/subscriptions'
import { targetRoutes } from './routes/targets'
import { userRoutes } from './routes/users'
import type { HonoEnv } from './types'

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
  // SkyHook cache warmer (optional -- absent if Lidarr is not configured)
  skyhookWarmer?: SkyHookWarmer | null
  // Subscription query functions
  subscriptionQueries: {
    createSubscription: (data: SubscriptionInsert) => Promise<SubscriptionRow>
    getSubscription: (id: number) => Promise<SubscriptionRow | null>
    getSubscriptionsByUser: (userId: number) => Promise<SubscriptionRow[]>
    getEnabledSubscriptions: () => Promise<SubscriptionRow[]>
    updateSubscription: (id: number, data: SubscriptionUpdate) => Promise<void>
    deleteSubscription: (id: number) => Promise<void>
    getRunsForSubscription: (id: number, limit?: number) => Promise<SubscriptionRunRow[]>
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
  // Playlist deps (optional -- omit in test environments without a DB)
  playlistDeps?: PlaylistDeps
  // Search deps (optional -- absent when no search sources are configured)
  search?: SearchDeps
}

export function createApp(deps: AppDependencies) {
  const app = new Hono<HonoEnv>()

  // Log all requests first -- before auth/cors so we capture everything
  app.use('*', requestLogger())

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
    authGuard(async () => (await deps.getUserCount()) > 0),
  )
  app.use('*', setupGuard(deps.isSetupComplete))

  // Auth status (unauthenticated -- tells the frontend whether auth is required)
  app.get('/api/auth/status', async (c) => {
    const userCount = await deps.getUserCount()
    const proxyAuth = c.get('proxyAuth')
    const sessionToken = c.get('sessionToken')
    const settings = await deps.getSettings()
    const oidcEnabled = !!(settings?.oidcIssuerUrl && settings.oidcClientId)

    const response: Record<string, unknown> = {
      required: userCount > 0 || !!envConfig.authToken,
      hasUsers: userCount > 0,
      oidcEnabled,
      proxyAuthEnabled: envConfig.proxyAuthEnabled,
      version: VERSION,
    }

    if (proxyAuth && sessionToken) {
      response.proxyAuth = true
      response.token = sessionToken
      response.userId = c.get('userId')
    }

    return c.json(response)
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
  app.route('/', authRoutes(deps))
  app.route('/', oauthRoutes(deps))
  app.route('/', healthRoutes({ db: deps.db }))
  app.route('/', setupRoutes(deps))
  app.route('/', settingsRoutes(deps))
  app.route('/', pipelineRoutes(deps))
  app.route('/', recommendationRoutes(deps))
  app.route('/', batchRoutes(deps))
  app.use('/api/analytics/*', adminGuard(deps.getUserById))
  app.use('/api/library/*', adminGuard(deps.getUserById))

  app.route('/', analyticsRoutes(deps))
  app.route('/', artistRoutes(deps))
  app.route('/', lidarrRoutes(deps))
  app.route('/', listeningRoutes(deps))
  app.route('/', genreRoutes(deps))
  app.route('/', subscriptionRoutes(deps))
  app.route('/', userRoutes(deps))
  app.route('/', targetRoutes(deps))
  app.route('/', dashboardRoutes(deps))
  app.route('/', exportRoutes(deps))
  if (deps.playlistDeps) {
    app.route('/', playlistRoutes(deps.playlistDeps))
  }
  app.route(
    '/',
    moodRoutes({ getSettings: deps.getSettings, providerRegistry: deps.providerRegistry }),
  )
  app.route(
    '/',
    libraryRoutes({ libraryHealth: deps.libraryHealth, skyhookWarmer: deps.skyhookWarmer }),
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
