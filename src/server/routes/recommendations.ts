import { Hono } from 'hono'
import { selectPopularReleaseGroups } from '@/core/albums/popular'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { createSpotifyClient } from '@/core/clients/spotify'
import { resolveSpotifyToken } from '@/core/spotify-auth'
import { mergePreferences } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { resolveUserPreferences } from '@/server/helpers/preferences'
import { problem } from '@/server/helpers/problem'
import {
  bulkRecommendationSchema,
  listRecommendationsQuerySchema,
  recommendationIdParamSchema,
  rejectStatusSchema,
  updateRecommendationSchema,
} from '@/server/schemas/recommendations'
import { zJson, zParam, zQuery } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

type TargetWithCapabilities = Awaited<
  ReturnType<AppDependencies['getEnabledTargetsForUser']>
>[number]

type ApproveResult = {
  status: string
  targetActions: Record<string, unknown>
  lidarrArtistId?: number | string
  lidarrError?: string
}

type ApprovalMode = 'single_target' | 'combined_lidarr_slskd'
type MonitorOption = 'all' | 'new' | 'none' | 'selected' | 'popular'
type TargetActionStatus = 'added' | 'queued' | 'failed'

type ApprovalArtist = {
  mbid: string
  name: string
  streamingUrls?: Record<string, string> | null
}

const POPULAR_ALBUM_LIMIT = 3

