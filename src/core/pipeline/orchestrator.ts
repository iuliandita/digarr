import { EventEmitter } from 'node:events'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { sendWebhook } from '@/core/notifications'
import { createDiscogsSource } from '@/core/plugins/discogs'
import { createJellyfinSource } from '@/core/plugins/jellyfin'
import { createLastFmSource } from '@/core/plugins/lastfm'
import { createListenBrainzSource } from '@/core/plugins/listenbrainz'
import { createPlexSource } from '@/core/plugins/plex'
import { SourceRegistry } from '@/core/plugins/registry'
import { createSpotifySource } from '@/core/plugins/spotify'
import type { AiProviderRegistry } from '@/core/providers/registry'
import type { UserConnections } from '@/db/queries/users'
import { mergePreferences, type Preferences } from '@/db/schema'
import { analyze } from './analyze'
import { type AutoApproveDeps, autoApprove } from './auto-approve'
import { collect } from './collect'
import { discover } from './discover'
import { enrichGenres } from './enrich'
import { filter } from './filter'
import { resolve } from './resolve'
import { score } from './score'
import type { StoreDb } from './store'
import { store } from './store'

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
  spotifyAccessToken?: string | null
}

export interface PipelineDeps {
  db: StoreDb
  settings: PipelineSettings
  userId?: number
  providerRegistry?: AiProviderRegistry
  userConnections?: UserConnections | null
  autoApproveDeps?: AutoApproveDeps | null
}

