import { type Context, Hono } from 'hono'
import { type PopularAlbumCandidate, selectPopularReleaseGroups } from '@/core/albums/popular'
import { requiresApprovalRequest } from '@/core/approvals/policy'
import { createLastFmClient } from '@/core/clients/lastfm'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { createSpotifyClient } from '@/core/clients/spotify'
import { recordFailureSafely } from '@/core/jobs/record-failure-safely'
import { resolveProviderToken } from '@/core/provider-auth'
import type { FeedbackTrack } from '@/core/scrobbler-write-back'
import { deriveStatusFromActions } from '@/core/targets/action-status'
import {
  hasRetryState,
  hasWaitingAction,
  isWaitingAction,
  targetAction,
} from '@/core/targets/lidarr-retry'
import { withApprovalLock, withApprovalLocks } from '@/core/targets/lidarr-retry-worker'
import { conciseErrMsg, errMsg } from '@/core/validation'
import {
  ApprovalRequestCooldownError,
  ApprovalRequestLimitError,
  approvalRequestQueries,
} from '@/db/queries/approval-requests'
import { getOwnedAuditionTrack, getPendingPlayability } from '@/db/queries/playlists'
import { getUserConnections } from '@/db/queries/users'
import { mergePreferences } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { problem } from '@/server/helpers/problem'
import { requireSessionUser, requireUser } from '@/server/helpers/require-user'
import { idempotency } from '@/server/middleware/idempotency'
import {
  bulkRecommendationSchema,
  listRecommendationsQuerySchema,
  missingAlbumsSchema,
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

type TargetActionRecord = { status?: string; error?: string; warning?: string } | null

type TargetSummary = {
  total: number
  succeeded: number
  failed: number
  failures: Array<{ id: string; name: string; error?: string }>
  warnings: string[]
}

const isTargetSuccess = (action: TargetActionRecord): boolean =>
  action?.status === 'added' || action?.status === 'queued'

/** Per-target outcome of a single approve attempt, for submit-time UI surfacing. */
function summarizeTargetActions(
  targetActions: Record<string, unknown>,
  targetsById: Map<string, { name: string }>,
): TargetSummary {
  const entries = Object.entries(targetActions) as [string, TargetActionRecord][]
  const failures: TargetSummary['failures'] = []
  const warnings: string[] = []
  let succeeded = 0
  for (const [id, action] of entries) {
    if (isTargetSuccess(action)) {
      succeeded++
      if (action?.warning) warnings.push(action.warning)
    } else if (action?.status !== 'waiting') {
      failures.push({ id, name: targetsById.get(id)?.name ?? id, error: action?.error })
    }
  }
  return { total: entries.length, succeeded, failed: failures.length, failures, warnings }
}

type ApprovalMode = 'single_target' | 'combined_lidarr_slskd'
type MonitorOption =
  | 'all'
  | 'new'
  | 'missing'
  | 'existing'
  | 'latest'
  | 'first'
  | 'none'
  | 'selected'
  | 'popular'
type TargetActionStatus = 'added' | 'queued' | 'failed' | 'waiting'

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

/** Distinguishes "no popularity source available" from "source had no usable albums". */
export type PopularAlbumsErrorCode = 'no_source' | 'no_match'

export class PopularAlbumsError extends Error {
  constructor(
    readonly code: PopularAlbumsErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PopularAlbumsError'
  }
}

/** Top albums by Spotify popularity; empty when Spotify is unavailable for this user/artist. */
async function spotifyPopularCandidates(
  deps: AppDependencies,
  userId: number,
  artist: ApprovalArtist,
): Promise<PopularAlbumCandidate[]> {
  try {
    const accessToken = await resolveProviderToken(deps.db, userId, 'spotify')
    const spotify = createSpotifyClient(accessToken)
    const spotifyId =
      extractSpotifyArtistId(artist.streamingUrls?.spotify) ??
      (await spotify.findExactArtistByName(artist.name))?.id
    if (!spotifyId) return []
    return await spotify.getPopularAlbumsForArtist(spotifyId, POPULAR_ALBUM_LIMIT)
  } catch {
    // Spotify not connected, token expired, or lookup failed: let the next source try.
    return []
  }
}

/** Top albums by Last.fm global playcount; empty when no Last.fm API key is configured. */
async function lastfmPopularCandidates(
  deps: AppDependencies,
  userId: number,
  artist: ApprovalArtist,
): Promise<PopularAlbumCandidate[]> {
  try {
    const connections = await getUserConnections(deps.db, userId)
    if (!connections?.lastfmApiKey) return []
    // Username is unused by artist.getTopAlbums (API-key only); fall back to empty.
    const client = createLastFmClient(connections.lastfmUsername ?? '', connections.lastfmApiKey)
    return await client.getTopAlbumsForArtist(artist.name, artist.mbid)
  } catch {
    return []
  }
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

  // MB release groups are the matching target for whichever popularity source wins.
  const releaseGroups = await createMusicBrainzClient().getReleaseGroups(artist.mbid)

  // Spotify gives normalized popularity; Last.fm gives global playcount. Never
  // blend the two scales in one list - take the first source that returns albums.
  let candidates = await spotifyPopularCandidates(deps, userId, artist)
  if (candidates.length === 0) {
    candidates = await lastfmPopularCandidates(deps, userId, artist)
  }
  if (candidates.length === 0) {
    throw new PopularAlbumsError(
      'no_source',
      `No popularity source returned albums for ${artist.name}. Connect Spotify or Last.fm.`,
    )
  }

  const selected = selectPopularReleaseGroups(candidates, releaseGroups, POPULAR_ALBUM_LIMIT)
  if (selected.length === 0) {
    throw new PopularAlbumsError(
      'no_match',
      `Could not map popular albums to library albums for ${artist.name}.`,
    )
  }

  return selected.map((album) => album.id)
}

type TargetExecutionResult = {
  action?: {
    retry?: import('@/core/targets/lidarr-retry').WaitingAction['retry']
    status: TargetActionStatus
    externalId?: number | string
    error?: string
    warning?: string
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
  const prior = (addOptions.priorActions as Record<string, unknown> | undefined)?.[target.id]
  if (hasRetryState(prior)) addOptions = { ...prior.retry.options, retryExisting: true }
  else if (target.type === 'lidarr') addOptions = { ...addOptions, retryExisting: true }
  const targetJobId = jobRecorder
    ? await jobRecorder.start({
        type: 'target',
        userId,
        metadata: {
          targetType: target.type,
          artistName: artist.name,
          mbid: artist.mbid,
          action: 'add',
          ...(addOptions.monitorOption ? { monitorOption: addOptions.monitorOption } : {}),
          ...(Array.isArray(addOptions.selectedAlbumIds) && addOptions.selectedAlbumIds.length
            ? { selectedAlbumIds: addOptions.selectedAlbumIds }
            : {}),
        },
      })
    : null

  const result = await target
    .addArtist?.(artist, addOptions)
    .catch((error: unknown): import('@/core/targets/types').TargetResult => ({
      success: false,
      targetType: target.type,
      targetId: 0,
      error: errMsg(error),
    }))

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
      await recordFailureSafely(jobRecorder, targetJobId, result.error ?? 'Target returned failure')
    }
  }

  return {
    action: targetAction(
      target,
      result,
      Object.fromEntries(Object.entries(addOptions).filter(([key]) => key !== 'priorActions')),
      isWaitingAction(prior) ? prior : undefined,
    ),
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

  const priorActions = (addOptions.priorActions ?? {}) as Record<string, unknown>
  const continuations = new Set(
    Object.values(priorActions)
      .filter(hasRetryState)
      .map((a) => a.retry.options.followUpTargetId)
      .filter(Boolean),
  )
  for (const target of actionableTargets) {
    if (continuations.has(target.id)) continue
    const prior = priorActions[target.id]
    const followUp = hasRetryState(prior)
      ? actionableTargets.find((t) => t.id === prior.retry.options.followUpTargetId)
      : undefined
    if (followUp && recommendationId != null) {
      const combined = await approveWithCombinedLidarrSlskd(
        artist,
        target,
        followUp,
        addOptions,
        recommendationId,
        jobRecorder,
        userId,
      )
      Object.assign(targetActions, combined.targetActions)
      if (combined.lidarrArtistId) {
        lidarrArtistId = combined.lidarrArtistId
        anySuccess = true
      }
      if (combined.lidarrError) lidarrError = combined.lidarrError
      continue
    }
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

  const status = hasWaitingAction(targetActions)
    ? 'waiting'
    : lidarrArtistId
      ? 'added_to_lidarr'
      : anySuccess
        ? 'approved'
        : 'add_failed'
  return { status, targetActions, lidarrArtistId, lidarrError }
}

/** Approve-to-target logic for album-kind recs (uses the addAlbum capability). */
async function approveAlbumToTargets(
  album: { artistMbid: string; artistName: string; releaseGroupMbid: string },
  targets: TargetWithCapabilities[],
  addOptions: Record<string, unknown>,
  jobRecorder?: import('@/core/jobs/types').JobRecorder,
  userId?: number,
  recommendationId?: number,
): Promise<ApproveResult> {
  const actionableTargets = targets.filter((target) => target.capabilities?.includes('addAlbum'))

  if (actionableTargets.length === 0) {
    return { status: 'add_failed', targetActions: {} }
  }

  const targetActions: Record<string, unknown> = {}
  let anySuccess = false
  let anyLidarrSuccess = false
  let lidarrError: string | undefined

  for (const target of actionableTargets) {
    const targetJobId = jobRecorder
      ? await jobRecorder.start({
          type: 'target',
          userId,
          metadata: {
            targetType: target.type,
            artistName: album.artistName,
            mbid: album.artistMbid,
            releaseGroupMbid: album.releaseGroupMbid,
            action: 'addAlbum',
          },
        })
      : null

    const prior = (addOptions.priorActions as Record<string, unknown> | undefined)?.[target.id]
    const options = hasRetryState(prior)
      ? { ...prior.retry.options, retryExisting: true }
      : Object.fromEntries(Object.entries(addOptions).filter(([key]) => key !== 'priorActions'))
    const result = await target
      .addAlbum?.(
        {
          artistMbid: album.artistMbid,
          artistName: album.artistName,
          releaseGroupMbid: album.releaseGroupMbid,
        },
        { ...options, userId, recommendationId },
      )
      .catch((error: unknown): import('@/core/targets/types').TargetResult => ({
        success: false,
        targetType: target.type,
        targetId: 0,
        error: conciseErrMsg(error),
      }))

    if (!result) {
      targetActions[target.id] = {
        status: 'failed',
        error: 'Target did not return an album result',
      }
      if (targetJobId != null && jobRecorder) {
        await jobRecorder.complete(targetJobId, {
          metadata: { targetType: target.type, artistName: album.artistName, skipped: true },
        })
      }
      continue
    }

    if (targetJobId != null && jobRecorder) {
      if (result.success) {
        await jobRecorder.complete(targetJobId, {
          metadata: {
            targetType: target.type,
            artistName: album.artistName,
            externalId: result.externalId,
          },
        })
      } else {
        await recordFailureSafely(
          jobRecorder,
          targetJobId,
          result.error ?? 'Target returned failure',
        )
      }
    }

    targetActions[target.id] = targetAction(
      target,
      result,
      { ...options, userId, recommendationId },
      isWaitingAction(prior) ? prior : undefined,
    )
    if (result.success) {
      anySuccess = true
      if (target.type === 'lidarr') anyLidarrSuccess = true
    } else if (target.type === 'lidarr') {
      lidarrError = result.error
    }
  }

  const status = hasWaitingAction(targetActions)
    ? 'waiting'
    : anyLidarrSuccess
      ? 'added_to_lidarr'
      : anySuccess
        ? 'approved'
        : 'add_failed'
  // lidarrArtistId stays undefined: the album path returns the Lidarr ALBUM id,
  // wrong semantics for lidarr_artist_id (it's kept in targetActions instead).
  return { status, targetActions, lidarrArtistId: undefined, lidarrError }
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
      followUpTargetId: slskdTarget.id,
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

  const status = hasWaitingAction(targetActions)
    ? 'waiting'
    : lidarrArtistId
      ? 'added_to_lidarr'
      : 'add_failed'
  return { status, targetActions, lidarrArtistId, lidarrError }
}

function isOwned(rec: { userId?: number | null }, callerId?: number): boolean {
  if (callerId === undefined) return true
  return rec.userId === callerId
}

/**
 * Pick the Lidarr target explicit profile/folder IDs belong to. They were
 * loaded from one instance, so they only apply to that target; without an
 * unambiguous target they are dropped and every target uses its own defaults.
 */
function resolveLidarrOptionsTargetId(
  targets: TargetWithCapabilities[],
  scope: { targetId?: string; lidarrTargetId?: string },
): string | undefined {
  const lidarrTargets = targets.filter((target) => target.type === 'lidarr')
  for (const id of [scope.targetId, scope.lidarrTargetId]) {
    if (id && lidarrTargets.some((target) => target.id === id)) return id
  }
  return lidarrTargets.length === 1 ? lidarrTargets[0]?.id : undefined
}

/**
 * Build target add options. Profile/folder defaults are not injected here:
 * each Lidarr target resolves its own (server connection: user/global prefs;
 * separate instance: its stored IDs).
 */
async function buildAddOptions(
  deps: AppDependencies,
  userId: number | undefined,
  artist: ApprovalArtist | undefined,
  overrides: {
    monitorOption?: MonitorOption
    tags?: number[]
    selectedAlbumIds?: string[]
    qualityProfileId?: number
    metadataProfileId?: number
    rootFolderId?: number
    lidarrOptionsTargetId?: string
  },
): Promise<Record<string, unknown>> {
  const popularAlbumIds =
    overrides.monitorOption === 'popular'
      ? await resolvePopularAlbumIds(deps, userId, artist)
      : undefined
  const scope = overrides.lidarrOptionsTargetId

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
    ...(scope
      ? {
          lidarrOptionsTargetId: scope,
          qualityProfileId: overrides.qualityProfileId,
          metadataProfileId: overrides.metadataProfileId,
          rootFolderId: overrides.rootFolderId,
          tags: overrides.tags,
        }
      : {}),
  }
}

function createRecommendationRoutes(
  deps: AppDependencies,
  authorizedRequest?: { userId: number; recommendationId: number },
) {
  const router = new Hono<HonoEnv>()
  const bulkIdempotency = idempotency()
  const requests = deps.approvalRequests ?? approvalRequestQueries(deps.db)

  router.post('/api/v1/recommendations/missing-albums', zJson(missingAlbumsSchema), async (c) => {
    const auth = requireSessionUser(c)
    if (!auth.ok) return auth.response
    const { artistId, albumMbids } = c.req.valid('json')
    const artist = await deps.getArtistById(artistId)
    if (!artist) return problem(c, 'artist-not-found', 'Artist not found', 404)
    if (!deps.albumCoverage) {
      return problem(c, 'album-coverage-unavailable', 'Album coverage unavailable', 503)
    }

    const coverage = await deps.albumCoverage.getCoverageForArtist(auth.userId, artist.mbid)
    const missing = new Set(coverage.missing.map((album) => album.albumMbid.toLowerCase()))
    const selected = [...new Set(albumMbids)]
    if (selected.some((mbid) => !missing.has(mbid))) {
      return problem(c, 'invalid-album-selection', 'Invalid album selection', 400)
    }

    if (requiresApprovalRequest(await deps.getUserById(auth.userId), 0)) {
      const results = []
      for (const albumMbid of selected) {
        const album = coverage.missing.find((entry) => entry.albumMbid.toLowerCase() === albumMbid)
        const id = await requests.ensureAlbumRecommendation(
          auth.userId,
          artistId,
          albumMbid,
          album?.title ?? '',
        )
        try {
          const request = await requests.create(auth.userId, id, { status: 'approved' })
          results.push({
            albumMbid,
            status: 'requested',
            requestId: request.id,
            success: false,
            targetActions: {},
          })
        } catch (error) {
          await requests.cleanupAlbumRecommendation(auth.userId, id)
          if (
            !(error instanceof ApprovalRequestLimitError) &&
            !(error instanceof ApprovalRequestCooldownError)
          )
            throw error
          results.push({
            albumMbid,
            status:
              error instanceof ApprovalRequestCooldownError
                ? 'request_cooldown'
                : 'request_limit_reached',
            success: false,
            targetActions: {},
          })
        }
      }
      if (results.every((entry) => entry.status === 'request_cooldown'))
        return problem(
          c,
          'approval-request-cooldown',
          'This request was recently declined. Try again after 24 hours.',
          409,
          undefined,
          { results },
          'errors.approval.declineCooldown',
        )
      if (results.every((entry) => entry.status === 'request_limit_reached'))
        return problem(
          c,
          'approval-request-limit',
          'The maximum number of open approval requests has been reached',
          409,
          undefined,
          { results },
          'errors.approval.requestLimit',
        )
      return c.json(
        {
          results,
          succeeded: 0,
          failed: results.filter((entry) => entry.status !== 'requested').length,
          requested: results.filter((entry) => entry.status === 'requested').length,
        },
        202,
      )
    }

    const targets = (await deps.getEnabledTargetsForUser(auth.userId)).filter((target) =>
      target.capabilities.includes('addAlbum'),
    )
    if (targets.length === 0) {
      return problem(c, 'no-album-targets', 'No enabled album targets', 400)
    }
    const addOptions = await buildAddOptions(deps, auth.userId, artist, {
      lidarrOptionsTargetId: resolveLidarrOptionsTargetId(targets, {}),
    })
    const results = []
    for (const albumMbid of selected) {
      try {
        const result = await approveAlbumToTargets(
          { artistMbid: artist.mbid, artistName: artist.name, releaseGroupMbid: albumMbid },
          targets,
          addOptions,
          deps.jobRecorder,
          auth.userId,
        )
        const targetActions = Object.fromEntries(
          Object.entries(result.targetActions).map(([id, value]) => {
            const action = value as NonNullable<TargetActionRecord> & { retry?: unknown }
            // No recommendation row backs these adds, so nothing would retry a waiting action.
            const { retry: _retry, ...settled } =
              action.status === 'waiting' ? { ...action, status: 'failed' as const } : action
            return [
              id,
              { ...settled, ...(settled.error ? { error: conciseErrMsg(settled.error) } : {}) },
            ]
          }),
        )
        results.push({
          albumMbid,
          success: targets.every((target) =>
            isTargetSuccess(targetActions[target.id] as TargetActionRecord),
          ),
          targetActions,
        })
      } catch (err) {
        results.push({
          albumMbid,
          success: false,
          targetActions: { batch: { status: 'failed', error: conciseErrMsg(err) } },
        })
      }
    }
    const succeeded = results.filter((result) => result.success).length
    return c.json({ results, succeeded, failed: results.length - succeeded })
  })

  // Missing and non-owned both 404 (don't leak ownership); on failure returns the Response to return as-is.
  const loadOwnedRecommendation = async (
    c: Context<HonoEnv>,
    id: number,
  ): Promise<
    | {
        rec: NonNullable<Awaited<ReturnType<AppDependencies['getRecommendation']>>>
        userId?: number
      }
    | Response
  > => {
    const rec = await deps.getRecommendation(id)
    const userId = c.get('userId')
    if (!rec || !isOwned(rec, userId))
      return problem(
        c,
        'recommendation-not-found',
        'Recommendation not found',
        404,
        undefined,
        undefined,
        'errors.recommendation.notFound',
      )
    return { rec, userId }
  }

  router.get('/api/v1/recommendations', zQuery(listRecommendationsQuerySchema), async (c) => {
    const userId = c.get('userId')
    const query = c.req.valid('query')
    const prefs =
      query.sort === 'taste' || query.tasteTier
        ? mergePreferences(userId ? (await deps.getUserById(userId))?.preferences : undefined)
        : null
    const filters = {
      status: query.status,
      batchId: query.batchId,
      userId,
      decades: query.decades || undefined,
      kind:
        query.kind === 'artist' || query.kind === 'album'
          ? (query.kind as 'artist' | 'album')
          : undefined,
      sort: query.sort,
      tasteTier: query.tasteTier,
      primaryGenres: prefs?.primaryGenres,
      secondaryGenres: prefs?.secondaryGenres,
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
      .map(([genre, { approved, rejected = 0, total }]) => ({
        genre,
        approved,
        rejected,
        other: total - approved - rejected,
        total,
        rate: total > 0 ? approved / total : 0,
      }))
      .filter((e) => e.total >= 3)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 20)

    return c.json({ summary })
  })

  router.get('/api/v1/recommendations/playability', async (c) => {
    const auth = requireUser(c)
    if (!auth.ok) return auth.response
    return c.json(await getPendingPlayability(deps.db, auth.userId))
  })

  // Backs the approve menu's "Popular albums" gating: true when at least one
  // popularity source (Spotify OAuth or a Last.fm API key) is available.
  router.get('/api/v1/recommendations/popular-albums/availability', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ available: false, spotify: false, lastfm: false })
    const [spotify, connections] = await Promise.all([
      resolveProviderToken(deps.db, userId, 'spotify').then(
        () => true,
        () => false,
      ),
      getUserConnections(deps.db, userId),
    ])
    const lastfm = Boolean(connections?.lastfmApiKey)
    return c.json({ available: spotify || lastfm, spotify, lastfm })
  })

  router.get('/api/v1/recommendations/:id', zParam(recommendationIdParamSchema), async (c) => {
    const { id } = c.req.valid('param')
    const loaded = await loadOwnedRecommendation(c, id)
    if (loaded instanceof Response) return loaded
    return c.json(loaded.rec)
  })

  router.patch(
    '/api/v1/recommendations/:id',
    zParam(recommendationIdParamSchema),
    zJson(updateRecommendationSchema),
    async (c, next) => {
      await withApprovalLock(Number(c.req.param('id')), next)
    },
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
        tags,
      } = body

      const approvalMode: ApprovalMode = rawApprovalMode ?? 'single_target'

      if (status === 'approved') {
        const loaded = await loadOwnedRecommendation(c, id)
        if (loaded instanceof Response) return loaded
        const { rec, userId } = loaded

        const requestAuthorized =
          authorizedRequest?.userId === userId && authorizedRequest?.recommendationId === id
        if (
          requestAuthorized &&
          userId &&
          (rec.status === 'rejected' ||
            (typeof deps.storeDb.getBlockedMbids === 'function' &&
              (await deps.storeDb.getBlockedMbids(userId)).has(rec.artist.mbid)) ||
            (rec.kind === 'album' &&
              rec.recommendedReleaseGroupId &&
              typeof deps.storeDb.getBlockedAlbumKeys === 'function' &&
              (await deps.storeDb.getBlockedAlbumKeys(userId)).has(rec.recommendedReleaseGroupId)))
        ) {
          return problem(
            c,
            'approval-recommendation-unavailable',
            'Recommendation is no longer available for approval',
            409,
            undefined,
            undefined,
            'errors.approval.recommendationUnavailable',
          )
        }

        if (
          userId &&
          !requestAuthorized &&
          requiresApprovalRequest(await deps.getUserById(userId), rec.score)
        ) {
          try {
            const request = await requests.create(userId, id, body)
            return c.json(
              { status: 'requested', approvalRequest: request, requestId: request.id },
              202,
            )
          } catch (error) {
            if (error instanceof ApprovalRequestCooldownError)
              return problem(
                c,
                'approval-request-cooldown',
                error.message,
                409,
                undefined,
                undefined,
                'errors.approval.declineCooldown',
              )
            if (error instanceof ApprovalRequestLimitError)
              return problem(
                c,
                'approval-request-limit',
                error.message,
                409,
                undefined,
                undefined,
                'errors.approval.requestLimit',
              )
            throw error
          }
        }

        const sameArtist = (name: string) =>
          name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() ===
          rec.artist.name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
        let feedbackTrack: FeedbackTrack | undefined
        if (body.auditionTrackId !== undefined) {
          try {
            const track = userId
              ? await getOwnedAuditionTrack(deps.db, userId, body.auditionTrackId, rec.artist.mbid)
              : null
            if (track?.trackName?.trim() && sameArtist(track.artistName)) {
              feedbackTrack = {
                artistName: track.artistName,
                trackName: track.trackName,
                ...(track.recordingMbid ? { recordingMbid: track.recordingMbid } : {}),
              }
            }
          } catch {
            console.error('[write-back] Could not resolve approved Audition track')
          }
        } else if (body.feedbackTrack && sameArtist(body.feedbackTrack.artistName)) {
          feedbackTrack = body.feedbackTrack
        }

        const targets = userId ? await deps.getEnabledTargetsForUser(userId) : []
        const priorActions = rec.targetActions ?? {}
        const effectiveTargets = targets.filter((t) =>
          targetId
            ? t.id === targetId
            : !['added', 'queued'].includes(
                (priorActions[t.id] as TargetActionRecord)?.status ?? '',
              ),
        )
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

        // Album recs resolve the target album via releaseGroupMbid and ignore
        // selectedAlbumIds entirely, so skip the popular/selected resolution
        // (which hits Spotify/MusicBrainz and can 400 when Spotify is unset).
        const isAlbumRec = rec.kind === 'album'

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
              monitorOption: isAlbumRec ? undefined : ((monitorOption ?? 'none') as MonitorOption),
              selectedAlbumIds: isAlbumRec ? undefined : selectedAlbumIds,
              qualityProfileId: qpOverride,
              metadataProfileId: mpOverride,
              rootFolderId: rfOverride,
              tags,
              lidarrOptionsTargetId: resolveLidarrOptionsTargetId(
                approvalMode === 'combined_lidarr_slskd' && lidarrTarget
                  ? [lidarrTarget]
                  : effectiveTargets,
                { targetId, lidarrTargetId },
              ),
            },
          )
        } catch (err) {
          if (monitorOption !== 'popular') throw err
          return c.json(
            {
              error: err instanceof Error ? err.message : 'Popular albums could not be resolved',
              code: err instanceof PopularAlbumsError ? err.code : undefined,
            },
            400,
          )
        }

        addOptions.priorActions = priorActions

        const result =
          rec.kind === 'album' && rec.recommendedReleaseGroupId
            ? await approveAlbumToTargets(
                {
                  artistMbid: rec.artist.mbid,
                  artistName: rec.artist.name,
                  releaseGroupMbid: rec.recommendedReleaseGroupId,
                },
                effectiveTargets,
                addOptions,
                deps.jobRecorder,
                userId,
                id,
              )
            : approvalMode === 'combined_lidarr_slskd' && lidarrTarget && slskdTarget
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

        // Merge this attempt over any prior target actions so a single-target
        // retry preserves the outcomes of targets that already succeeded.
        const mergedActions = { ...priorActions, ...result.targetActions }
        const lidarrArtistId = result.lidarrArtistId ?? rec.lidarrArtistId ?? undefined
        // Only re-derive across the merged map when retrying a rec that already
        // had outcomes; a first approve keeps this attempt's own status (which
        // also covers the no-actionable-targets "approved" special case).
        const finalStatus =
          Object.keys(priorActions).length > 0
            ? deriveStatusFromActions(mergedActions, lidarrArtistId)
            : result.status

        const extra: Record<string, unknown> = { targetActions: mergedActions }
        if (lidarrArtistId) extra.lidarrArtistId = lidarrArtistId
        if (result.lidarrError) extra.lidarrError = result.lidarrError

        await deps.updateRecommendationStatus(id, finalStatus, extra)

        if (
          userId &&
          feedbackTrack &&
          (finalStatus === 'approved' || finalStatus === 'added_to_lidarr')
        ) {
          void deps.scrobblerWriteBack?.approvedTrack(userId, feedbackTrack).catch(() => {
            console.error('[write-back] Could not dispatch approved track')
          })
        }

        const targetsById = new Map(targets.map((target) => [target.id, target]))
        return c.json({
          status: finalStatus,
          targetActions: mergedActions,
          targetSummary: summarizeTargetActions(result.targetActions, targetsById),
          ...(result.lidarrError ? { lidarrError: result.lidarrError } : {}),
        })
      }

      const loaded = await loadOwnedRecommendation(c, id)
      if (loaded instanceof Response) return loaded
      const { userId } = loaded

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
        const rejected = await deps.rejectRecommendation({
          recommendationId: id,
          userId,
          reason: validated.data.reason ?? null,
          reasonText: validated.data.reasonText ?? null,
          permanent: validated.data.permanent,
        })
        return c.json({ status: 'rejected', blockCreated: rejected?.blockCreated ?? false })
      }

      await deps.updateRecommendationStatus(id, status)
      return c.json({ status })
    },
  )

  router.post(
    '/api/v1/recommendations/bulk',
    bulkIdempotency,
    zJson(bulkRecommendationSchema),
    async (c) => {
      const {
        ids,
        action,
        targetId,
        qualityProfileId: qpOverride,
        metadataProfileId: mpOverride,
        rootFolderId: rfOverride,
        reason,
        permanent,
      } = c.req.valid('json')

      const userId = c.get('userId')

      if (action === 'reject') {
        const ownedIds = await deps.filterOwnedIds(ids, userId)
        return withApprovalLocks(ownedIds, async () => {
          // Fast path: no shared reason/permanent => a single bulk status update,
          // preserving the prior reason-less behaviour.
          if (!reason && !permanent) {
            if (ownedIds.length > 0) {
              await deps.bulkUpdateStatus(ownedIds, 'rejected')
            }
            return c.json({ updated: ownedIds.length })
          }
          await deps.bulkRejectRecommendations({
            ids: ownedIds,
            userId,
            reason: reason ?? null,
            reasonText: null,
            permanent,
          })
          return c.json({ updated: ownedIds.length })
        })
      }

      const approvalUser = userId ? await deps.getUserById(userId) : null

      // Approve: route through targets
      const targets = userId ? await deps.getEnabledTargetsForUser(userId) : []
      const effectiveTargets = targetId ? targets.filter((t) => t.id === targetId) : targets
      if (targetId && effectiveTargets.length === 0) {
        return c.json({ error: `Unknown targetId: ${targetId}` }, 400)
      }
      if (
        targetId &&
        !effectiveTargets.some(
          (t) => t.capabilities?.includes('addArtist') || t.capabilities?.includes('addAlbum'),
        )
      ) {
        return c.json(
          { error: `Target does not support recommendation approval: ${targetId}` },
          400,
        )
      }

      const addOptions = await buildAddOptions(deps, userId, undefined, {
        qualityProfileId: qpOverride,
        metadataProfileId: mpOverride,
        rootFolderId: rfOverride,
        lidarrOptionsTargetId: resolveLidarrOptionsTargetId(effectiveTargets, { targetId }),
      })

      const results: Array<{
        id: number
        status: string
        error?: string
        code?: string
        requestId?: number
      }> = []

      for (const id of ids) {
        await withApprovalLock(id, async () => {
          const rec = await deps.getRecommendation(id)
          if (!rec) {
            results.push({ id, status: 'not_found' })
            return
          }
          if (!isOwned(rec, userId)) {
            results.push({ id, status: 'not_found' })
            return
          }

          if (userId && requiresApprovalRequest(approvalUser, rec.score)) {
            try {
              const request = await requests.create(userId, id, {
                status: 'approved',
                targetId,
                qualityProfileId: qpOverride,
                metadataProfileId: mpOverride,
                rootFolderId: rfOverride,
              })
              results.push({ id, status: 'requested', requestId: request.id })
            } catch (error) {
              if (
                !(error instanceof ApprovalRequestLimitError) &&
                !(error instanceof ApprovalRequestCooldownError)
              )
                throw error
              results.push({
                id,
                status:
                  error instanceof ApprovalRequestCooldownError
                    ? 'request_cooldown'
                    : 'request_limit_reached',
                error: error.message,
                code:
                  error instanceof ApprovalRequestCooldownError
                    ? 'errors.approval.declineCooldown'
                    : 'errors.approval.requestLimit',
              })
            }
            return
          }

          const result: ApproveResult =
            rec.kind === 'album'
              ? rec.recommendedReleaseGroupId
                ? await approveAlbumToTargets(
                    {
                      artistMbid: rec.artist.mbid,
                      artistName: rec.artist.name,
                      releaseGroupMbid: rec.recommendedReleaseGroupId,
                    },
                    effectiveTargets.filter(
                      (t) =>
                        !['added', 'queued'].includes(
                          (rec.targetActions?.[t.id] as TargetActionRecord)?.status ?? '',
                        ),
                    ),
                    { ...addOptions, priorActions: rec.targetActions },
                    deps.jobRecorder,
                    userId,
                    id,
                  )
                : { status: 'add_failed', targetActions: {} }
              : await approveToTargets(
                  { mbid: rec.artist.mbid, name: rec.artist.name },
                  effectiveTargets.filter(
                    (t) =>
                      !['added', 'queued'].includes(
                        (rec.targetActions?.[t.id] as TargetActionRecord)?.status ?? '',
                      ),
                  ),
                  { ...addOptions, priorActions: rec.targetActions },
                  deps.jobRecorder,
                  userId,
                  id,
                )

          const mergedActions = { ...rec.targetActions, ...result.targetActions }
          if (Object.keys(rec.targetActions ?? {}).length > 0)
            result.status = deriveStatusFromActions(
              mergedActions,
              result.lidarrArtistId ?? rec.lidarrArtistId ?? undefined,
            )
          const extra: Record<string, unknown> = { targetActions: mergedActions }
          if (result.lidarrArtistId) extra.lidarrArtistId = result.lidarrArtistId
          if (result.lidarrError) extra.lidarrError = result.lidarrError
          await deps.updateRecommendationStatus(id, result.status, extra)
          results.push({ id, status: result.status })
        })
      }

      if (results.length > 0 && results.every((entry) => entry.status === 'request_cooldown'))
        return problem(
          c,
          'approval-request-cooldown',
          'This request was recently declined. Try again after 24 hours.',
          409,
          undefined,
          { results },
          'errors.approval.declineCooldown',
        )
      if (results.length > 0 && results.every((entry) => entry.status === 'request_limit_reached'))
        return problem(
          c,
          'approval-request-limit',
          'The maximum number of open approval requests has been reached',
          409,
          undefined,
          { results },
          'errors.approval.requestLimit',
        )
      return c.json({ results })
    },
  )

  return router
}

export function recommendationRoutes(deps: AppDependencies) {
  return createRecommendationRoutes(deps)
}

export async function executeRequestedApproval(
  deps: AppDependencies,
  userId: number,
  recommendationId: number,
  options: Record<string, unknown>,
) {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    c.set('userId', userId)
    await next()
  })
  app.route('/', createRecommendationRoutes(deps, { userId, recommendationId }))
  return app.request(`/api/v1/recommendations/${recommendationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...options, status: 'approved' }),
  })
}
