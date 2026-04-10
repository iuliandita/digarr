import { EventEmitter } from 'node:events'
import { createFanartClient } from '@/core/clients/fanart'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { createMusicinfoClient } from '@/core/clients/musicinfo'
import { decryptField } from '@/core/crypto'
import { sendWebhook } from '@/core/notifications'
import { createDiscogsSource } from '@/core/plugins/discogs'
import { createEmbySource } from '@/core/plugins/emby'
import { createJellyfinSource } from '@/core/plugins/jellyfin'
import { createLastFmSource } from '@/core/plugins/lastfm'
import { createListenBrainzSource } from '@/core/plugins/listenbrainz'
import { createPlexSource } from '@/core/plugins/plex'
import { SourceRegistry } from '@/core/plugins/registry'
import { createSpotifySource } from '@/core/plugins/spotify'
import type { AiProviderRegistry } from '@/core/providers/registry'
import type { DiscoveredArtist } from '@/core/types'
import { errMsg } from '@/core/validation'
import type { UserConnections } from '@/db/queries/users'
import { mergePreferences, type Preferences } from '@/db/schema'
import { analyze } from './analyze'
import { type AutoApproveDeps, autoApprove } from './auto-approve'
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
  userId: number
  subscriptionId?: number
  providerRegistry?: AiProviderRegistry
  userConnections?: UserConnections | null
  autoApproveDeps?: AutoApproveDeps | null
  jobRecorder?: import('@/core/jobs/types').JobRecorder
  trigger?: 'scheduled' | 'manual'
  explicitCandidates?: DiscoveredArtist[]
  explicitDiscoveryMode?: {
    modeId: string
    settingsMode: 'easy' | 'advanced'
    providerPath: string[]
  }
  librarySync: {
    syncForUser: (
      userId: number,
      options?: { force?: boolean; onProgress?: (msg: string) => void },
    ) => Promise<unknown>
  }
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

    let jobId: number | null = null

    try {
      const { db, settings, providerRegistry } = deps
      // Merge with defaults so partially-saved preferences don't leave fields undefined
      const prefs: Preferences = mergePreferences(settings.preferences)

      if (deps.jobRecorder) {
        try {
          jobId = await deps.jobRecorder.start({
            type: 'pipeline',
            userId: deps.userId,
            metadata: { trigger: deps.trigger ?? 'manual' },
          })
        } catch (err) {
          console.error('[pipeline] Failed to record job start:', err)
        }
      }

      const lidarrClient =
        settings.lidarrUrl && settings.lidarrApiKey
          ? createLidarrClient(settings.lidarrUrl, settings.lidarrApiKey, settings.skipTlsVerify)
          : null

      const fanartApiKey = decryptField(prefs.fanartApiKey) ?? null
      const fanartClient = fanartApiKey ? createFanartClient(fanartApiKey) : null

      const musicinfoClient = prefs.metadataFallbackUrl
        ? createMusicinfoClient(prefs.metadataFallbackUrl)
        : null

      // Listening connections are always user-scoped.
      const { userConnections } = deps
      const lbUsername = userConnections?.listenbrainzUsername ?? null
      const lbToken = userConnections?.listenbrainzToken ?? null
      const lfUsername = userConnections?.lastfmUsername ?? null
      const lfApiKey = userConnections?.lastfmApiKey ?? null

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

      // Emby
      const embyUrl = userConnections?.embyUrl
      const embyApiKey = userConnections?.embyApiKey
      const embyUserId = userConnections?.embyUserId
      if (embyUrl && embyApiKey && embyUserId) {
        registry.register(createEmbySource(embyUrl, embyApiKey, embyUserId, settings.skipTlsVerify))
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

      if (
        !deps.explicitDiscoveryMode &&
        registry.all().length === 0 &&
        !lidarrClient &&
        !aiProvider
      ) {
        throw new Error('At least one listening source or AI provider must be configured')
      }

      if (
        deps.userId === undefined ||
        deps.librarySync === undefined ||
        typeof db.getLibraryArtistsForUser !== 'function' ||
        typeof db.userHasAnySyncState !== 'function'
      ) {
        throw new Error(
          'Pipeline orchestrator requires librarySync, userId, and library StoreDb methods',
        )
      }

      const mbClient = createMusicBrainzClient()

      this.emit('progress', { stage: 'collect', message: 'Loading your library...' })

      const userIdForSync = deps.userId
      const hasAnyState = await db.userHasAnySyncState(userIdForSync)
      if (!hasAnyState) {
        // First-sync detection: fire-and-forget so the pipeline doesn't hang
        // for the slow MB lookups on a fresh install.
        void deps.librarySync
          .syncForUser(userIdForSync)
          .catch((err: unknown) => console.error('[pipeline] first library sync failed:', err))
        this.emit('progress', {
          stage: 'collect',
          message: 'First library sync running in background -- proceeding without it',
        })
      } else {
        await deps.librarySync.syncForUser(userIdForSync, {
          onProgress: (msg) => this.emit('progress', { stage: 'collect', message: msg }),
        })
      }

      const libraryArtists = await db.getLibraryArtistsForUser(userIdForSync, {
        onlyReconciled: true,
      })
      const libraryMbids = new Set(
        libraryArtists.map((a) => a.mbid).filter((m): m is string => m !== null),
      )
      const libraryGenres = [...new Set(libraryArtists.flatMap((a) => a.genres ?? []))]
      const librarySeeds = libraryArtists
        .filter((a): a is typeof a & { mbid: string } => a.mbid !== null)
        .map((a) => ({ mbid: a.mbid, name: a.name }))

      const sourceCount = new Set(libraryArtists.map((a) => a.source)).size
      this.emit('progress', {
        stage: 'collect',
        message: `Loaded ${libraryMbids.size} library artists across ${sourceCount} source${sourceCount === 1 ? '' : 's'}`,
      })

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
        {
          explicitCandidates: deps.explicitCandidates,
          explicitRun: deps.explicitDiscoveryMode != null,
        },
      )
      this.emit('progress', {
        stage: 'discover',
        message: `Discovered ${discovered.length} candidate artists`,
      })

      // Collect per-source results for job recording
      const sourceResults: Record<string, import('@/core/jobs/types').SourceResult> = {}

      // Mark unconfigured sources as skipped
      const knownSourceIds = [
        'listenbrainz',
        'lastfm',
        'spotify',
        'plex',
        'jellyfin',
        'emby',
        'discogs',
      ]
      for (const id of knownSourceIds) {
        if (!registry.all().some((s) => s.id === id)) {
          sourceResults[id] = { status: 'skipped', reason: 'not_configured' }
        }
      }
      if (!aiProvider) {
        sourceResults.ai = { status: 'skipped', reason: 'not_configured' }
      }

      // Tally source contributions from discovered artists
      const sourceArtistCounts = new Map<string, number>()
      for (const d of discovered) {
        const src = d.source ?? 'unknown'
        sourceArtistCounts.set(src, (sourceArtistCounts.get(src) ?? 0) + 1)
      }
      for (const source of registry.all()) {
        if (!sourceResults[source.id]) {
          const count = sourceArtistCounts.get(source.id) ?? 0
          sourceResults[source.id] =
            count > 0
              ? { status: 'ok', artists: count }
              : { status: 'error', error: 'No artists returned' }
        }
      }
      if (aiProvider) {
        const aiCount = sourceArtistCounts.get('ai') ?? 0
        sourceResults.ai =
          aiCount > 0
            ? { status: 'ok', artists: aiCount }
            : { status: 'error', error: 'No artists returned' }
      }

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
        fanartClient,
        musicinfoClient,
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

      // Also exclude top artists from listening history -- the AI prompt asks
      // models to skip these, but smaller models ignore the instruction.
      const topArtistNames = new Set<string>()
      for (const artist of tasteProfile.topArtists) {
        topArtistNames.add(artist.name.toLowerCase())
        if (artist.mbid) libraryMbids.add(artist.mbid)
      }

      const filtered = filter(
        scored,
        libraryMbids,
        rejectedMbids,
        prefs.rejectionCooldownDays,
        prefs.scoreThreshold,
        topArtistNames,
      )

      this.emit('progress', {
        stage: 'store',
        message: `Saving ${filtered.length} recommendations...`,
      })
      const batchId = await store(filtered, db, {
        userId: deps.userId,
        subscriptionId: deps.subscriptionId,
      })

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
          stats: { discovered: scored.length, added: filtered.length, failed: 0 },
          message: `Scan complete: ${filtered.length} new recommendations found.`,
          timestamp: new Date().toISOString(),
        }).catch((err) => console.error('Webhook send failed:', err))
      }

      this.emit('progress', {
        stage: 'complete',
        message: `Done! ${filtered.length} new recommendations found.`,
      })

      if (jobId != null && deps.jobRecorder) {
        await deps.jobRecorder.complete(jobId, {
          metadata: {
            trigger: deps.trigger ?? 'manual',
            artistsDiscovered: scored.length,
            artistsStored: filtered.length,
            artistsFiltered: scored.length - filtered.length,
          },
          sourceResults,
          batchId,
        })
      }

      return { batchId }
    } catch (err: unknown) {
      if (jobId != null && deps.jobRecorder) {
        await deps.jobRecorder.fail(jobId, errMsg(err)).catch(() => {})
      }
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