export class PipelineOrchestrator extends EventEmitter {
  private running = false
  private currentStage: string | null = null
  private currentMessage: string | null = null
  private _currentUserId: number | undefined = undefined

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === 'progress') {
      const progress = args[0] as { stage?: string; message?: string } | undefined
      if (progress?.stage) this.currentStage = progress.stage
      if (progress?.message) this.currentMessage = progress.message
      // Inject userId so SSE clients can filter events
      if (progress && this._currentUserId !== undefined) {
        ;(progress as Record<string, unknown>).userId = this._currentUserId
      }
    }
    return super.emit(eventName, ...args)
  }

  async run(deps: PipelineDeps): Promise<{ batchId: number }> {
    if (this.running) throw new Error('Pipeline already running')
    this.running = true
    this.currentStage = null
    this.currentMessage = null
    this._currentUserId = deps.userId

    try {
      const { db, settings, providerRegistry } = deps
      // Merge with defaults so partially-saved preferences don't leave fields undefined
      const prefs: Preferences = mergePreferences(settings.preferences)

      const lidarrClient =
        settings.lidarrUrl && settings.lidarrApiKey
          ? createLidarrClient(settings.lidarrUrl, settings.lidarrApiKey, settings.skipTlsVerify)
          : null

      // Per-user connections take precedence over global settings
      const { userConnections } = deps
      const lbUsername = userConnections?.listenbrainzUsername ?? settings.listenbrainzUsername
      const lbToken = userConnections?.listenbrainzToken ?? settings.listenbrainzToken
      const lfUsername = userConnections?.lastfmUsername ?? settings.lastfmUsername
      const lfApiKey = userConnections?.lastfmApiKey ?? settings.lastfmApiKey

      const registry = new SourceRegistry()
      if (lbUsername && lbToken) {
        registry.register(createListenBrainzSource(lbUsername, lbToken))
      }
      if (lfUsername && lfApiKey) {
        registry.register(createLastFmSource(lfUsername, lfApiKey))
      }

      // Spotify (OAuth -- token resolved before pipeline run)
      if (settings.spotifyAccessToken) {
        registry.register(createSpotifySource(settings.spotifyAccessToken))
      }

      // Plex
      const plexUrl = userConnections?.plexUrl
      const plexToken = userConnections?.plexToken
      if (plexUrl && plexToken) {
        registry.register(createPlexSource(plexUrl, plexToken))
      }

      // Jellyfin
      const jfUrl = userConnections?.jellyfinUrl
      const jfApiKey = userConnections?.jellyfinApiKey
      const jfUserId = userConnections?.jellyfinUserId
      if (jfUrl && jfApiKey && jfUserId) {
        registry.register(createJellyfinSource(jfUrl, jfApiKey, jfUserId, settings.skipTlsVerify))
      }

      // Discogs
      const dcToken = userConnections?.discogsToken
      const dcUsername = userConnections?.discogsUsername
      if (dcToken && dcUsername) {
        registry.register(createDiscogsSource(dcToken, dcUsername))
      }

      const aiProvider =
        providerRegistry && settings.aiProvider && settings.aiModel
          ? await providerRegistry.create(settings.aiProvider, {
              apiKey: settings.aiApiKey ?? null,
              model: settings.aiModel,
              baseUrl: settings.aiBaseUrl ?? null,
            })
          : null

      if (registry.all().length === 0 && !lidarrClient && !aiProvider) {
        throw new Error('At least one listening source or AI provider must be configured')
      }

      const mbClient = createMusicBrainzClient()

      this.emit('progress', { stage: 'collect', message: 'Fetching your Lidarr library...' })

      // Block-scope libraryArtists so the full array can be GC'd after we
      // extract what we need. For large libraries (2000+ artists) this is
      // the primary source of memory pressure.
      let libraryMbids: Set<string>
      let libraryGenres: string[]
      let librarySeeds: Array<{ mbid: string; name: string }>
      {
        const libraryArtists = await collect(lidarrClient)
        this.emit('progress', {
          stage: 'collect',
          message: `Found ${libraryArtists.length} artists in your library`,
        })
        libraryMbids = new Set(libraryArtists.map((a) => a.mbid))
        libraryGenres = [...new Set(libraryArtists.flatMap((a) => a.genres))]
        // discover() only needs mbid + name for seed selection
        librarySeeds = libraryArtists.map((a) => ({ mbid: a.mbid, name: a.name }))
        // libraryArtists goes out of scope here -- eligible for GC
      }

      const rejectedMbids = await db.getRejectedMbids(prefs.rejectionCooldownDays)
      const feedbackHistory = await db.getFeedbackHistory()

      this.emit('progress', { stage: 'analyze', message: 'Building your taste profile...' })
      const tasteProfile = await analyze(registry.all())
      this.emit('progress', {
        stage: 'analyze',
        message: `Profiled ${tasteProfile.topArtists.length} top artists, ${tasteProfile.topGenres.length} genres`,
      })

      this.emit('progress', {
        stage: 'discover',
        message: 'Finding similar artists from all sources...',
      })
      const discovered = await discover(
        tasteProfile,
        {
          listeningSources: registry.all(),
          musicbrainz: mbClient,
          ai: aiProvider,
        },
        prefs.topArtistsLimit,
        librarySeeds,
        prefs.librarySeedRatio ?? 0.3,
      )
      this.emit('progress', {
        stage: 'discover',
        message: `Discovered ${discovered.length} candidate artists`,
      })

      this.emit('progress', {
        stage: 'resolve',
        message: `Resolving ${discovered.length} artists via MusicBrainz...`,
      })
      const rawResolved = await resolve(
        discovered,
        mbClient,
        (progress) => {
          this.emit('progress', progress)
        },
        lidarrClient,
      )

      // Enrich sparse genres from artist_metadata (if available)
      const resolved = await enrichGenres(rawResolved, db.lookupArtistMetadata ?? null)

      this.emit('progress', {
        stage: 'score',
        message: `Scoring ${resolved.length} resolved artists...`,
      })
      const popularityMap = (await db.getPopularityMap?.()) ?? new Map<string, number>()
      const scored = score(
        resolved,
        libraryGenres,
        prefs.scoringWeights,
        feedbackHistory,
        popularityMap,
      )

      this.emit('progress', {
        stage: 'filter',
        message: `Filtering ${scored.length} scored artists...`,
      })
      const existingMbids = await db.getExistingRecommendationMbids(deps.userId)
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

      this.emit('progress', {
        stage: 'store',
        message: `Saving ${filtered.length} recommendations...`,
      })
      const batchId = await store(filtered, db, { userId: deps.userId })

      // Auto-approve if enabled
      if (prefs.autoApproveEnabled && deps.autoApproveDeps) {
        const autoConfig = {
          threshold: prefs.autoApproveThreshold ?? 0.8,
          monitorOption: (prefs.autoApproveMonitorOption ?? 'all') as 'all' | 'new' | 'none',
          qualityProfileId: prefs.qualityProfileId,
          metadataProfileId: prefs.metadataProfileId,
          rootFolderId: prefs.rootFolderId,
        }
        this.emit('progress', {
          stage: 'store',
          message: `Auto-approving above ${Math.round(autoConfig.threshold * 100)}%...`,
        })
        const autoResult = await autoApprove(batchId, autoConfig, deps.autoApproveDeps)
        if (autoResult.approved > 0 || autoResult.failed > 0) {
          console.log(`Auto-approve: ${autoResult.approved} added, ${autoResult.failed} failed`)
        }
      }

      // Fire-and-forget webhook notification
      const webhookUrl = prefs.webhookUrl
      if (webhookUrl) {
        sendWebhook(webhookUrl, {
          event: 'batch_complete',
          batchId,
          stats: { discovered: filtered.length, added: filtered.length, failed: 0 },
          message: `Scan complete: ${filtered.length} new recommendations found.`,
          timestamp: new Date().toISOString(),
        }).catch((err) => console.error('Webhook send failed:', err))
      }

      this.emit('progress', {
        stage: 'complete',
        message: `Done! ${filtered.length} new recommendations found.`,
      })
      return { batchId }
    } catch (err: unknown) {
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

  get currentUserId(): number | undefined {
    return this._currentUserId
  }
}
