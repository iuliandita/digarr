import type { SupportedLocale } from '@/core/i18n/locales'
import { createTranslator } from '@/core/i18n/translator'
import type { JobRecorder } from '@/core/jobs/types'
import type { WebhookPayload } from '@/core/notifications'
import { errMsg, redactSecrets } from '@/core/validation'
import type { RecommendationWithArtist, StatusUpdateExtra } from '@/db/queries/recommendations'
import { deriveStatusFromActions } from './action-status'
import {
  hasWaitingAction,
  isWaitingAction,
  LIDARR_RETRY_WINDOW,
  targetAction,
} from './lidarr-retry'
import { type DestinationTarget, type TargetResult, targetDbId } from './types'

export type LidarrRetryDeps = {
  listWaiting: () => Promise<RecommendationWithArtist[]>
  getRecommendation: (id: number) => Promise<RecommendationWithArtist | null>
  getTargets: (userId: number) => Promise<DestinationTarget[]>
  isBlocked: (rec: RecommendationWithArtist) => Promise<boolean>
  update: (id: number, status: string, extra: StatusUpdateExtra) => Promise<void>
  notify: (payload: WebhookPayload) => Promise<unknown>
  recorder: JobRecorder
  getLocale?: (userId: number) => Promise<SupportedLocale>
  now?: () => number
}

function safeError(error: string): string {
  return redactSecrets(error)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[redacted URL]')
    .slice(0, 2048)
}

const locks = new Map<number, Promise<unknown>>()

export async function withApprovalLock<T>(id: number, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(id)
  const current = (previous ?? Promise.resolve()).catch(() => {}).then(run)
  locks.set(id, current)
  try {
    return await current
  } finally {
    if (locks.get(id) === current) locks.delete(id)
  }
}

export async function withApprovalLocks<T>(ids: number[], run: () => Promise<T>): Promise<T> {
  const ordered = [...new Set(ids)].sort((a, b) => a - b)
  const lock = (index: number): Promise<T> => {
    const id = ordered[index]
    return id === undefined ? run() : withApprovalLock(id, () => lock(index + 1))
  }
  return lock(0)
}

