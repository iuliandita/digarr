import { Hono } from 'hono'
import type { PipelineDeps } from '@/core/pipeline/orchestrator'
import type { AppDependencies } from '@/server'
import { createPipelineSSEStream } from '@/server/sse'

export function pipelineRoutes(deps: AppDependencies) {
  const router = new Hono()

  router.post('/api/pipeline/run', async (c) => {
    if (deps.orchestrator.isRunning) {
      return c.json({ error: 'Pipeline already running' }, 409)
    }

    const settings = await deps.getSettings()
    if (!settings) {
      return c.json({ error: 'Settings not found' }, 400)
    }

    // Fire-and-forget
    deps.orchestrator
      .run({ db: deps.storeDb, settings } as unknown as PipelineDeps)
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
    // Fire-and-forget a focused pipeline run with just this artist as seed
    ;(async () => {
      try {
        const { createLastFmClient } = await import('@/core/clients/lastfm')
        const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')
        const { createLidarrClient } = await import('@/core/clients/lidarr')
        const { resolve } = await import('@/core/pipeline/resolve')
        const { score } = await import('@/core/pipeline/score')
        const { filter } = await import('@/core/pipeline/filter')
        const { store } = await import('@/core/pipeline/store')
        const { createProvider } = await import('@/core/providers/factory')

        const lidarr = createLidarrClient(
          settings.lidarrUrl as string,
          settings.lidarrApiKey as string,
          (settings.skipTlsVerify as boolean) ?? false,
        )
        const mb = createMusicBrainzClient()

        // Get library MBIDs
        const libraryArtists = await lidarr.getArtists()
        const libraryMbids = new Set(libraryArtists.map((a) => a.foreignArtistId))

        // Get similar from Last.fm
        const discovered = []
        if (settings.lastfmApiKey && settings.lastfmApiKey !== '***') {
          const lfm = createLastFmClient(
            (settings.lastfmUsername as string) ?? '',
            settings.lastfmApiKey as string,
          )
          try {
            const similar = await lfm.getSimilarArtists(artistName)
            for (const s of similar) {
              discovered.push(s)
            }
          } catch {
            // skip
          }
        }

        // Get AI recommendations focused on this artist
        if (settings.aiProvider && settings.aiModel) {
          try {
            const provider = await createProvider(
              settings.aiProvider as string,
              (settings.aiApiKey as string) ?? null,
              settings.aiModel as string,
              (settings.aiBaseUrl as string) ?? undefined,
            )
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
          } catch {
            // skip
          }
        }

        if (discovered.length === 0) return

        // Resolve, score, filter, store
        const prefs = (settings.preferences as Record<string, unknown>) ?? {}
        const weights = (prefs.scoringWeights as Record<string, number>) ?? {
          consensus: 0.3,
          similarity: 0.25,
          genreOverlap: 0.2,
          aiConfidence: 0.15,
          feedbackBoost: 0.1,
        }

        const resolved = await resolve(discovered, mb, undefined, lidarr)
        const scored = score(resolved, [], weights as never, new Map())
        const existingMbids = await deps.storeDb.getExistingRecommendationMbids()
        for (const mbid of existingMbids) libraryMbids.add(mbid)

        const filtered = filter(
          scored,
          libraryMbids,
          new Map(),
          Number(prefs.rejectionCooldownDays ?? 90),
          Number(prefs.scoreThreshold ?? 0.3),
        )

        if (filtered.length > 0) {
          await store(filtered, deps.storeDb)
        }
      } catch (err) {
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

    // Import dynamically to avoid circular deps
    const { createLidarrClient } = await import('@/core/clients/lidarr')
    const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')

    const lidarr = createLidarrClient(
      settings.lidarrUrl as string,
      settings.lidarrApiKey as string,
      (settings.skipTlsVerify as boolean) ?? false,
    )
    const mb = createMusicBrainzClient()

    // Get all artists missing images
    const allRecs = await deps.listRecommendations({ limit: 200 })
    const artistsToUpdate = allRecs.items.filter((r: Record<string, unknown>) => {
      const artist = r.artist as Record<string, unknown> | undefined
      return artist && !artist.imageUrl
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
          // Update artist in DB
          const { upsertArtist } = await import('@/db/queries/artists')
          const { db } = await import('@/db')
          await upsertArtist(db, {
            mbid,
            name: artist.name as string,
            imageUrl: img.remoteUrl,
          })
          updated++
        }

        // Also update disambiguation from MB if missing
        if (!artist.disambiguation) {
          try {
            const mbArtist = await mb.lookupArtist(mbid)
            if (mbArtist.disambiguation) {
              const { upsertArtist } = await import('@/db/queries/artists')
              const { db } = await import('@/db')
              await upsertArtist(db, {
                mbid,
                name: artist.name as string,
                disambiguation: mbArtist.disambiguation,
                imageUrl: (artist.imageUrl as string) ?? img?.remoteUrl,
              })
            }
          } catch {
            // skip
          }
        }
      } catch {
        // skip individual failures
      }
    }

    return c.json({ updated, total: artistsToUpdate.length })
  })

  return router
}
