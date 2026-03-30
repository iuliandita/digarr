import { filter } from '@/core/pipeline/filter'
import { resolve } from '@/core/pipeline/resolve'
import { score } from '@/core/pipeline/score'
import { store } from '@/core/pipeline/store'
import { resolveWeights } from '@/core/pipeline/weight-presets'
import type {
  RunResult,
  SubscriptionAdapter,
  SubscriptionConfig,
  SubscriptionQueries,
  SubscriptionRunDeps,
  SubscriptionRunRow,
} from '@/core/subscriptions/types'
import { errMsg } from '@/core/validation'

async function completeEmpty(
  queries: SubscriptionQueries,
  subscriptionId: number,
  runId: number,
  error?: string,
): Promise<void> {
  await queries.completeRun(runId, {
    completedAt: new Date(),
    artistsFound: 0,
    artistsNew: 0,
    error,
  })
  await queries.updateSubscription(subscriptionId, {
    lastRunAt: new Date(),
    lastResultCount: 0,
    lastError: error ?? null,
  })
}

async function handleRunError(
  err: unknown,
  queries: SubscriptionQueries,
  subscriptionId: number,
  runId: number,
): Promise<never> {
  const errorMessage = errMsg(err)
  console.error(`[subscription-runner] Subscription ${subscriptionId} failed:`, err)

  await queries
    .completeRun(runId, {
      completedAt: new Date(),
      artistsFound: 0,
      artistsNew: 0,
      error: errorMessage,
    })
    .catch((e: unknown) => console.error('[subscription-runner] Failed to complete run record:', e))

  await queries
    .updateSubscription(subscriptionId, {
      lastRunAt: new Date(),
      lastError: errorMessage,
    })
    .catch((e: unknown) =>
      console.error('[subscription-runner] Failed to update subscription error:', e),
    )

  throw err
}

async function executePipeline(
  subscription: SubscriptionConfig,
  deps: SubscriptionRunDeps,
  discovered: Parameters<typeof resolve>[0],
  run: SubscriptionRunRow,
): Promise<RunResult> {
  const { queries } = deps
  const artistsFound = discovered.length

  const resolved = await resolve(
    discovered,
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

  await queries.completeRun(run.id, {
    completedAt: new Date(),
    artistsFound,
    artistsNew,
    batchId: batchId ?? null,
  })

  await queries.updateSubscription(subscription.id, {
    lastRunAt: new Date(),
    lastResultCount: artistsNew,
    lastError: null,
  })

  return { runId: run.id, batchId: batchId ?? null, artistsFound, artistsNew }
}

export async function runSubscription(
  subscription: SubscriptionConfig,
  adapter: SubscriptionAdapter,
  deps: SubscriptionRunDeps,
): Promise<RunResult> {
  const { queries } = deps

  const run = await queries.insertRun({ subscriptionId: subscription.id })

  try {
    const { artists } = await adapter.fetch(subscription.sourceConfig, {
      limit: subscription.maxArtistsPerRun ?? undefined,
    })

    if (artists.length === 0) {
      await completeEmpty(queries, subscription.id, run.id)
      return { runId: run.id, batchId: null, artistsFound: 0, artistsNew: 0 }
    }

    return await executePipeline(subscription, deps, artists, run)
  } catch (err: unknown) {
    return handleRunError(err, queries, subscription.id, run.id)
  }
}
