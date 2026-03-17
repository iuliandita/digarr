import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { PipelineOrchestrator } from '@/core/pipeline/orchestrator'
import type { PipelineScheduler } from '@/core/pipeline/scheduler'
import type {
  ListRecommendationsFilters,
  ListRecommendationsResult,
  RecommendationWithArtist,
  StatusUpdateExtra,
} from '@/db/queries/recommendations'
import type { SetupConfig } from '@/db/queries/settings'
import { setupGuard } from './middleware/setup-guard'
import { artistRoutes } from './routes/artists'
import { batchRoutes } from './routes/batches'
import { healthRoutes } from './routes/health'
import { lidarrRoutes } from './routes/lidarr'
import { listeningRoutes } from './routes/listening'
import { pipelineRoutes } from './routes/pipeline'
import { recommendationRoutes } from './routes/recommendations'
import { settingsRoutes } from './routes/settings'
import { setupRoutes } from './routes/setup'

export type AppDependencies = {
  db: import('@/db').Database
  storeDb: import('@/core/pipeline/store').StoreDb
  orchestrator: PipelineOrchestrator
  scheduler: PipelineScheduler
  isSetupComplete: () => Promise<boolean>
  getSettings: () => Promise<Record<string, unknown> | null>
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
  // Batch query functions
  listBatches: () => Promise<unknown[]>
  getBatch: (id: number) => Promise<unknown | null>
  // Artist query functions
  getArtistById: (id: number) => Promise<unknown | null>
}

export function createApp(deps: AppDependencies) {
  const app = new Hono()

  app.use(
    '*',
    cors({
      origin: process.env.ALLOWED_ORIGIN ?? (process.env.NODE_ENV === 'production' ? '' : '*'),
    }),
  )
  app.use('*', setupGuard(deps.isSetupComplete))
  app.route('/', healthRoutes({ db: deps.db }))
  app.route('/', setupRoutes(deps))
  app.route('/', settingsRoutes(deps))
  app.route('/', pipelineRoutes(deps))
  app.route('/', recommendationRoutes(deps))
  app.route('/', batchRoutes(deps))
  app.route('/', artistRoutes(deps))
  app.route('/', lidarrRoutes(deps))
  app.route('/', listeningRoutes(deps))

  // Serve built SPA in production (dev uses Vite's dev server with proxy)
  if (process.env.NODE_ENV === 'production') {
    app.use('/*', serveStatic({ root: './dist/web' }))
    app.get('*', serveStatic({ root: './dist/web', path: 'index.html' }))
  }

  return app
}
