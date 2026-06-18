import { Hono } from 'hono'
import { envConfig } from '@/config/env'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import {
  buildDiscoveryModeExecutionContext,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import { prepareDiscoveryModeRequest } from '@/core/discovery-modes/prepare'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import { normalizeDiscoveryModeRequest } from '@/core/discovery-modes/request'
import { buildDiscoveryModeJobMetadata } from '@/core/discovery-modes/run'
import { detectPromptLocale } from '@/core/i18n/prompt-locale'
import type { AutoApproveDeps } from '@/core/pipeline/auto-approve'
import { filter } from '@/core/pipeline/filter'
import type { PipelineDeps } from '@/core/pipeline/orchestrator'
import { resolve } from '@/core/pipeline/resolve'
import { score } from '@/core/pipeline/score'
import { store } from '@/core/pipeline/store'
import { resolveSpotifyToken } from '@/core/spotify-auth'
import { errMsg } from '@/core/validation'
import { upsertArtist } from '@/db/queries/artists'
import { getUserConnections } from '@/db/queries/users'
import { mergePreferences } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { notAuthenticated } from '@/server/helpers/auth-problems'
import { resolveUserPreferences } from '@/server/helpers/preferences'
import { problem } from '@/server/helpers/problem'
import { resolveRequestLocale } from '@/server/locale'
import { discoveryModeRunSchema, quickDiscoverSchema } from '@/server/schemas/pipeline'
import { zJson } from '@/server/schemas/validator'
import { createPipelineSSEStream } from '@/server/sse'
import type { HonoEnv } from '@/server/types'

const EMPTY_DISCOVERY_SNAPSHOT = {
  hasListenBrainz: false,
  hasSpotify: false,
  hasLastfm: false,
  hasDiscogs: false,
  hasLibrarySync: false,
}

export function pipelineRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  // Intentionally NOT admin-gated: "Run Scan" is a core regular-user action,
  // reachable from the dashboard (TodaysPick) and discover surfaces. Any
  // authenticated user may start a run; concurrency is bounded by the
  // orchestrator.isRunning singleton (a second run returns 409), so the blast
  // radius is one in-flight pipeline regardless of caller. See plan 008 Part C.
  router.post('/api/v1/pipeline/run', async (c) => {
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
        spotifyAccessToken = await resolveSpotifyToken(deps.db, userId)
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
          artist: { mbid: r.artist.mbid, name: r.artist.name },
        }))
      },
      getEnabledTargets: () =>
        userId ? deps.getEnabledTargetsForUser(userId) : Promise.resolve([]),
      updateRecommendationStatus: (id, status, extra) =>
        deps.updateRecommendationStatus(id, status, extra),
      warmArtist: deps.skyhookWarmer
        ? (
            (warmer) => (mbid: string) =>
              warmer.warm(mbid)
          )(deps.skyhookWarmer)
        : undefined,
    }

    // Fire-and-forget
    deps.orchestrator
      .run({
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
      .catch((err: unknown) => {
        console.error('Pipeline run failed:', err)
      })

    return c.json({ message: 'Pipeline started' }, 202)
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
      return c.json({ error: errMsg(err) }, 400)
    }
  })

  router.get('/api/v1/pipeline/status', async (c) => {
    const lastBatch = await deps.getLastBatch()
    return c.json({
      running: deps.orchestrator.isRunning,
      stage: deps.orchestrator.stage,
      message: deps.orchestrator.stageMessage,
      lastRun: lastBatch
        ? {
            batchId: lastBatch.id,
            completedAt: lastBatch.createdAt,
            status: lastBatch.status,
          }
        : undefined,
    })
  })

  router.get('/api/v1/pipeline/events', (_c) => {
    const stream = createPipelineSSEStream(deps.orchestrator)
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

        // Add the seed artist directly (bypasses dedup, no Lidarr dependency)
        try {
          const existingMbids =
            await deps.storeDb.getExistingRecommendationMbids(quickDiscoverUserId)
          const seedDiscovered = [
            {
              name: trimmedArtistName,
              similarityScore: 1.0,
              aiReasoning: 'Directly added from mood discovery.',
              source: 'mood',
            },
          ]
          // Resolve via MB only (no Lidarr image lookup - avoids SkyHook dependency)
          const seedResolved = await resolve(seedDiscovered, mb)
          const newSeeds = seedResolved.filter((s) => !existingMbids.has(s.mbid))
          if (newSeeds.length > 0) {
            const seedScored = score(
              newSeeds,
              [],
              {
                consensus: 0,
                similarity: 0,
                genreOverlap: 0,
                aiConfidence: 0,
                feedbackBoost: 0,
                popularity: 0,
              },
              new Map(),
            )
            for (const s of seedScored) s.score = 1.0
            await store(seedScored, deps.storeDb, { userId: quickDiscoverUserId })
          }
        } catch (err: unknown) {
          console.warn('Seed artist store failed:', errMsg(err))
        }

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

        if (discovered.length === 0) {
          if (jobId != null && jobRecorder) {
            await jobRecorder.complete(jobId, {
              metadata: {
                seedArtist: trimmedArtistName,
                artistsDiscovered: 0,
                artistsStored: 0,
                ...(aiUsage ? { aiUsage } : {}),
              },
            })
          }
          return
        }

        // Read per-user preferences for quick-discover, fallback to global
        const qdPreferences = await resolveUserPreferences(
          async () => quickDiscoverUser,
          settings.preferences,
          quickDiscoverUserId,
        )
        const prefs = mergePreferences(qdPreferences)

        const resolved = await resolve(discovered, mb, undefined, lidarr ?? undefined)
        const rejectedMbids = await deps.storeDb.getRejectedMbids(prefs.rejectionCooldownDays)
        const blockedMbids = quickDiscoverUserId
          ? await deps.storeDb.getBlockedMbids(quickDiscoverUserId)
          : new Set<string>()
        const feedbackHistory = await deps.storeDb.getFeedbackHistory()
        const scored = score(resolved, [], prefs.scoringWeights, feedbackHistory)
        const existingMbids = await deps.storeDb.getExistingRecommendationMbids(quickDiscoverUserId)
        for (const mbid of existingMbids) libraryMbids.add(mbid)

        const filtered = filter(
          scored,
          libraryMbids,
          rejectedMbids,
          blockedMbids,
          prefs.rejectionCooldownDays,
          prefs.scoreThreshold,
        )

        if (filtered.length > 0) {
          await store(filtered, deps.storeDb, { userId: quickDiscoverUserId })
        }

        if (jobId != null && jobRecorder) {
          await jobRecorder.complete(jobId, {
            metadata: {
              seedArtist: trimmedArtistName,
              artistsDiscovered: discovered.length,
              artistsStored: filtered.length,
              ...(aiUsage ? { aiUsage } : {}),
            },
          })
        }
      } catch (err: unknown) {
        if (jobId != null && jobRecorder) {
          await jobRecorder.fail(jobId, errMsg(err)).catch(() => {})
        }
        console.error('Quick discover failed:', err)
      }
    })()

    return c.json({
      message: `Finding artists similar to ${trimmedArtistName}...`,
    })
  })

  // Re-resolve existing artists to update images/metadata
  // Non-admin by design, same rationale as /pipeline/run above: any authenticated
  // user may re-fetch images/metadata for existing recommendations.
  router.post('/api/v1/pipeline/rescan', async (c) => {
    const settings = await deps.getSettings()
    if (!settings?.lidarrUrl || !settings?.lidarrApiKey) {
      return c.json({ error: 'Lidarr not configured' }, 400)
    }

    const lidarr = createLidarrClient(
      settings.lidarrUrl as string,
      settings.lidarrApiKey as string,
      (settings.skipTlsVerify as boolean) ?? false,
    )
    const mb = createMusicBrainzClient()

    const NEGATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

    // Get this user's artists missing images, respecting the negative cache TTL
    const userId = c.get('userId')
    const allRecs = await deps.listRecommendations({ limit: 200, userId })
    const artistsToUpdate = allRecs.items.filter((r: Record<string, unknown>) => {
      const artist = r.artist as Record<string, unknown> | undefined
      if (!artist) return false
      if (artist.imageUrl) return false // already has an image
      const failedAt = artist.imageFailedAt as string | null | undefined
      if (!failedAt) return true // never tried
      return Date.now() - new Date(failedAt).getTime() > NEGATIVE_CACHE_TTL_MS
    })

    let updated = 0
    for (const rec of artistsToUpdate) {
      const artist = rec.artist as Record<string, unknown>
      const mbid = artist.mbid as string
      if (!mbid) continue

      try {
        // Fetch image from Lidarr lookup
        const results = await lidarr.lookupArtist(`lidarr:${mbid}`)
        const result = results[0] as Record<string, unknown> | undefined
        const images = (result?.images ?? []) as Array<{ coverType: string; remoteUrl?: string }>
        const img =
          images.find((i) => i.coverType === 'poster' && i.remoteUrl) ??
          images.find((i) => i.coverType === 'fanart' && i.remoteUrl) ??
          images.find((i) => i.remoteUrl)

        if (img?.remoteUrl) {
          await upsertArtist(deps.db, {
            mbid,
            name: artist.name as string,
            imageUrl: img.remoteUrl,
          })
          updated++
        } else {
          // No image found - refresh the negative cache TTL
          await upsertArtist(deps.db, {
            mbid,
            name: artist.name as string,
            imageFailed: true,
          })
        }

        // Also update disambiguation from MB if missing
        if (!artist.disambiguation) {
          try {
            const mbArtist = await mb.lookupArtist(mbid)
            if (mbArtist.disambiguation) {
              await upsertArtist(deps.db, {
                mbid,
                name: artist.name as string,
                disambiguation: mbArtist.disambiguation,
                imageUrl: (artist.imageUrl as string) ?? img?.remoteUrl,
              })
            }
          } catch (err: unknown) {
            console.warn('MusicBrainz disambiguation lookup failed:', errMsg(err))
          }
        }
      } catch (err: unknown) {
        console.warn('Rescan failed for artist:', errMsg(err))
      }
    }

    return c.json({ updated, total: artistsToUpdate.length })
  })

  return router
}
