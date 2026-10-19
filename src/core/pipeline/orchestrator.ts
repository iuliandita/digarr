import { EventEmitter } from 'node:events'
import { envConfig } from '@/config/env'
import type { AudioMuseConfig } from '@/core/clients/audiomuse'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { decryptChannelSecrets } from '@/core/crypto'
import type { SupportedLocale } from '@/core/i18n/locales'
import { createTranslator } from '@/core/i18n/translator'
import { recordFailureSafely } from '@/core/jobs/record-failure-safely'
import { normalizeAlbumTitle } from '@/core/library/normalize'
import { dispatch } from '@/core/notifications'
import { createAudioMuseSource, getAudioMuseConfig } from '@/core/plugins/audiomuse'
import { createDiscogsSource } from '@/core/plugins/discogs'
import { createEmbySource } from '@/core/plugins/emby'
import { createJellyfinSource } from '@/core/plugins/jellyfin'
import { createLastFmSource } from '@/core/plugins/lastfm'
import { createListenBrainzSource } from '@/core/plugins/listenbrainz'
import { createPlexSource } from '@/core/plugins/plex'
import { LISTENING_SOURCE_IDS, SourceRegistry } from '@/core/plugins/registry'
import { createSpotifySource } from '@/core/plugins/spotify'
import { createSubsonicSource } from '@/core/plugins/subsonic'
import type { AiProviderRegistry } from '@/core/providers/registry'
import type { DiscoveredArtist } from '@/core/types'
import { errMsg } from '@/core/validation'
import { type OwnedAlbumKeys, ownedAlbumTitleKey } from '@/db/queries/library-albums'
import type { UserConnections } from '@/db/queries/users'
import { mergePreferences, type Preferences } from '@/db/schema'
import { analyze } from './analyze'
import { type AutoApproveDeps, autoApprove } from './auto-approve'
import { PipelineCancelledError } from './cancel'
import { discover } from './discover'
import { enrichGenres } from './enrich'
import { filter } from './filter'
import { type GenreBackfillDb, hydrateArtistGenres, warmArtistGenres } from './genre-backfill'
import { createArtistImageClients } from './image-clients'
import { prefilterArtistCandidates, resolve } from './resolve'
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
  audiomuse?: AudioMuseConfig | null
  spotifyAccessToken?: string | null
  audiodbApiKey?: string | null
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
  responseLocale?: SupportedLocale
  promptLocale?: SupportedLocale | null
  librarySync: {
    syncForUser: (
      userId: number,
      options?: {
        force?: boolean
        onProgress?: (msg: string) => void
        t?: import('@/core/i18n/translator').Translator
      },
    ) => Promise<unknown>
  }
}

export type AlbumFilterSets = {
  blockedArtistMbids: Set<string>
  blockedAlbumKeys: Set<string>
  existingAlbumRgs: Set<string>
  owned?: OwnedAlbumKeys
}

/**
 * Pure predicate: should an album-kind candidate be dropped from the pipeline?
 * Drops when its artist is blocked (cascade), the album itself is blocked, or
 * the album release group is already recommended or already owned in the synced
 * library (by release-group MBID, else artist MBID + normalized title). No IO.
 */
export function shouldDropAlbumCandidate(
  candidate: { artistMbid: string; releaseGroupMbid: string; title?: string },
  sets: AlbumFilterSets,
): boolean {
  if (
    sets.blockedArtistMbids.has(candidate.artistMbid) ||
    sets.blockedAlbumKeys.has(candidate.releaseGroupMbid) ||
    sets.existingAlbumRgs.has(candidate.releaseGroupMbid)
  ) {
    return true
  }
  const owned = sets.owned
  if (!owned) return false
  if (owned.releaseGroupMbids.has(candidate.releaseGroupMbid)) return true
  return (
    candidate.title !== undefined &&
    owned.artistTitleKeys.has(
      ownedAlbumTitleKey(candidate.artistMbid, normalizeAlbumTitle(candidate.title)),
    )
  )
}

interface QueuedRun {
  userId: number | undefined
  deps: PipelineDeps
}

export type EnqueueResult = {
  status: 'started' | 'queued' | 'duplicate'
  position: number
}