export async function retryWaitingApprovals(deps: LidarrRetryDeps): Promise<void> {
  for (const candidate of await deps.listWaiting()) {
    try {
      await withApprovalLock(candidate.id, async () => {
        const rec = await deps.getRecommendation(candidate.id)
        if (!rec || rec.status === 'rejected' || rec.status === 'pending') return
        const actions = { ...(rec.targetActions ?? {}) }
        const now = deps.now?.() ?? Date.now()
        let changed = false
        let expired = false
        let lastError = rec.lidarrError ? safeError(rec.lidarrError) : undefined
        let lidarrArtistId = rec.lidarrArtistId ?? undefined
        let targets: DestinationTarget[] | undefined
        const alreadyNotified = Object.values(actions).some(
          (a) => a && typeof a === 'object' && 'failureNotifiedAt' in a,
        )
        for (const [id, action] of Object.entries(actions)) {
          if (!isWaitingAction(action)) continue
          if (now >= Date.parse(action.retry.startedAt) + LIDARR_RETRY_WINDOW) {
            actions[id] = {
              status: 'failed',
              error: action.error ? safeError(action.error) : undefined,
              retry: action.retry,
              failureNotifiedAt: new Date(now).toISOString(),
            }
            lastError = action.error ? safeError(action.error) : undefined
            expired = true
            changed = true
          }
        }
        try {
          for (const [id, action] of Object.entries(actions)) {
            if (!isWaitingAction(action)) continue
            if (now < Date.parse(action.retry.nextAttemptAt)) continue
            if (await deps.isBlocked(rec)) {
              actions[id] = {
                status: 'failed',
                error: 'Approval blocked by an artist or album block',
              }
              changed = true
              continue
            }
            targets ??= rec.userId == null ? [] : await deps.getTargets(rec.userId)
            const target = targets.find((t) => t.id === id && t.type === 'lidarr')
            // A disabled or reassigned target must never send work to another user's connection.
            if (!target) continue
            const jobId = await deps.recorder.start({
              type: 'target',
              userId: rec.userId ?? undefined,
              metadata: {
                targetType: 'lidarr',
                targetId: targetDbId(target.id),
                artistName: rec.artist.name,
                mbid: rec.artist.mbid,
                recommendationId: rec.id,
                action: rec.kind === 'album' ? 'addAlbum' : 'add',
                retry: true,
                ...(rec.recommendedReleaseGroupId
                  ? { releaseGroupMbid: rec.recommendedReleaseGroupId }
                  : {}),
                attempt: action.retry.attempts + 1,
              },
            })
            let result: TargetResult
            try {
              const options = {
                ...action.retry.options,
                retryExisting: true,
                userId: rec.userId ?? undefined,
                recommendationId: rec.id,
              }
              result = (rec.kind === 'album' && rec.recommendedReleaseGroupId
                ? await target.addAlbum?.(
                    {
                      artistMbid: rec.artist.mbid,
                      artistName: rec.artist.name,
                      releaseGroupMbid: rec.recommendedReleaseGroupId,
                    },
                    options,
                  )
                : await target.addArtist?.(
                    { mbid: rec.artist.mbid, name: rec.artist.name },
                    options,
                  )) ?? {
                success: false,
                targetType: 'lidarr',
                targetId: 0,
                error: 'Target does not support approval',
              }
            } catch (error) {
              result = {
                success: false,
                targetType: 'lidarr',
                targetId: 0,
                error: errMsg(error),
              }
            }
            if (result.error) result = { ...result, error: safeError(result.error) }
            if (result.success && rec.kind !== 'album' && action.retry.options.followUpTargetId) {
              const followUpId = action.retry.options.followUpTargetId
              const priorFollowUp = actions[followUpId] as { status?: string } | undefined
              const followUp = targets.find((t) => t.id === followUpId && t.type === 'slskd')
              if (
                followUp?.addArtist &&
                !['added', 'queued'].includes(priorFollowUp?.status ?? '')
              ) {
                const followUpJob = await deps.recorder.start({
                  type: 'target',
                  userId: rec.userId ?? undefined,
                  metadata: {
                    targetType: 'slskd',
                    targetId: targetDbId(followUp.id),
                    artistName: rec.artist.name,
                    mbid: rec.artist.mbid,
                    action: 'add',
                    recommendationId: rec.id,
                  },
                })
                let followUpResult: TargetResult
                try {
                  followUpResult = await followUp.addArtist(
                    { mbid: rec.artist.mbid, name: rec.artist.name },
                    {
                      ...action.retry.options,
                      userId: rec.userId ?? undefined,
                      recommendationId: rec.id,
                      lidarrArtistId: Number(result.externalId),
                    },
                  )
                } catch (error) {
                  followUpResult = {
                    success: false,
                    targetType: 'slskd',
                    targetId: 0,
                    error: errMsg(error),
                  }
                }
                if (followUpResult.error)
                  followUpResult = { ...followUpResult, error: safeError(followUpResult.error) }
                actions[followUpId] = targetAction(followUp, followUpResult, action.retry.options)
                if (followUpResult.success) await deps.recorder.complete(followUpJob)
                else
                  await deps.recorder.fail(
                    followUpJob,
                    followUpResult.error ?? 'Target returned failure',
                  )
              }
            }
            actions[id] = targetAction(target, result, action.retry.options, action, now)
            changed = true
            if (result.success) {
              if (rec.kind !== 'album' && result.externalId != null)
                lidarrArtistId = Number(result.externalId)
              await deps.recorder.complete(jobId, { metadata: { externalId: result.externalId } })
            } else {
              lastError = result.error
              await deps.recorder.fail(jobId, result.error ?? 'Lidarr approval failed')
            }
          }
        } catch (error) {
          console.error(
            `[lidarr-retry] Recommendation ${candidate.id}: ${safeError(errMsg(error))}`,
          )
        }
        if (!changed) return
        const status = deriveStatusFromActions(actions, lidarrArtistId)
        const currentError = Object.entries(actions)
          .filter(([id]) => id.startsWith('lidarr-'))
          .map(([, a]) => a as { status?: string; error?: string })
          .find((a) => a.status === 'waiting' || a.status === 'failed')?.error
        await deps.update(rec.id, status, {
          targetActions: actions,
          lidarrArtistId,
          lidarrError: currentError ? safeError(currentError) : '',
          preserveActedOnAt: hasWaitingAction(actions),
        })
        // Persist the terminal action before dispatch so subsequent ticks send no duplicate alert.
        if (expired && !alreadyNotified) {
          const t = createTranslator(
            rec.userId != null ? await deps.getLocale?.(rec.userId) : undefined,
          )
          await deps.notify({
            event: 'approval_failed',
            recommendationId: rec.id,
            message: t('notification.approvalFailed', rec.artist.name, lastError ?? ''),
            timestamp: new Date(now).toISOString(),
          })
        }
      })
    } catch (error) {
      console.error(`[lidarr-retry] Recommendation ${candidate.id}: ${safeError(errMsg(error))}`)
    }
  }
}
