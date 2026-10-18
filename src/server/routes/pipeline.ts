import { Hono } from 'hono'
import { envConfig } from '@/config/env'
import { requiresApprovalRequest } from '@/core/approvals/policy'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import {
  buildDiscoveryModeExecutionContext,
  EMPTY_DISCOVERY_SNAPSHOT,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import { prepareDiscoveryModeRequest } from '@/core/discovery-modes/prepare'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import { normalizeDiscoveryModeRequest } from '@/core/discovery-modes/request'
import { buildDiscoveryModeJobMetadata } from '@/core/discovery-modes/run'
import { detectPromptLocale } from '@/core/i18n/prompt-locale'
import { recordFailureSafely } from '@/core/jobs/record-failure-safely'
import type { AutoApproveDeps } from '@/core/pipeline/auto-approve'
import { filter } from '@/core/pipeline/filter'
import { createArtistImageClients } from '@/core/pipeline/image-clients'
import type { PipelineDeps } from '@/core/pipeline/orchestrator'
import { fetchArtistImage, resolve } from '@/core/pipeline/resolve'
import { score } from '@/core/pipeline/score'
import { store } from '@/core/pipeline/store'
import { resolveProviderToken } from '@/core/provider-auth'
import type { ScoredArtist } from '@/core/types'
import { errMsg, logAndSanitize } from '@/core/validation'
import { upsertArtist } from '@/db/queries/artists'
import { getUserConnections } from '@/db/queries/users'
import { mergePreferences } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { notAuthenticated } from '@/server/helpers/auth-problems'
import { resolveUserPreferences } from '@/server/helpers/preferences'
import { problem } from '@/server/helpers/problem'
import { resolveRequestLocale } from '@/server/locale'
import { adminGuard, resolveAdmin } from '@/server/middleware/admin-guard'
import { discoveryModeRunSchema, quickDiscoverSchema } from '@/server/schemas/pipeline'
import { zJson } from '@/server/schemas/validator'
import { createPipelineSSEStream } from '@/server/sse'
import type { HonoEnv } from '@/server/types'

let rescanRunning = false

export function pipelineRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()
  // Intentionally NOT admin-gated: "Run Scan" is a core regular-user action,
  // reachable from the dashboard (TodaysPick) and discover surfaces. Any
  // authenticated user may start a run; single-flight is preserved by the
  // orchestrator, so the blast radius is one in-flight pipeline regardless of
  // caller. A run requested while one is in progress is queued, not rejected.
  router.post('/api/v1/pipeline/run', async (c) => {
    const settings = await deps.getSettings()
    if (!settings) {
      return c.json({ error: 'Settings not found' }, 400)
    }

    const userId = c.get('userId')
    const user = userId ? await deps.getUserById(userId) : null
    const userConnections = userId ? await getUserConnections(deps.db, userId) : null
    const responseLocale = resolveRequestLocale({
      userPreferredLocale: user?.preferredLocale,
      requestLocale: c.req.header('X-Digarr-Locale'),
      acceptLanguage: c.req.header('Accept-Language'),
    })

    // Resolve Spotify OAuth token if connected
    let spotifyAccessToken: string | null = null
    if (userId) {
      try {
        spotifyAccessToken = await resolveProviderToken(deps.db, userId, 'spotify')
      } catch {
        // Best-effort - continue without Spotify
      }
    }

    // Read per-user preferences, fallback to global
    const userPreferences = await resolveUserPreferences(
      async () => user,
      settings.preferences,
      userId,
    )

    // Build auto-approve deps - closures capture userId for per-user target lookup
    const autoApproveDeps: AutoApproveDeps = {
      getRecommendationsByBatch: async (batchId) => {
        const result = await deps.listRecommendations({ batchId, limit: 1000 })
        return result.items.map((r) => ({
          id: r.id,
          score: r.score,
          status: r.status,
          kind: r.kind,
          recommendedReleaseGroupId: r.recommendedReleaseGroupId,
          artist: { mbid: r.artist.mbid, name: r.artist.name },
        }))
      },
      getEnabledTargets: () =>
        userId ? deps.getEnabledTargetsForUser(userId) : Promise.resolve([]),
      userId,
      ...(user && user.approvalPolicy !== 'direct'
        ? { canApprove: async (score: number) => !requiresApprovalRequest(user, score) }
        : {}),
      updateRecommendationStatus: (id, status, extra) =>
        deps.updateRecommendationStatus(id, status, extra),
      warmArtist: deps.skyhookWarmer
        ? (
            (warmer) => (mbid: string) =>
              warmer.warm(mbid)
          )(deps.skyhookWarmer)
        : undefined,
    }

    // Start now, or queue behind the in-flight run (single-flight preserved).
    const enqueued = deps.orchestrator.enqueue({
      db: deps.storeDb,
      settings: { ...settings, preferences: userPreferences, spotifyAccessToken },
      userId,
      providerRegistry: deps.providerRegistry,
      userConnections,
      autoApproveDeps,
      librarySync: deps.librarySync,
      jobRecorder: deps.jobRecorder,
      trigger: 'manual',
      responseLocale,
      promptLocale: null,
    } as unknown as PipelineDeps)

    // Surface the real enqueue outcome. A same-user re-submit during an
    // in-flight run is a no-op 'duplicate' and must not masquerade as a fresh
    // 'queued' run at position 0.
    const message =
      enqueued.status === 'started'
        ? 'Pipeline started'
        : enqueued.status === 'duplicate'
          ? 'Pipeline already running'
          : 'Pipeline queued'
    return c.json(
      {
        message,
        status: enqueued.status,
        queued: enqueued.status === 'queued',
        position: enqueued.position,
      },
      202,
    )
  })

  // The current write and its bookkeeping drain before the pipeline stops.
  router.post('/api/v1/pipeline/cancel', async (c) => {
    const userId = c.get('userId')
    const isAdmin = await resolveAdmin(c, deps.getUserById)
    const result = deps.orchestrator.cancel(userId, { canStopOthers: isAdmin })
    if (result.forbidden) {
      return problem(
        c,
        'pipeline-cancel-forbidden',
        'Only the user who started this run or an admin can stop it',
        403,
      )
    }
    return c.json(
      {
        cancelled: result.cancelled,
        message: result.cancelled
          ? 'Pipeline stopping'
          : deps.orchestrator.isRunning
            ? 'Pipeline finishing'
            : 'No pipeline run in progress',
      },
      202,
    )
  })

  router.post('/api/v1/discovery-modes/run', zJson(discoveryModeRunSchema), async (c) => {
    if (deps.orchestrator.isRunning) {
      return problem(
        c,
        'pipeline-already-running',
        'A pipeline run is already in progress',
        409,
        undefined,
        undefined,
        'errors.pipeline.alreadyRunning',
      )
    }

    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
    }
    if (!deps.discoveryModeRegistry || !deps.runDiscoveryMode) {
      return c.json({ error: 'Discovery mode execution is not configured' }, 500)
    }

    try {
      const body = c.req.valid('json')
      const request = normalizeDiscoveryModeRequest(userId, body, deps.discoveryModeRegistry)
      const preparedRequest = await prepareDiscoveryModeRequest(request, deps.discoveryModeRegistry)
      const snapshot = await (deps.getDiscoveryConnectionSnapshot?.(userId) ??
        Promise.resolve(EMPTY_DISCOVERY_SNAPSHOT))
      const availability = evaluateDiscoveryModeAvailability(preparedRequest.modeId, snapshot)
      if (!availability.enabled) {
        return c.json({ error: availability.reason ?? 'This mode is unavailable.' }, 400)
      }
      const executionContext = buildDiscoveryModeExecutionContext(availability)
      const executableRequest: DiscoveryModeRequest = {
        ...preparedRequest,
        providerContext: executionContext.providerContext,
        fallbackPolicy: executionContext.fallbackPolicy,
      }
      const jobId = await deps.jobRecorder.start({
        type: 'quick_discover',
        userId,
        metadata: buildDiscoveryModeJobMetadata(executableRequest),
      })

      deps.runDiscoveryMode(executableRequest, { existingJobId: jobId }).catch((err: unknown) => {
        console.error('Discovery mode run failed:', err)
      })

      return c.json({ message: 'Discovery run started', jobId }, 202)
    } catch (err: unknown) {
      return c.json({ error: logAndSanitize(err, 'discovery-mode') }, 400)
    }
  })

  router.get('/api/v1/pipeline/status', async (c) => {
    const userId = c.get('userId')
    const isAdmin = await resolveAdmin(c, deps.getUserById)
    const queuePosition = userId ? deps.orchestrator.queuePositionFor(userId) : 0
    // Non-admins see only their own run and queue entry; batches carry no owner.
    const ownRun = deps.orchestrator.isRunning && deps.orchestrator.currentUserId === userId
    const lastBatch = isAdmin ? await deps.getLastBatch() : null
    return c.json({
      running: isAdmin ? deps.orchestrator.isRunning : ownRun,
      stage: isAdmin || ownRun ? deps.orchestrator.stage : null,
      message: isAdmin || ownRun ? deps.orchestrator.stageMessage : null,
      queueLength: isAdmin ? deps.orchestrator.queueLength : queuePosition > 0 ? 1 : 0,
      queuePosition,
      lastRun: lastBatch
        ? {
            batchId: lastBatch.id,
            completedAt: lastBatch.createdAt,
            status: lastBatch.status,
          }
        : undefined,
    })
  })

  router.get('/api/v1/pipeline/events', (c) => {
    const stream = createPipelineSSEStream(deps.orchestrator, c.get('userId'))
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  })

  // Quick discover: find similar artists to a specific artist
  router.post('/api/v1/pipeline/quick-discover', zJson(quickDiscoverSchema), async (c) => {
    if (deps.orchestrator.isRunning) {
      return problem(
        c,
        'pipeline-already-running',
        'A pipeline run is already in progress',
        409,
        undefined,
        undefined,
        'errors.pipeline.alreadyRunning',
      )
    }

    const { artistName } = c.req.valid('json')
    const trimmedArtistName = artistName

    const settings = await deps.getSettings()
    if (!settings) {
      return c.json({ error: 'Settings not found' }, 400)
    }

    const quickDiscoverUserId = c.get('userId')
    const quickDiscoverUser = quickDiscoverUserId
      ? await deps.getUserById(quickDiscoverUserId)
      : null
    const quickDiscoverUserConns = quickDiscoverUserId
      ? await getUserConnections(deps.db, quickDiscoverUserId)
      : null
    const uiLocale = resolveRequestLocale({
      userPreferredLocale: quickDiscoverUser?.preferredLocale,
      requestLocale: c.req.header('X-Digarr-Locale'),
      acceptLanguage: c.req.header('Accept-Language'),
    })
    const promptLocale = detectPromptLocale(trimmedArtistName)
    const responseLocale = uiLocale

    const lastfmApiKey = quickDiscoverUserConns?.lastfmApiKey ?? null
    const lastfmUsername = quickDiscoverUserConns?.lastfmUsername ?? ''

    // Fire-and-forget a focused pipeline run with just this artist as seed
    ;(async () => {
      const jobRecorder = deps.jobRecorder
      let jobId: number | null = null
      if (jobRecorder) {
        try {
          jobId = await jobRecorder.start({
            type: 'quick_discover',
            userId: quickDiscoverUserId,
            metadata: { seedArtist: trimmedArtistName },
          })
        } catch (err) {
          console.error('[quick-discover] Failed to record job start:', err)
        }
      }
      try {
        const lidarrUrl = settings.lidarrUrl as string | null
        const lidarrApiKey = settings.lidarrApiKey as string | null
        const lidarr =
          lidarrUrl && lidarrApiKey
            ? createLidarrClient(
                lidarrUrl,
                lidarrApiKey,
                (settings.skipTlsVerify as boolean) ?? false,
              )
            : null
        const mb = createMusicBrainzClient()

        // Get library MBIDs. Quick-discover prioritizes speed over freshness:
        // we read from the cache without triggering a sync. The background scheduler
        // keeps the cache fresh; an empty cache means no dedup (matches the old behavior).
        let libraryMbids: Set<string>
        if (typeof deps.storeDb.getLibraryArtistsForUser === 'function' && quickDiscoverUserId) {
          const cached = await deps.storeDb.getLibraryArtistsForUser(quickDiscoverUserId, {
            onlyReconciled: true,
          })
          libraryMbids = new Set(cached.map((a) => a.mbid).filter((m): m is string => m !== null))
        } else {
          libraryMbids = lidarr
            ? new Set((await lidarr.getArtists()).map((a) => a.foreignArtistId))
            : new Set<string>()
        }

        const prefs = mergePreferences(
          await resolveUserPreferences(
            async () => quickDiscoverUser,
            settings.preferences,
            quickDiscoverUserId,
          ),
        )
        const rejectedMbids = await deps.storeDb.getRejectedMbids(
          prefs.rejectionCooldownDays,
          quickDiscoverUserId ?? null,
        )
        const blockedMbids = quickDiscoverUserId
          ? await deps.storeDb.getBlockedMbids(quickDiscoverUserId)
          : new Set<string>()
        const seedExistingMbids = await deps.storeDb.getExistingRecommendationMbids(
          quickDiscoverUserId,
          {
            rejectionCooldownDays: prefs.rejectionCooldownDays,
          },
        )
        for (const mbid of seedExistingMbids) libraryMbids.add(mbid)

        let artistsStored = 0
        const storeAndCount = async (artists: ScoredArtist[]) => {
          if (artists.length === 0) return
          const batchId = await store(artists, deps.storeDb, { userId: quickDiscoverUserId })
          const batch = await deps.getBatch(batchId)
          const added =
            batch?.stats && typeof batch.stats === 'object' && 'added' in batch.stats
              ? batch.stats.added
              : undefined
          if (
            batch?.status !== 'completed' ||
            typeof added !== 'number' ||
            !Number.isSafeInteger(added) ||
            added < 0 ||
            added > artists.length
          ) {
            throw new Error(`Quick discover batch ${batchId} has invalid completed storage stats`)
          }
          artistsStored += added
        }

        // Direct adds retain full confidence but follow the owner's exclusion policy.
        const seedResolved = await resolve(
          [
            {
              name: trimmedArtistName,
              similarityScore: 1.0,
              aiReasoning: 'Directly added from mood discovery.',
              source: 'mood',
            },
          ],
          mb,
        )
        const seedScored = score(seedResolved, [], prefs.scoringWeights, new Map())
        for (const artist of seedScored) artist.score = 1.0
        await storeAndCount(
          filter(
            seedScored,
            libraryMbids,
            rejectedMbids,
            blockedMbids,
            prefs.rejectionCooldownDays,
            prefs.scoreThreshold,
          ),
        )

        // Find similar artists via Last.fm + AI
        const discovered: Array<{
          name: string
          similarityScore: number
          aiReasoning?: string
          source: string
        }> = []

        // Get similar from Last.fm
        if (lastfmApiKey && lastfmApiKey !== '***') {
          const lfm = createLastFmClient(lastfmUsername, lastfmApiKey)
          try {
            const similar = await lfm.getSimilarArtists(trimmedArtistName)
            discovered.push(...similar)
          } catch (err: unknown) {
            console.warn('Last.fm similar artists lookup failed:', errMsg(err))
          }
        }

        // Get AI recommendations focused on this artist
        let aiUsage: unknown = null
        if (settings.aiProvider && settings.aiModel) {
          try {
            const provider = await deps.providerRegistry.create(settings.aiProvider as string, {
              apiKey: (settings.aiApiKey as string) ?? null,
              model: settings.aiModel as string,
              baseUrl: (settings.aiBaseUrl as string) ?? null,
              timeoutSeconds: envConfig.aiTimeoutSeconds ?? null,
            })
            const aiRecs = await provider.getRecommendations({
              topArtists: [
                { name: trimmedArtistName, playCount: 100, source: 'listenbrainz' as const },
              ],
              topGenres: [],
              listeningPatterns: { totalListens: 0, recentTrend: 'stable' as const },
              responseLocale,
              promptLocale,
            })
            aiUsage = provider.lastUsage ?? null
            for (const rec of aiRecs) {
              discovered.push({
                name: rec.artistName,
                similarityScore: rec.confidence,
                aiReasoning: rec.reasoning,
                source: 'ai' as const,
              })
            }
          } catch (err: unknown) {
            console.warn('AI recommendation failed:', errMsg(err))
          }
        }

        if (discovered.length > 0) {
          const resolved = await resolve(discovered, mb, undefined, lidarr ?? undefined)
          const feedbackHistory = quickDiscoverUserId
            ? await deps.storeDb.getFeedbackHistory(quickDiscoverUserId)
            : await deps.storeDb.getFeedbackHistory()
          const scored = score(resolved, [], prefs.scoringWeights, feedbackHistory)
          const existingMbids = await deps.storeDb.getExistingRecommendationMbids(
            quickDiscoverUserId,
            {
              rejectionCooldownDays: prefs.rejectionCooldownDays,
            },
          )
          for (const mbid of existingMbids) libraryMbids.add(mbid)

          const filtered = filter(
            scored,
            libraryMbids,
            rejectedMbids,
            blockedMbids,
            prefs.rejectionCooldownDays,
            prefs.scoreThreshold,
          )

          await storeAndCount(filtered)
        }

        if (jobId != null && jobRecorder) {
          await jobRecorder.complete(jobId, {
            metadata: {
              seedArtist: trimmedArtistName,
              artistsDiscovered: discovered.length,
              artistsStored,
              ...(aiUsage ? { aiUsage } : {}),
            },
          })
        }
      } catch (err: unknown) {
        if (jobId != null && jobRecorder) {
          await recordFailureSafely(jobRecorder, jobId, errMsg(err))
        }
        console.error('Quick discover failed:', err)
      }
    })()

    return c.json({
      message: `Finding artists similar to ${trimmedArtistName}...`,
    })
  })

  router.post('/api/v1/pipeline/rescan', adminGuard(deps.getUserById), async (c) => {
    if (rescanRunning) {
      return problem(c, 'pipeline-rescan-running', 'Artist metadata rescan already running', 409)
    }
    rescanRunning = true

    try {
      const settings = await deps.getSettings()
      if (!settings) {
        return c.json({ error: 'Settings not found' }, 400)
      }

      const userId = c.get('userId')
      const preferences = mergePreferences(
        await resolveUserPreferences(deps.getUserById, settings.preferences, userId),
      )
      const {
        audiodbClient: audiodb,
        lidarrClient: lidarr,
        fanartClient: fanart,
        musicinfoClient: musicinfo,
      } = createArtistImageClients({
        settings,
        preferences,
        tryConsumeRateLimit: deps.storeDb.tryConsumeRateLimit,
      })

      if (!audiodb && !lidarr && !fanart && !musicinfo) {
        return c.json({ error: 'No artist image sources configured' }, 400)
      }
      const hasUserScopedImageSources = Boolean(fanart || musicinfo)

      const mb = createMusicBrainzClient()

      const NEGATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

      // Get this user's artists missing images, respecting the negative cache TTL
      const allRecs = await deps.listRecommendations({ limit: 200, userId })
      const artistsToUpdate = new Map<string, Record<string, unknown>>()
      for (const rec of allRecs.items) {
        const r = rec as Record<string, unknown>
        const artist = r.artist as Record<string, unknown> | undefined
        if (!artist) continue
        const mbid = artist.mbid as string | undefined
        if (!mbid || artist.imageUrl || artistsToUpdate.has(mbid)) continue
        const failedAt = artist.imageFailedAt as string | null | undefined
        if (
          !hasUserScopedImageSources &&
          failedAt &&
          Date.now() - new Date(failedAt).getTime() <= NEGATIVE_CACHE_TTL_MS
        ) {
          continue
        }
        artistsToUpdate.set(mbid, artist)
      }

      let attempted = 0
      let updated = 0
      let failed = 0
      for (const [mbid, artist] of artistsToUpdate) {
        attempted++
        const name = artist.name as string
        const [imageOutcome, metadataOutcome] = await Promise.allSettled([
          fetchArtistImage(mbid, name, audiodb, lidarr, fanart, musicinfo),
          artist.disambiguation ? Promise.resolve(null) : mb.lookupArtist(mbid),
        ])

        if (metadataOutcome.status === 'rejected') {
          console.warn('MusicBrainz disambiguation lookup failed:', errMsg(metadataOutcome.reason))
        }
        if (imageOutcome.status === 'rejected') {
          console.warn('Rescan image lookup failed for artist:', errMsg(imageOutcome.reason))
        }

        const image = imageOutcome.status === 'fulfilled' ? imageOutcome.value : null
        const mbArtist = metadataOutcome.status === 'fulfilled' ? metadataOutcome.value : null
        const disambiguation = mbArtist?.disambiguation || undefined

        try {
          if (image?.url) {
            await upsertArtist(deps.db, {
              mbid,
              name,
              imageUrl: image.url,
              logoUrl: image.logoUrl,
              disambiguation,
            })
            updated++
            continue
          }

          failed++
          const cacheableImageFailure = image?.failed ?? false
          if (cacheableImageFailure || disambiguation) {
            await upsertArtist(deps.db, {
              mbid,
              name,
              disambiguation,
              imageFailed: cacheableImageFailure || undefined,
            })
          }
        } catch (err: unknown) {
          if (image?.url) failed++
          console.warn('Rescan update failed for artist:', errMsg(err))
        }
      }

      return c.json({ attempted, updated, failed, total: attempted })
    } finally {
      rescanRunning = false
    }
  })

  return router
}
