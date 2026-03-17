import { EventEmitter } from 'node:events'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { createProvider } from '@/core/providers/factory'
import type { Preferences } from '@/db/schema'
import { analyze } from './analyze'
import { collect } from './collect'
import { discover } from './discover'
import { filter } from './filter'
import { resolve } from './resolve'
import { score } from './score'
import type { StoreDb } from './store'
import { store } from './store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Settings row shape -- all fields from the DB settings table we actually need
export interface PipelineSettings {
  lidarrUrl: string | null
  lidarrApiKey: string | null
  listenbrainzUsername: string | null
  listenbrainzToken: string | null
  lastfmUsername: string | null
  lastfmApiKey: string | null
  aiProvider: string | null
  aiApiKey: string | null
  aiModel: string | null
  aiBaseUrl: string | null
  preferences: Preferences | null
  skipTlsVerify?: boolean
}

export interface PipelineDeps {
  db: StoreDb
  settings: PipelineSettings
}

// Extended StoreDb for stale batch cleanup
interface BatchManagementDb extends StoreDb {
  updateBatch: (id: number, data: { status: string }) => Promise<void>
  getRunningBatches: (olderThanMs: number) => Promise<Array<{ id: number }>>
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class PipelineOrchestrator extends EventEmitter {
  private running = false
  private currentStage: string | null = null
  private currentMessage: string | null = null

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === 'progress') {
      const progress = args[0] as { stage?: string; message?: string } | undefined
      if (progress?.stage) this.currentStage = progress.stage
      if (progress?.message) this.currentMessage = progress.message
    }
    return super.emit(eventName, ...args)
  }

  async run(deps: PipelineDeps): Promise<{ batchId: number }> {
    if (this.running) throw new Error('Pipeline already running')
    this.running = true
    this.currentStage = null
    this.currentMessage = null

    try {
      const { db, settings } = deps
      const prefs = settings.preferences ?? {
        qualityProfileId: 1,
        rootFolderId: 1,
        scheduleCron: '0 0 * * 0',
        scoreThreshold: 0.5,
        scoringWeights: {
          consensus: 0.3,
          similarity: 0.25,
          genreOverlap: 0.2,
          aiConfidence: 0.15,
          feedbackBoost: 0.1,
        },
        rejectionCooldownDays: 90,
        topArtistsLimit: 30,
        librarySeedRatio: 0.3,
      }

      // -- Build clients from settings ----------------------------------------

      if (!settings.lidarrUrl || !settings.lidarrApiKey) {
        throw new Error('Lidarr URL and API key are required')
      }
      const lidarrClient = createLidarrClient(
        settings.lidarrUrl,
        settings.lidarrApiKey,
        settings.skipTlsVerify,
      )

      const lbClient =
        settings.listenbrainzUsername && settings.listenbrainzToken
          ? createListenBrainzClient(settings.listenbrainzUsername, settings.listenbrainzToken)
          : null

      const lfmClient =
        settings.lastfmUsername && settings.lastfmApiKey
          ? createLastFmClient(settings.lastfmUsername, settings.lastfmApiKey)
          : null

      const mbClient = createMusicBrainzClient()

      const aiProvider =
        settings.aiProvider && settings.aiModel
          ? await createProvider(
              settings.aiProvider,
              settings.aiApiKey ?? null,
              settings.aiModel,
              settings.aiBaseUrl ?? undefined,
            )
          : null

      // -- Stage 1: COLLECT ---------------------------------------------------

      this.emit('progress', { stage: 'collect', message: 'Fetching your Lidarr library...' })
      const libraryArtists = await collect(lidarrClient)
      this.emit('progress', {
        stage: 'collect',
        message: `Found ${libraryArtists.length} artists in your library`,
      })

      // Build lookup structures for score + filter
      const libraryMbids = new Set(libraryArtists.map((a) => a.mbid))
      // Library genres are not available at this stage -- MB lookup happens in
      // resolve. Pass an empty array; genre overlap scoring will be zero for
      // library genres until task-12 query modules populate this.
      const libraryGenres: string[] = []
      // Load rejection cooldown list and feedback history from DB
      const rejectedMbids = await db.getRejectedMbids(prefs.rejectionCooldownDays)
      const feedbackHistory = await db.getFeedbackHistory()

      // -- Stage 2: ANALYZE ---------------------------------------------------

      this.emit('progress', { stage: 'analyze', message: 'Building your taste profile...' })
      const tasteProfile = await analyze(lbClient, lfmClient)
      this.emit('progress', {
        stage: 'analyze',
        message: `Profiled ${tasteProfile.topArtists.length} top artists, ${tasteProfile.topGenres.length} genres`,
      })

      // -- Stage 3: DISCOVER --------------------------------------------------

      this.emit('progress', {
        stage: 'discover',
        message: 'Finding similar artists from all sources...',
      })
      const discovered = await discover(
        tasteProfile,
        {
          listenbrainz: lbClient,
          lastfm: lfmClient,
          musicbrainz: mbClient,
          ai: aiProvider,
        },
        prefs.topArtistsLimit,
        libraryArtists,
        prefs.librarySeedRatio ?? 0.3,
      )
      this.emit('progress', {
        stage: 'discover',
        message: `Discovered ${discovered.length} candidate artists`,
      })

      // -- Stage 4: RESOLVE ---------------------------------------------------

      this.emit('progress', {
        stage: 'resolve',
        message: `Resolving ${discovered.length} artists via MusicBrainz...`,
      })
      const resolved = await resolve(
        discovered,
        mbClient,
        (progress) => {
          this.emit('progress', progress)
        },
        lidarrClient,
      )

      // -- Stage 5: SCORE -----------------------------------------------------

      this.emit('progress', {
        stage: 'score',
        message: `Scoring ${resolved.length} resolved artists...`,
      })
      const scored = score(resolved, libraryGenres, prefs.scoringWeights, feedbackHistory)

      // -- Stage 6: FILTER ----------------------------------------------------

      this.emit('progress', {
        stage: 'filter',
        message: `Filtering ${scored.length} scored artists...`,
      })
      // Also exclude artists that already have recommendations (any status)
      const existingMbids = await db.getExistingRecommendationMbids()
      for (const mbid of existingMbids) {
        libraryMbids.add(mbid)
      }
      const filtered = filter(
        scored,
        libraryMbids,
        rejectedMbids,
        prefs.rejectionCooldownDays,
        prefs.scoreThreshold,
      )

      // -- Stage 7: STORE -----------------------------------------------------

      this.emit('progress', {
        stage: 'store',
        message: `Saving ${filtered.length} recommendations...`,
      })
      const batchId = await store(filtered, db)

      this.emit('progress', {
        stage: 'complete',
        message: `Done! ${filtered.length} new recommendations found.`,
      })
      return { batchId }
    } catch (err) {
      this.emit('error', err)
      throw err
    } finally {
      this.running = false
    }
  }

  get isRunning(): boolean {
    return this.running
  }

  get stage(): string | null {
    return this.currentStage
  }

  get stageMessage(): string | null {
    return this.currentMessage
  }

  /**
   * Mark any 'running' batches older than 30 minutes as 'failed'.
   * Call on startup to handle crashes/restarts.
   */
  async cleanupStaleBatches(db: BatchManagementDb): Promise<void> {
    const thirtyMinutes = 30 * 60 * 1000
    const staleBatches = await db.getRunningBatches(thirtyMinutes)
    for (const batch of staleBatches) {
      await db.updateBatch(batch.id, { status: 'failed' })
    }
  }
}