function extractSpotifyArtistId(url?: string): string | null {
  if (!url) return null
  const match = url.match(/open\.spotify\.com\/artist\/([^/?#]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

async function resolvePopularAlbumIds(
  deps: AppDependencies,
  userId: number | undefined,
  artist: ApprovalArtist | undefined,
): Promise<string[]> {
  if (!userId) {
    throw new Error('Popular album approval requires a signed-in user')
  }
  if (!artist) {
    throw new Error('Popular album approval requires artist metadata')
  }

  const accessToken = await resolveSpotifyToken(deps.db, userId)
  const spotify = createSpotifyClient(accessToken)
  const spotifyId =
    extractSpotifyArtistId(artist.streamingUrls?.spotify) ??
    (await spotify.findExactArtistByName(artist.name))?.id

  if (!spotifyId) {
    throw new Error(`Could not resolve Spotify artist for ${artist.name}`)
  }

  const [spotifyAlbums, releaseGroups] = await Promise.all([
    spotify.getPopularAlbumsForArtist(spotifyId, POPULAR_ALBUM_LIMIT),
    createMusicBrainzClient().getReleaseGroups(artist.mbid),
  ])
  const selected = selectPopularReleaseGroups(spotifyAlbums, releaseGroups, POPULAR_ALBUM_LIMIT)
  if (selected.length === 0) {
    throw new Error(`Could not map popular Spotify albums to Lidarr albums for ${artist.name}`)
  }

  return selected.map((album) => album.id)
}

type TargetExecutionResult = {
  action?: {
    status: TargetActionStatus
    externalId?: number | string
    error?: string
  }
  success: boolean
  lidarrArtistId?: number | string
  lidarrError?: string
}

async function addArtistToTarget(
  artist: { mbid: string; name: string },
  target: TargetWithCapabilities,
  addOptions: Record<string, unknown>,
  jobRecorder?: import('@/core/jobs/types').JobRecorder,
  userId?: number,
): Promise<TargetExecutionResult> {
  const targetJobId = jobRecorder
    ? await jobRecorder.start({
        type: 'target',
        userId,
        metadata: {
          targetType: target.type,
          artistName: artist.name,
          mbid: artist.mbid,
          action: 'add',
        },
      })
    : null

  const result = await target.addArtist?.(artist, addOptions)

  if (!result) {
    if (targetJobId != null && jobRecorder) {
      await jobRecorder.complete(targetJobId, {
        metadata: { targetType: target.type, artistName: artist.name, skipped: true },
      })
    }
    return { success: false }
  }

  if (targetJobId != null && jobRecorder) {
    if (result.success) {
      await jobRecorder.complete(targetJobId, {
        metadata: {
          targetType: target.type,
          artistName: artist.name,
          externalId: result.externalId,
        },
      })
    } else {
      await jobRecorder.fail(targetJobId, result.error ?? 'Target returned failure').catch(() => {})
    }
  }

  return {
    action: {
      status: result.success ? (target.type === 'slskd' ? 'queued' : 'added') : 'failed',
      externalId: result.externalId,
      error: result.error,
    },
    success: result.success,
    lidarrArtistId: target.type === 'lidarr' && result.success ? result.externalId : undefined,
    lidarrError: target.type === 'lidarr' ? result.error : undefined,
  }
}

/** Shared approve-to-target logic used by both single and bulk approve. */
async function approveToTargets(
  artist: { mbid: string; name: string },
  targets: TargetWithCapabilities[],
  addOptions: Record<string, unknown>,
  jobRecorder?: import('@/core/jobs/types').JobRecorder,
  userId?: number,
  recommendationId?: number,
): Promise<ApproveResult> {
  const actionableTargets = targets.filter((target) => target.capabilities?.includes('addArtist'))

  if (actionableTargets.length === 0) {
    return { status: 'approved', targetActions: {} }
  }

  const targetActions: Record<string, unknown> = {}
  let anySuccess = false
  let lidarrArtistId: number | string | undefined
  let lidarrError: string | undefined

  for (const target of actionableTargets) {
    const execution = await addArtistToTarget(
      artist,
      target,
      {
        ...addOptions,
        userId,
        recommendationId,
      },
      jobRecorder,
      userId,
    )

    if (!execution.action) {
      continue
    }

    targetActions[target.id] = execution.action
    if (execution.success) anySuccess = true
    if (execution.lidarrArtistId) lidarrArtistId = execution.lidarrArtistId
    if (execution.lidarrError) lidarrError = execution.lidarrError
  }

  const status = lidarrArtistId ? 'added_to_lidarr' : anySuccess ? 'approved' : 'add_failed'
  return { status, targetActions, lidarrArtistId, lidarrError }
}

async function approveWithCombinedLidarrSlskd(
  artist: { mbid: string; name: string },
  lidarrTarget: TargetWithCapabilities,
  slskdTarget: TargetWithCapabilities,
  addOptions: Record<string, unknown>,
  recommendationId: number,
  jobRecorder?: import('@/core/jobs/types').JobRecorder,
  userId?: number,
): Promise<ApproveResult> {
  const targetActions: Record<string, unknown> = {}
  let lidarrArtistId: number | string | undefined
  let lidarrError: string | undefined

  const lidarrExecution = await addArtistToTarget(
    artist,
    lidarrTarget,
    {
      ...addOptions,
      userId,
      recommendationId,
    },
    jobRecorder,
    userId,
  )

  if (lidarrExecution.action) {
    targetActions[lidarrTarget.id] = lidarrExecution.action
  }
  if (lidarrExecution.lidarrArtistId) lidarrArtistId = lidarrExecution.lidarrArtistId
  if (lidarrExecution.lidarrError) lidarrError = lidarrExecution.lidarrError

  if (lidarrExecution.success && lidarrArtistId != null) {
    const slskdExecution = await addArtistToTarget(
      artist,
      slskdTarget,
      {
        ...addOptions,
        userId,
        recommendationId,
        lidarrArtistId: Number(lidarrArtistId),
      },
      jobRecorder,
      userId,
    )

    if (slskdExecution.action) {
      targetActions[slskdTarget.id] = slskdExecution.action
    }
  }

  const status = lidarrArtistId ? 'added_to_lidarr' : 'add_failed'
  return { status, targetActions, lidarrArtistId, lidarrError }
}

function isOwned(rec: { userId?: number | null }, callerId?: number): boolean {
  if (!rec.userId) return true // legacy recs (null userId) are visible to everyone
  return rec.userId === callerId
}

/** Build Lidarr add options from per-user preferences (with global fallback). */
async function buildAddOptions(
  deps: AppDependencies,
  userId: number | undefined,
  artist: ApprovalArtist | undefined,
  overrides: {
    monitorOption?: MonitorOption
    selectedAlbumIds?: string[]
    qualityProfileId?: number
    metadataProfileId?: number
    rootFolderId?: number
  },
): Promise<Record<string, unknown>> {
  const settings = await deps.getSettings()
  const globalPrefs = settings?.preferences ?? null

  // Merge per-user preferences over global
  const resolved = await resolveUserPreferences(deps.getUserById, globalPrefs, userId)
  const prefs = mergePreferences(resolved ?? globalPrefs)
  const popularAlbumIds =
    overrides.monitorOption === 'popular'
      ? await resolvePopularAlbumIds(deps, userId, artist)
      : undefined

  return {
    ...(overrides.monitorOption != null
      ? {
          monitorOption:
            overrides.monitorOption === 'popular' ? 'selected' : overrides.monitorOption,
        }
      : {}),
    ...(popularAlbumIds
      ? { selectedAlbumIds: popularAlbumIds }
      : overrides.selectedAlbumIds
        ? { selectedAlbumIds: overrides.selectedAlbumIds }
        : {}),
    qualityProfileId: overrides.qualityProfileId ?? prefs.qualityProfileId,
    metadataProfileId: overrides.metadataProfileId ?? prefs.metadataProfileId,
    rootFolderId: overrides.rootFolderId ?? prefs.rootFolderId,
  }
}

export function recommendationRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.get('/api/v1/recommendations', zQuery(listRecommendationsQuerySchema), async (c) => {
    const userId = c.get('userId')
    const query = c.req.valid('query')
    const filters = {
      status: query.status,
      batchId: query.batchId,
      userId,
      decades: query.decades || undefined,
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
    }
    const result = await deps.listRecommendations(filters)
    return c.json(result)
  })

  router.get('/api/v1/recommendations/feedback-summary', async (c) => {
    const userId = c.get('userId')
    const history = await deps.getFeedbackHistory(userId)
    const summary = [...history.entries()]
      .map(([genre, { approved, total }]) => ({
        genre,
        approved,
        rejected: total - approved,
        total,
        rate: total > 0 ? approved / total : 0,
      }))
      .filter((e) => e.total >= 3)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 20)

    return c.json({ summary })
  })

  router.get('/api/v1/recommendations/:id', zParam(recommendationIdParamSchema), async (c) => {
    const { id } = c.req.valid('param')
    const rec = await deps.getRecommendation(id)
    if (!rec)
      return problem(
        c,
        'recommendation-not-found',
        'Recommendation not found',
        404,
        undefined,
        undefined,
        'errors.recommendation.notFound',
      )
    const userId = c.get('userId')
    if (!isOwned(rec, userId))
      return problem(
        c,
        'recommendation-not-found',
        'Recommendation not found',
        404,
        undefined,
        undefined,
        'errors.recommendation.notFound',
      )
    return c.json(rec)
  })

  router.patch(
    '/api/v1/recommendations/:id',
    zParam(recommendationIdParamSchema),
    zJson(updateRecommendationSchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const {
        status,
        approvalMode: rawApprovalMode,
        lidarrTargetId,
        monitorOption,
        selectedAlbumIds,
        targetId,
        qualityProfileId: qpOverride,
        metadataProfileId: mpOverride,
        rootFolderId: rfOverride,
      } = body

      const approvalMode: ApprovalMode = rawApprovalMode ?? 'single_target'

      if (status === 'approved') {
        const rec = await deps.getRecommendation(id)
        if (!rec)
          return problem(
            c,
            'recommendation-not-found',
            'Recommendation not found',
            404,
            undefined,
            undefined,
            'errors.recommendation.notFound',
          )
        const userId = c.get('userId')
        if (!isOwned(rec, userId))
          return problem(
            c,
            'recommendation-not-found',
            'Recommendation not found',
            404,
            undefined,
            undefined,
            'errors.recommendation.notFound',
          )

        const targets = userId ? await deps.getEnabledTargetsForUser(userId) : []
        const effectiveTargets = targetId ? targets.filter((t) => t.id === targetId) : targets
        const lidarrTargets = targets.filter(
          (target) => target.type === 'lidarr' && target.capabilities?.includes('addArtist'),
        )
        const slskdTarget = effectiveTargets.find(
          (target) => target.type === 'slskd' && target.capabilities?.includes('addArtist'),
        )
        const selectedLidarrTargetId =
          lidarrTargetId ??
          (slskdTarget?.type === 'slskd' ? slskdTarget.linkedLidarrTargetId : undefined)
        const lidarrTarget = selectedLidarrTargetId
          ? lidarrTargets.find((target) => target.id === selectedLidarrTargetId)
          : lidarrTargets[0]

        if (approvalMode === 'combined_lidarr_slskd') {
          if (!targetId) {
            return c.json({ error: 'targetId is required for combined approval' }, 400)
          }
          if (!slskdTarget) {
            return c.json({ error: `Unknown targetId: ${targetId}` }, 400)
          }
          if (selectedLidarrTargetId) {
            if (!lidarrTarget) {
              return c.json({ error: `Unknown lidarrTargetId: ${selectedLidarrTargetId}` }, 400)
            }
          } else if (lidarrTargets.length !== 1) {
            return c.json(
              { error: 'Combined approval requires exactly one enabled Lidarr target' },
              400,
            )
          }
        } else {
          if (targetId && effectiveTargets.length === 0) {
            return c.json({ error: `Unknown targetId: ${targetId}` }, 400)
          }
          if (targetId && !effectiveTargets.some((t) => t.capabilities?.includes('addArtist'))) {
            return c.json({ error: `Target does not support artist approval: ${targetId}` }, 400)
          }
        }

        // Pre-warm SkyHook if any Lidarr target exists
        if (
          deps.skyhookWarmer &&
          rec.artist?.mbid &&
          (approvalMode === 'combined_lidarr_slskd'
            ? Boolean(lidarrTarget)
            : effectiveTargets.some((t) => t.type === 'lidarr'))
        ) {
          try {
            await deps.skyhookWarmer.warm(rec.artist.mbid)
          } catch {
            // Best-effort
          }
        }

        let addOptions: Record<string, unknown>
        try {
          addOptions = await buildAddOptions(
            deps,
            userId,
            {
              mbid: rec.artist.mbid,
              name: rec.artist.name,
              streamingUrls: rec.artist.streamingUrls,
            },
            {
              monitorOption: (monitorOption ?? 'all') as MonitorOption,
              selectedAlbumIds,
              qualityProfileId: qpOverride,
              metadataProfileId: mpOverride,
              rootFolderId: rfOverride,
            },
          )
        } catch (err) {
          if (monitorOption !== 'popular') throw err
          return c.json(
            { error: err instanceof Error ? err.message : 'Popular albums could not be resolved' },
            400,
          )
        }

        const result =
          approvalMode === 'combined_lidarr_slskd' && lidarrTarget && slskdTarget
            ? await approveWithCombinedLidarrSlskd(
                { mbid: rec.artist.mbid, name: rec.artist.name },
                lidarrTarget,
                slskdTarget,
                addOptions,
                id,
                deps.jobRecorder,
                userId,
              )
            : await approveToTargets(
                { mbid: rec.artist.mbid, name: rec.artist.name },
                effectiveTargets,
                addOptions,
                deps.jobRecorder,
                userId,
                id,
              )

        const extra: Record<string, unknown> = { targetActions: result.targetActions }
        if (result.lidarrArtistId) extra.lidarrArtistId = result.lidarrArtistId
        if (result.lidarrError) extra.lidarrError = result.lidarrError

        await deps.updateRecommendationStatus(id, result.status, extra)
        return c.json({
          status: result.status,
          targetActions: result.targetActions,
          ...(result.lidarrError ? { lidarrError: result.lidarrError } : {}),
        })
      }

      const rec = await deps.getRecommendation(id)
      if (!rec)
        return problem(
          c,
          'recommendation-not-found',
          'Recommendation not found',
          404,
          undefined,
          undefined,
          'errors.recommendation.notFound',
        )
      const userId = c.get('userId')
      if (!isOwned(rec, userId))
        return problem(
          c,
          'recommendation-not-found',
          'Recommendation not found',
          404,
          undefined,
          undefined,
          'errors.recommendation.notFound',
        )

      if (status === 'rejected') {
        const validated = rejectStatusSchema.safeParse(body)
        if (!validated.success) {
          return problem(
            c,
            'validation-failed',
            'Invalid rejection payload',
            400,
            undefined,
            { issues: validated.error.issues },
            'errors.validation.failed',
          )
        }
        await deps.rejectRecommendation({
          recommendationId: id,
          userId,
          reason: validated.data.reason ?? null,
          reasonText: validated.data.reasonText ?? null,
          permanent: validated.data.permanent,
        })
        return c.json({ status: 'rejected' })
      }

      await deps.updateRecommendationStatus(id, status)
      return c.json({ status })
    },
  )

  router.post('/api/v1/recommendations/bulk', zJson(bulkRecommendationSchema), async (c) => {
    const {
      ids,
      action,
      targetId,
      qualityProfileId: qpOverride,
      metadataProfileId: mpOverride,
      rootFolderId: rfOverride,
    } = c.req.valid('json')

    const userId = c.get('userId')

    if (action === 'reject') {
      const ownedIds = await deps.filterOwnedIds(ids, userId)
      if (ownedIds.length > 0) {
        await deps.bulkUpdateStatus(ownedIds, 'rejected')
      }
      return c.json({ updated: ownedIds.length })
    }

    // Approve: route through targets
    const targets = userId ? await deps.getEnabledTargetsForUser(userId) : []
    const effectiveTargets = targetId ? targets.filter((t) => t.id === targetId) : targets
    if (targetId && effectiveTargets.length === 0) {
      return c.json({ error: `Unknown targetId: ${targetId}` }, 400)
    }
    if (targetId && !effectiveTargets.some((t) => t.capabilities?.includes('addArtist'))) {
      return c.json({ error: `Target does not support artist approval: ${targetId}` }, 400)
    }

    const addOptions = await buildAddOptions(deps, userId, undefined, {
      qualityProfileId: qpOverride,
      metadataProfileId: mpOverride,
      rootFolderId: rfOverride,
    })

    const results: Array<{ id: number; status: string; error?: string }> = []

    for (const id of ids) {
      const rec = await deps.getRecommendation(id)
      if (!rec) {
        results.push({ id, status: 'not_found' })
        continue
      }
      if (!isOwned(rec, userId)) {
        results.push({ id, status: 'not_found' })
        continue
      }

      const result = await approveToTargets(
        { mbid: rec.artist.mbid, name: rec.artist.name },
        effectiveTargets,
        addOptions,
        deps.jobRecorder,
        userId,
        id,
      )

      const extra: Record<string, unknown> = { targetActions: result.targetActions }
      if (result.lidarrArtistId) extra.lidarrArtistId = result.lidarrArtistId
      if (result.lidarrError) extra.lidarrError = result.lidarrError
      await deps.updateRecommendationStatus(id, result.status, extra)
      results.push({ id, status: result.status })
    }

    return c.json({ results })
  })

  return router
}