export class PipelineOrchestrator extends EventEmitter {
  private running = false
  private currentStage: string | null = null
  private currentMessage: string | null = null
  private _currentUserId: number | undefined = undefined
  private queue: QueuedRun[] = []
  private abort: AbortController | null = null
  private runId = 0
  private activeRunId: number | null = null
  private completionCommitted = false

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === 'progress') {
      const progress = args[0] as { stage?: string; message?: string } | undefined
      if (progress?.stage) this.currentStage = progress.stage
      if (progress?.message) this.currentMessage = progress.message
      // Inject userId so SSE clients can filter events
      if (progress && !('userId' in progress) && this._currentUserId !== undefined) {
        ;(progress as Record<string, unknown>).userId = this._currentUserId
      }
    }
    return super.emit(eventName, ...args)
  }

  async run(deps: PipelineDeps): Promise<{ batchId: number }> {
    if (this.running) throw new Error('Pipeline already running')
    const myRunId = ++this.runId
    this.running = true
    this.completionCommitted = false
    this.activeRunId = myRunId
    this.abort = new AbortController()
    const signal = this.abort.signal
    this.currentStage = null
    this.currentMessage = null
    this._currentUserId = deps.userId

    // In-flight work drains before the next stage observes cancellation.
    const ckpt = () => {
      if (signal.aborted) throw new PipelineCancelledError()
    }

    let jobId: number | null = null
    let terminal: { stage: string; message: string; userId: number } | null = null

    const t = createTranslator(deps.responseLocale)

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

      const { audiodbClient, lidarrClient, fanartClient, musicinfoClient } =
        createArtistImageClients({
          settings,
          preferences: prefs,
          tryConsumeRateLimit: db.tryConsumeRateLimit,
        })

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

      // Spotify (OAuth - token resolved before pipeline run)
      if (settings.spotifyAccessToken) {
        registry.register(createSpotifySource(settings.spotifyAccessToken))
      }

      // Plex
      const plexUrl = userConnections?.plexUrl
      const plexToken = userConnections?.plexToken
      const plexSectionId = userConnections?.plexSectionId
      const plexAccountId = userConnections?.plexAccountId
      const plexMachineIdentifier = userConnections?.plexMachineIdentifier
      if (plexUrl && plexToken && plexSectionId && plexAccountId && plexMachineIdentifier) {
        registry.register(
          createPlexSource(plexUrl, plexToken, plexSectionId, plexAccountId, plexMachineIdentifier),
        )
      }

      // Jellyfin
      const jfUrl = userConnections?.jellyfinUrl
      const jfApiKey = userConnections?.jellyfinApiKey
      const jfUserId = userConnections?.jellyfinUserId
      if (jfUrl && jfApiKey && jfUserId) {
        registry.register(
          createJellyfinSource(
            jfUrl,
            jfApiKey,
            jfUserId,
            settings.skipTlsVerify,
            userConnections?.jellyfinLibraryId,
          ),
        )
      }

      // Emby
      const embyUrl = userConnections?.embyUrl
      const embyApiKey = userConnections?.embyApiKey
      const embyUserId = userConnections?.embyUserId
      if (embyUrl && embyApiKey && embyUserId) {
        registry.register(
          createEmbySource(
            embyUrl,
            embyApiKey,
            embyUserId,
            settings.skipTlsVerify,
            userConnections?.embyLibraryId,
          ),
        )
      }

      // Discogs
      const dcToken = userConnections?.discogsToken
      const dcUsername = userConnections?.discogsUsername
      if (dcToken && dcUsername) {
        registry.register(createDiscogsSource(dcToken, dcUsername))
      }

      // Subsonic (Navidrome, etc.)
      const subUrl = userConnections?.subsonicUrl
      const subUser = userConnections?.subsonicUsername
      const subPass = userConnections?.subsonicPassword
      if (subUrl && subUser && subPass) {
        registry.register(createSubsonicSource(subUrl, subUser, subPass, settings.skipTlsVerify))
      }

      const audiomuse =
        settings.audiomuse === undefined ? getAudioMuseConfig(prefs) : settings.audiomuse
      let audiomuseSkipReason: string | undefined

      const aiProvider =
        providerRegistry && settings.aiProvider && settings.aiModel
          ? await providerRegistry.create(settings.aiProvider, {
              apiKey: settings.aiApiKey ?? null,
              model: settings.aiModel,
              baseUrl: settings.aiBaseUrl ?? null,
              timeoutSeconds: envConfig.aiTimeoutSeconds ?? null,
            })
          : null

      if (
        !deps.explicitDiscoveryMode &&
        registry.all().length === 0 &&
        !lidarrClient &&
        !aiProvider &&
        !audiomuse
      ) {
        throw new Error('At least one listening source or AI provider must be configured')
      }

      if (
        deps.userId === undefined ||
        deps.librarySync === undefined ||
        typeof db.getLibraryArtistsForUser !== 'function' ||
        typeof db.userHasOwnSyncState !== 'function'
      ) {
        throw new Error(
          'Pipeline orchestrator requires librarySync, userId, and library StoreDb methods',
        )
      }

      const mbClient = createMusicBrainzClient()

      this.emit('progress', { stage: 'collect', message: t('pipeline.message.loadingLibrary') })

      const userIdForSync = deps.userId
      // Own states only: a global (userId=null) sync state must not mask a
      // user whose personal sources never synced, or their slow first sync
      // would run awaited instead of in the background.
      const hasOwnState = await db.userHasOwnSyncState(userIdForSync)
      if (!hasOwnState) {
        // First-sync detection: fire-and-forget so the pipeline doesn't hang
        // for the slow MB lookups on a fresh install.
        void deps.librarySync
          .syncForUser(userIdForSync)
          .catch((err: unknown) => console.error('[pipeline] first library sync failed:', err))
        this.emit('progress', {
          stage: 'collect',
          message: t('pipeline.message.firstSyncBackground'),
        })
      } else {
        await deps.librarySync.syncForUser(userIdForSync, {
          onProgress: (msg) => this.emit('progress', { stage: 'collect', message: msg }),
          t,
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

      const genreDb: GenreBackfillDb | null =
        db.getArtistGenreCacheByMbids &&
        db.getArtistGenreCacheByAliases &&
        db.upsertArtistGenres &&
        db.upsertArtistGenreAlias
          ? {
              getArtistGenreCacheByMbids: db.getArtistGenreCacheByMbids,
              getArtistGenreCacheByAliases: db.getArtistGenreCacheByAliases,
              upsertArtistGenres: db.upsertArtistGenres,
              upsertArtistGenreAlias: db.upsertArtistGenreAlias,
            }
          : null
      const genreLibraryArtists = genreDb
        ? await db.getLibraryArtistsForUser(userIdForSync)
        : libraryArtists

      const sourceCount = new Set(libraryArtists.map((a) => a.source)).size
      this.emit('progress', {
        stage: 'collect',
        message: t(
          sourceCount === 1
            ? 'pipeline.message.loadedLibrarySingular'
            : 'pipeline.message.loadedLibraryPlural',
          String(libraryMbids.size),
          String(sourceCount),
        ),
      })

      const rejectedMbids = await db.getRejectedMbids(prefs.rejectionCooldownDays, userIdForSync)
      const blockedMbids = await db.getBlockedMbids(userIdForSync)
      const feedbackHistory = await db.getFeedbackHistory(userIdForSync)

      if (audiomuse) {
        if (audiomuse.skipReason) {
          audiomuseSkipReason = audiomuse.skipReason
        } else {
          const allLibraryArtists = genreDb
            ? genreLibraryArtists
            : await db.getLibraryArtistsForUser(userIdForSync)
          const blockedNames = (await db.getBlockedArtistNames?.(userIdForSync)) ?? []
          try {
            registry.register(
              createAudioMuseSource(audiomuse, {
                excludedArtistNames: [
                  ...allLibraryArtists.map((artist) => artist.name),
                  ...blockedNames,
                ],
              }),
            )
          } catch {
            audiomuseSkipReason = 'invalid_url'
          }
        }
      }
      ckpt()
      this.emit('progress', { stage: 'analyze', message: t('pipeline.message.buildingProfile') })
      const tasteProfile = {
        ...(await analyze(
          registry.all(),
          genreDb
            ? {
                genreHydrator: (artists) =>
                  hydrateArtistGenres(artists, genreDb, genreLibraryArtists),
              }
            : {},
        )),
        responseLocale: deps.responseLocale,
        promptLocale: deps.promptLocale ?? null,
      }
      this.emit('progress', {
        stage: 'analyze',
        message: t(
          'pipeline.message.profiled',
          String(tasteProfile.topArtists.length),
          String(tasteProfile.topGenres.length),
        ),
      })

      ckpt()
      this.emit('progress', {
        stage: 'discover',
        message: t('pipeline.message.findingSimilar'),
      })
      const discoverFailures = new Map<string, string>()
      let discoverySeedCount = 0
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
          onSourceFailure: (sourceId, error) => discoverFailures.set(sourceId, error),
          onSeedCount: (count) => {
            discoverySeedCount = count
          },
        },
      )
      const aiFailure = discoverFailures.get('ai')
      if (aiFailure) {
        this.emit('progress', {
          stage: 'discover',
          message: t('pipeline.message.aiSourceFailed', aiFailure),
        })
      }
      this.emit('progress', {
        stage: 'discover',
        message: t('pipeline.message.discovered', String(discovered.length)),
      })

      // Collect per-source results for job recording
      const sourceResults: Record<string, import('@/core/jobs/types').SourceResult> = {}

      // Mark unconfigured sources as skipped
      for (const id of LISTENING_SOURCE_IDS) {
        if (id !== 'audiomuse' && !registry.all().some((s) => s.id === id)) {
          sourceResults[id] = { status: 'skipped', reason: 'not_configured' }
        }
      }
      if (audiomuseSkipReason) {
        sourceResults.audiomuse = { status: 'skipped', reason: `audiomuse_${audiomuseSkipReason}` }
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
          const failure = discoverFailures.get(source.id)
          const summary = source.getDiscoverySummary?.()
          const hasResults = count > 0 || (summary?.seedsWithResults ?? 0) > 0
          sourceResults[source.id] = !source.capabilities.includes('similarArtists')
            ? { status: 'skipped', reason: 'unsupported_capability' }
            : deps.explicitDiscoveryMode != null
              ? { status: 'skipped', reason: 'explicit_run' }
              : failure !== undefined
                ? source.id === 'audiomuse'
                  ? {
                      status: hasResults ? 'ok' : 'skipped',
                      artists: count,
                      ...(hasResults
                        ? {}
                        : { reason: `audiomuse_${failure.replace('AudioMuse-AI: ', '')}` }),
                    }
                  : { status: 'error', artists: count, error: failure }
                : discoverySeedCount === 0
                  ? { status: 'skipped', reason: 'no_seeds' }
                  : { status: 'ok', artists: count }
          if (
            source.id === 'audiomuse' &&
            deps.explicitDiscoveryMode == null &&
            discoverySeedCount > 0
          ) {
            const result = sourceResults[source.id]
            if (result) Object.assign(result, summary)
          }
        }
      }
      if (aiProvider) {
        const aiCount = sourceArtistCounts.get('ai') ?? 0
        sourceResults.ai =
          aiCount > 0
            ? { status: 'ok', artists: aiCount }
            : { status: 'error', error: aiFailure ?? 'No artists returned' }
      }

      ckpt()
      this.emit('progress', {
        stage: 'resolve',
        message: t('pipeline.message.resolving', String(discovered.length)),
      })
      const existingBeforeResolve = await db.getExistingRecommendationMbids(deps.userId, {
        rejectionCooldownDays: prefs.rejectionCooldownDays,
      })
      const excludedBeforeResolve = new Set([
        ...libraryMbids,
        ...rejectedMbids,
        ...blockedMbids,
        ...existingBeforeResolve,
      ])
      for (const artist of tasteProfile.topArtists) {
        if (artist.mbid) excludedBeforeResolve.add(artist.mbid)
      }
      const rawResolved = await resolve(
        prefilterArtistCandidates(
          discovered,
          excludedBeforeResolve,
          prefs.netNewAlbumDiscovery ?? false,
        ),
        mbClient,
        (progress) => {
          this.emit('progress', progress)
        },
        lidarrClient,
        fanartClient,
        musicinfoClient,
        t,
        audiodbClient,
        prefs.netNewAlbumDiscovery ?? false,
        signal,
        new Set(
          discovered.filter((d) => d.mbid && !d.releaseGroupMbid).map((d) => d.mbid as string),
        ),
      )

      // Enrich sparse genres from artist_metadata (if available)
      const resolved = await enrichGenres(rawResolved, db.lookupArtistMetadata ?? null)

      ckpt()
      this.emit('progress', {
        stage: 'score',
        message: t('pipeline.message.scoring', String(resolved.length)),
      })
      const popularityMap =
        (await db.getPopularityMap?.(resolved.map((artist) => artist.name))) ??
        new Map<string, number>()
      const referenceGenres =
        libraryGenres.length > 0 ? libraryGenres : tasteProfile.topGenres.map((g) => g.name)
      const scored = score(
        resolved,
        referenceGenres,
        prefs.scoringWeights,
        feedbackHistory,
        popularityMap,
      )

      ckpt()
      this.emit('progress', {
        stage: 'filter',
        message: t('pipeline.message.filtering', String(scored.length)),
      })
      const existingMbids = await db.getExistingRecommendationMbids(deps.userId, {
        rejectionCooldownDays: prefs.rejectionCooldownDays,
      })
      for (const mbid of existingMbids) {
        libraryMbids.add(mbid)
      }

      // Album-aware block/dedup sets. Album-kind candidates flow through this
      // stage to drop blocked albums and ones already in the library. Guarded so
      // partial StoreDb mocks without these optional methods still work.
      const albumSets: AlbumFilterSets = {
        blockedArtistMbids: blockedMbids,
        blockedAlbumKeys: (await db.getBlockedAlbumKeys?.(deps.userId)) ?? new Set<string>(),
        existingAlbumRgs:
          (await db.getExistingAlbumReleaseGroupMbids?.(deps.userId, {
            rejectionCooldownDays: prefs.rejectionCooldownDays,
          })) ?? new Set<string>(),
        owned: deps.userId !== undefined ? await db.getOwnedAlbumKeys?.(deps.userId) : undefined,
      }
      const albumAware = scored.filter((c) => {
        // Not an album candidate -> keep; the artist filter path handles it.
        if (c.kind !== 'album' || !c.releaseGroupMbid) return true
        return !shouldDropAlbumCandidate(
          {
            artistMbid: c.mbid,
            releaseGroupMbid: c.releaseGroupMbid,
            title: c.suggestedAlbum?.title,
          },
          albumSets,
        )
      })

      // Also exclude top artists from listening history - the AI prompt asks
      // models to skip these, but smaller models ignore the instruction.
      const topArtistNames = new Set<string>()
      for (const artist of tasteProfile.topArtists) {
        topArtistNames.add(artist.name.toLowerCase())
        if (artist.mbid) libraryMbids.add(artist.mbid)
      }

      // Album-kind candidates bypass the artist-existence filters (library /
      // top-artists): release-radar targets artists you already track, so those
      // filters would drop every album. They already passed the album block/dedup
      // layer above; here they only face the score threshold. Artist-kind
      // candidates take the full artist filter unchanged.
      const albumKind = albumAware.filter((c) => c.kind === 'album' && c.releaseGroupMbid)
      const artistKind = albumAware.filter((c) => !(c.kind === 'album' && c.releaseGroupMbid))

      const filteredArtists = filter(
        artistKind,
        libraryMbids,
        rejectedMbids,
        blockedMbids,
        prefs.rejectionCooldownDays,
        prefs.scoreThreshold,
        topArtistNames,
      )
      const filteredAlbums = albumKind.filter((c) => c.score >= prefs.scoreThreshold)
      const filtered = [...filteredArtists, ...filteredAlbums]

      ckpt()
      this.emit('progress', {
        stage: 'store',
        message: t('pipeline.message.saving', String(filtered.length)),
      })
      const batchId = await store(filtered, db, {
        userId: deps.userId,
        subscriptionId: deps.subscriptionId,
        signal,
      })
      ckpt()

      // Auto-approve if enabled
      if (prefs.autoApproveEnabled && deps.autoApproveDeps) {
        const autoConfig = {
          threshold: prefs.autoApproveThreshold ?? 0.8,
          monitorOption: prefs.autoApproveMonitorOption ?? 'all',
        }
        this.emit('progress', {
          stage: 'store',
          message: t(
            'pipeline.message.autoApproving',
            String(Math.round(autoConfig.threshold * 100)),
          ),
        })
        const autoResult = await autoApprove(batchId, autoConfig, deps.autoApproveDeps, signal)
        if (autoResult.approved > 0 || autoResult.failed > 0) {
          console.log(`Auto-approve: ${autoResult.approved} added, ${autoResult.failed} failed`)
        }
      }

      ckpt()
      this.completionCommitted = true

      if (jobId != null && deps.jobRecorder) {
        await deps.jobRecorder.complete(jobId, {
          metadata: {
            trigger: deps.trigger ?? 'manual',
            artistsDiscovered: scored.length,
            artistsStored: filtered.length,
            artistsFiltered: scored.length - filtered.length,
            ...(tasteProfile.genreCoverage ? { genreCoverage: tasteProfile.genreCoverage } : {}),
            ...(aiProvider?.lastUsage ? { aiUsage: aiProvider.lastUsage } : {}),
          },
          sourceResults,
          batchId,
        })
      }

      dispatch(decryptChannelSecrets(prefs.channels ?? []), 'batch_complete', {
        event: 'batch_complete',
        batchId,
        stats: { discovered: scored.length, added: filtered.length, failed: 0 },
        message: t('pipeline.message.scanComplete', String(filtered.length)),
        timestamp: new Date().toISOString(),
      }).catch((err) => console.error('Notification dispatch failed:', err))

      if (genreDb) {
        const lastfm = registry.all().find((source) => source.id === 'lastfm')
        void warmArtistGenres(tasteProfile.topArtists, {
          db: genreDb,
          musicbrainz: mbClient,
          ...(lastfm?.getArtistGenres
            ? { lastfm: { getArtistGenres: lastfm.getArtistGenres.bind(lastfm) } }
            : {}),
        }).catch((error: unknown) =>
          console.error('[genre-backfill] background warm failed:', errMsg(error)),
        )
      }

      terminal = {
        stage: 'complete',
        message: t('pipeline.message.done', String(filtered.length)),
        userId: deps.userId,
      }
      return { batchId }
    } catch (err: unknown) {
      const cancelled = err instanceof PipelineCancelledError
      if (jobId != null && deps.jobRecorder) {
        if (cancelled) {
          try {
            await deps.jobRecorder.cancel(jobId)
          } catch (e) {
            const failure = new AggregateError([err, e], 'Failed to record pipeline cancellation')
            await recordFailureSafely(deps.jobRecorder, jobId, errMsg(failure))
            this.emit('error', failure)
            throw failure
          }
        } else {
          await recordFailureSafely(deps.jobRecorder, jobId, errMsg(err))
        }
      }
      if (cancelled) {
        // Terminal, non-error stop: SSE closes cleanly and the UI shows "stopped".
        terminal = {
          stage: 'cancelled',
          message: t('pipeline.message.cancelled'),
          userId: deps.userId,
        }
        throw err
      }
      this.emit('error', err)
      throw err
    } finally {
      if (this.activeRunId === myRunId) {
        this.running = false
        this.abort = null
        this.activeRunId = null
        // Drop the userId so subsequent non-pipeline emits don't inherit a stale owner
        this._currentUserId = undefined
        this.completionCommitted = false
        if (terminal) this.emit('progress', terminal)
        this.drainQueue()
      }
    }
  }

  /**
   * Start a run now, or queue it FIFO behind the in-flight one. Single-flight is
   * preserved (one pipeline at a time, shared API/RAM budgets); a busy caller is
   * parked instead of rejected. Deduped per userId so a double-click doesn't
   * stack two runs.
   */
  enqueue(deps: PipelineDeps): EnqueueResult {
    if (!this.running) {
      this.startRun(deps)
      return { status: 'started', position: 0 }
    }
    if (this._currentUserId === deps.userId) return { status: 'duplicate', position: 0 }
    const existing = this.queue.findIndex((q) => q.userId === deps.userId)
    if (existing >= 0) return { status: 'duplicate', position: existing + 1 }
    this.queue.push({ userId: deps.userId, deps })
    return { status: 'queued', position: this.queue.length }
  }

  private startRun(deps: PipelineDeps): void {
    this.run(deps).catch((err: unknown) => {
      if (err instanceof PipelineCancelledError) return
      console.error('[orchestrator] queued run failed:', err)
    })
  }

  /**
   * Stop at a safe boundary after in-flight writes and their bookkeeping settle.
   * Drops only the caller's queued runs; the in-flight run stops only for its
   * owner or with `canStopOthers` (admin). `forbidden` means nothing was allowed.
   */
  cancel(
    userId: number | undefined,
    { canStopOthers = false }: { canStopOthers?: boolean } = {},
  ): { cancelled: boolean; dequeued: number; forbidden: boolean } {
    const before = this.queue.length
    this.queue = this.queue.filter((q) => q.userId !== userId)
    const dequeued = before - this.queue.length
    if (!this.running) return { cancelled: false, dequeued, forbidden: false }
    if (!canStopOthers && this._currentUserId !== userId) {
      return { cancelled: false, dequeued, forbidden: dequeued === 0 }
    }
    if (this.completionCommitted) return { cancelled: false, dequeued, forbidden: false }
    this.abort?.abort()
    return { cancelled: true, dequeued, forbidden: false }
  }

  private drainQueue(): void {
    if (this.running) return
    const next = this.queue.shift()
    if (next) this.startRun(next.deps)
  }

  get isRunning(): boolean {
    return this.running
  }

  get queueLength(): number {
    return this.queue.length
  }

  /** 1-based position of userId in the queue; 0 if running or not queued. */
  queuePositionFor(userId: number | undefined): number {
    const i = this.queue.findIndex((q) => q.userId === userId)
    return i >= 0 ? i + 1 : 0
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
