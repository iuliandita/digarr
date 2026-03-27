import { Hono } from 'hono'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
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
import { resolveUserPreferences } from '@/server/helpers/preferences'
import { createPipelineSSEStream } from '@/server/sse'
import type { HonoEnv } from '@/server/types'

export function pipelineRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.post('/api/pipeline/run', async (c) => {
    if (deps.orchestrator.isRunning) {
      return c.json({ error: 'Pipeline already running' }, 409)
    }

    const settings = await deps.getSettings()
    if (!settings) {
      return c.json({ error: 'Settings not found' }, 400)
    }

    const userId = c.get('userId')
    const userConnections = userId ? await getUserConnections(deps.db, userId) : null

    // Resolve Spotify OAuth token if connected
    let spotifyAccessToken: string | null = null
    if (userId) {
      try {
        spotifyAccessToken = await resolveSpotifyToken(deps.db, userId)
      } catch {
        // Best-effort -- continue without Spotify
      }
    }

    // Read per-user preferences, fallback to global
    const userPreferences = await resolveUserPreferences(
      deps.db,
      settings.preferences as Record<string, unknown> | null,
      userId,
    )

    // Build auto-approve deps -- closures capture userId for per-user target lookup
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
      warmArtist: deps.skyhookWarmer ? (mbid: string) => deps.skyhookWarmer!.warm(mbid) : undefined,
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
      } as unknown as PipelineDeps)
      .catch((err: unknown) => {
        console.error('Pipeline run failed:', err)
      })

    return c.json({ message: 'Pipeline started' }, 202)
  })

  router.get('/api/pipeline/status', async (c) => {
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

  router.get('/api/pipeline/events', (_c) => {
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
  router.post('/api/pipeline/quick-discover', async (c) => {
    if (deps.orchestrator.isRunning) {
      return c.json({ error: 'A scan is already running' }, 409)
    }

    const body = await c.req.json()
    const { artistName } = body as { artistName: string }
    if (!artistName) {
      return c.json({ error: 'artistName is required' }, 400)
    }

    const settings = await deps.getSettings()
    if (!settings) {
      return c.json({ error: 'Settings not found' }, 400)
    }

    const quickDiscoverUserId = c.get('userId')
    const quickDiscoverUserConns = quickDiscoverUserId
      ? await getUserConnections(deps.db, quickDiscoverUserId)
      : null

    // Override global listening source credentials with per-user values if present
    const lastfmApiKey =
      quickDiscoverUserConns?.lastfmApiKey ?? (settings.lastfmApiKey as string | null) ?? null
    const lastfmUsername =
      quickDiscoverUserConns?.lastfmUsername ?? (settings.lastfmUsername as string | null) ?? ''

    // Fire-and-forget a focused pipeline run with just this artist as seed
    ;(async () => {
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

        // Get library MBIDs -- intermediate array is immediately GC-eligible
        const libraryMbids = lidarr
          ? new Set((await lidarr.getArtists()).map((a) => a.foreignArtistId))
          : new Set<string>()

        // Get similar from Last.fm
        const discovered = []
        if (lastfmApiKey && lastfmApiKey !== '***') {
          const lfm = createLastFmClient(lastfmUsername, lastfmApiKey)
          try {
            const similar = await lfm.getSimilarArtists(artistName)
            discovered.push(...similar)
          } catch (err: unknown) {
            console.warn('Last.fm similar artists lookup failed:', errMsg(err))
          }
        }

        // Get AI recommendations focused on this artist
        if (settings.aiProvider && settings.aiModel) {
          try {
            const provider = await deps.providerRegistry.create(settings.aiProvider as string, {
              apiKey: (settings.aiApiKey as string) ?? null,
              model: settings.aiModel as string,
              baseUrl: (settings.aiBaseUrl as string) ?? null,
            })
            const aiRecs = await provider.getRecommendations({
              topArtists: [{ name: artistName, playCount: 100, source: 'listenbrainz' as const }],
              topGenres: [],
              listeningPatterns: { totalListens: 0, recentTrend: 'stable' as const },
            })
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

        if (discovered.length === 0) return

        // Read per-user preferences for quick-discover, fallback to global
        const qdPreferences = await resolveUserPreferences(
          deps.db,
          settings.preferences as Record<string, unknown> | null,
          quickDiscoverUserId,
        )
        const prefs = mergePreferences(qdPreferences)

        const resolved = await resolve(discovered, mb, undefined, lidarr ?? undefined)
        const rejectedMbids = await deps.storeDb.getRejectedMbids(prefs.rejectionCooldownDays)
        const feedbackHistory = await deps.storeDb.getFeedbackHistory()
        const scored = score(resolved, [], prefs.scoringWeights, feedbackHistory)
        const existingMbids = await deps.storeDb.getExistingRecommendationMbids(quickDiscoverUserId)
        for (const mbid of existingMbids) libraryMbids.add(mbid)

        const filtered = filter(
          scored,
          libraryMbids,
          rejectedMbids,
          prefs.rejectionCooldownDays,
          prefs.scoreThreshold,
        )

        if (filtered.length > 0) {
          await store(filtered, deps.storeDb, { userId: quickDiscoverUserId })
        }
      } catch (err: unknown) {
        console.error('Quick discover failed:', err)
      }
    })()

    return c.json({
      message: `Finding artists similar to ${artistName}...`,
    })
  })

  // Re-resolve existing artists to update images/metadata
  router.post('/api/pipeline/rescan', async (c) => {
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
          // No image found -- refresh the negative cache TTL
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
