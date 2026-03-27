import { Hono } from 'hono'
import type { AppDependencies } from '@/server'
import { resolveUserPreferences } from '@/server/helpers/preferences'
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

/** Shared approve-to-target logic used by both single and bulk approve. */
async function approveToTargets(
  artist: { mbid: string; name: string },
  targets: TargetWithCapabilities[],
  addOptions: Record<string, unknown>,
): Promise<ApproveResult> {
  if (targets.length === 0) {
    return { status: 'approved', targetActions: {} }
  }

  const targetActions: Record<string, unknown> = {}
  let anySuccess = false
  let lidarrArtistId: number | string | undefined
  let lidarrError: string | undefined

  for (const target of targets) {
    if (!target.capabilities?.includes('addArtist')) continue
    const result = await target.addArtist?.(artist, addOptions)
    if (!result) continue
    targetActions[target.id] = {
      status: result.success ? 'added' : 'failed',
      externalId: result.externalId,
      error: result.error,
    }
    if (result.success) anySuccess = true
    if (target.type === 'lidarr') {
      if (result.success && result.externalId) lidarrArtistId = result.externalId
      if (result.error) lidarrError = result.error
    }
  }

  const hasLidarr = targets.some((t) => t.type === 'lidarr')
  const status = anySuccess ? (hasLidarr ? 'added_to_lidarr' : 'approved') : 'add_failed'
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
  overrides: {
    monitorOption?: string
    selectedAlbumIds?: string[]
    qualityProfileId?: number
    metadataProfileId?: number
    rootFolderId?: number
  },
): Promise<Record<string, unknown>> {
  const settings = await deps.getSettings()
  const globalPrefs = (settings?.preferences as Record<string, unknown> | null) ?? {}

  // Merge per-user preferences over global
  const resolved = await resolveUserPreferences(deps.getUserById, globalPrefs, userId)
  const prefs = resolved && resolved !== globalPrefs ? { ...globalPrefs, ...resolved } : globalPrefs

  return {
    ...(overrides.monitorOption != null ? { monitorOption: overrides.monitorOption } : {}),
    ...(overrides.selectedAlbumIds ? { selectedAlbumIds: overrides.selectedAlbumIds } : {}),
    qualityProfileId: overrides.qualityProfileId ?? Number(prefs.qualityProfileId ?? 1),
    metadataProfileId: overrides.metadataProfileId ?? Number(prefs.metadataProfileId ?? 1),
    rootFolderId: overrides.rootFolderId ?? Number(prefs.rootFolderId ?? 1),
  }
}

export function recommendationRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.get('/api/recommendations', async (c) => {
    const query = c.req.query()
    const userId = c.get('userId')
    const filters = {
      status: query.status,
      batchId: query.batchId !== undefined ? Number(query.batchId) : undefined,
      userId,
      sort: query.sort as 'score_desc' | 'score_asc' | 'created_desc' | 'acted_on_desc' | undefined,
      limit:
        query.limit !== undefined
          ? Math.max(1, Math.min(200, Number(query.limit) || 20))
          : undefined,
      offset: query.offset !== undefined ? Math.max(0, Number(query.offset) || 0) : undefined,
    }
    const result = await deps.listRecommendations(filters)
    return c.json(result)
  })

  router.get('/api/recommendations/feedback-summary', async (c) => {
    const history = await deps.getFeedbackHistory()
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

  router.get('/api/recommendations/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const rec = await deps.getRecommendation(id)
    if (!rec) return c.json({ error: 'Recommendation not found' }, 404)
    const userId = c.get('userId')
    if (!isOwned(rec, userId)) return c.json({ error: 'Recommendation not found' }, 404)
    return c.json(rec)
  })

  router.patch('/api/recommendations/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const body = await c.req.json()
    const {
      status,
      monitorOption,
      selectedAlbumIds,
      targetId,
      qualityProfileId: qpOverride,
      metadataProfileId: mpOverride,
      rootFolderId: rfOverride,
    } = body as {
      status: string
      monitorOption?: 'all' | 'new' | 'none' | 'selected'
      selectedAlbumIds?: string[]
      targetId?: string
      qualityProfileId?: number
      metadataProfileId?: number
      rootFolderId?: number
    }

    if (!status) return c.json({ error: 'status is required' }, 400)

    // Validate status early -- before any DB work
    if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
      return c.json({ error: `Invalid status: ${status}` }, 400)
    }

    if (status === 'approved') {
      const rec = await deps.getRecommendation(id)
      if (!rec) return c.json({ error: 'Recommendation not found' }, 404)
      const userId = c.get('userId')
      if (!isOwned(rec, userId)) return c.json({ error: 'Recommendation not found' }, 404)

      const targets = userId ? await deps.getEnabledTargetsForUser(userId) : []
      const effectiveTargets = targetId ? targets.filter((t) => t.id === targetId) : targets

      // Pre-warm SkyHook if any Lidarr target exists
      if (
        deps.skyhookWarmer &&
        rec.artist?.mbid &&
        effectiveTargets.some((t) => t.type === 'lidarr')
      ) {
        try {
          await deps.skyhookWarmer.warm(rec.artist.mbid)
        } catch {
          // Best-effort
        }
      }

      const addOptions = await buildAddOptions(deps, userId, {
        monitorOption: monitorOption ?? 'all',
        selectedAlbumIds,
        qualityProfileId: qpOverride,
        metadataProfileId: mpOverride,
        rootFolderId: rfOverride,
      })

      const result = await approveToTargets(
        { mbid: rec.artist.mbid, name: rec.artist.name },
        effectiveTargets,
        addOptions,
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
    if (!rec) return c.json({ error: 'Recommendation not found' }, 404)
    const userId = c.get('userId')
    if (!isOwned(rec, userId)) return c.json({ error: 'Recommendation not found' }, 404)

    await deps.updateRecommendationStatus(id, status)
    return c.json({ status })
  })

  router.post('/api/recommendations/bulk', async (c) => {
    const body = await c.req.json()
    const {
      ids,
      action,
      targetId,
      qualityProfileId: qpOverride,
      metadataProfileId: mpOverride,
      rootFolderId: rfOverride,
    } = body as {
      ids: number[]
      action: 'approve' | 'reject'
      targetId?: string
      qualityProfileId?: number
      metadataProfileId?: number
      rootFolderId?: number
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'ids array is required' }, 400)
    }
    if (action !== 'approve' && action !== 'reject') {
      return c.json({ error: 'action must be approve or reject' }, 400)
    }

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

    const addOptions = await buildAddOptions(deps, userId, {
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
