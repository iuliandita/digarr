import { filter } from '@/core/pipeline/filter'
import { resolve } from '@/core/pipeline/resolve'
import { score } from '@/core/pipeline/score'
import { store } from '@/core/pipeline/store'
import { resolveWeights } from '@/core/pipeline/weight-presets'
import type {
  RunResult,
  SubscriptionAdapter,
  SubscriptionConfig,
  SubscriptionRunDeps,
} from '@/core/subscriptions/types'
import { errMsg } from '@/core/validation'

export async function runSubscription(
  subscription: SubscriptionConfig,
  adapter: SubscriptionAdapter,
  deps: SubscriptionRunDeps,
): Promise<RunResult> {
  const { queries, jobRecorder } = deps

  const jobId = await jobRecorder.start({
    type: 'subscription',
    userId: subscription.userId ?? undefined,
    subscriptionId: subscription.id,
    metadata: { adapterType: subscription.sourceType },
  })

  try {
    const { artists } = await adapter.fetch(subscription.sourceConfig, {
      limit: subscription.maxArtistsPerRun ?? undefined,
    })

    if (artists.length === 0) {
      await jobRecorder.complete(jobId, {
        metadata: { adapterType: subscription.sourceType, artistsFound: 0, artistsNew: 0 },
      })
      await queries.updateSubscription(subscription.id, {
        lastRunAt: new Date(),
        lastResultCount: 0,
        lastError: null,
      })
      return { runId: jobId, batchId: null, artistsFound: 0, artistsNew: 0 }
    }

    const artistsFound = artists.length

    const resolved = await resolve(
      artists,
      deps.mbClient as Parameters<typeof resolve>[1],
      undefined,
      deps.lidarr as Parameters<typeof resolve>[3],
    )

    const weightPreset = subscription.scoringWeightPreset ?? 'default'
    const weights = resolveWeights(weightPreset, subscription.scoringWeightOverrides)
    const scored = score(resolved, deps.libraryGenres, weights, deps.feedbackHistory)
    const threshold = subscription.scoreThreshold ?? deps.defaultScoreThreshold
    const filtered = filter(
      scored,
      deps.libraryMbids,
      deps.rejectedMbids,
      deps.cooldownDays,
      threshold,
      deps.topArtistNames,
    )

    let batchId: number | undefined
    if (filtered.length > 0) {
      batchId = await store(filtered, deps.db, {
        userId: subscription.userId ?? undefined,
        subscriptionId: subscription.id,
      })
    }

    const artistsNew = filtered.length

    await jobRecorder.complete(jobId, {
      metadata: { adapterType: subscription.sourceType, artistsFound, artistsNew },
      batchId,
    })

    await queries.updateSubscription(subscription.id, {
      lastRunAt: new Date(),
      lastResultCount: artistsNew,
      lastError: null,
    })

    return { runId: jobId, batchId: batchId ?? null, artistsFound, artistsNew }
  } catch (err: unknown) {
    const errorMessage = errMsg(err)
    console.error(`[subscription-runner] Subscription ${subscription.id} failed:`, err)

    await jobRecorder
      .fail(jobId, errorMessage)
      .catch((e: unknown) =>
        console.error('[subscription-runner] Failed to record job failure:', e),
      )

    await queries
      .updateSubscription(subscription.id, {
        lastRunAt: new Date(),
        lastError: errorMessage,
      })
      .catch((e: unknown) =>
        console.error('[subscription-runner] Failed to update subscription error:', e),
      )

    throw err
  }
}
