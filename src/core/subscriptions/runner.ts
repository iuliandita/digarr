import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import { runDiscoveryMode } from '@/core/discovery-modes/run'
import { filter } from '@/core/pipeline/filter'
import { resolve } from '@/core/pipeline/resolve'
import { score } from '@/core/pipeline/score'
import { store } from '@/core/pipeline/store'
import { resolveWeights } from '@/core/pipeline/weight-presets'
import { DISCOVERY_MODE_SUBSCRIPTION_TYPE } from '@/core/subscriptions/registry'
import type {
  DiscoveryModeSubscriptionConfig,
  RunResult,
  SubscriptionAdapter,
  SubscriptionConfig,
  SubscriptionRunDeps,
} from '@/core/subscriptions/types'
import { errMsg } from '@/core/validation'

export type { DiscoveryModeSubscriptionConfig } from '@/core/subscriptions/types'

function isDiscoveryModeSubscriptionConfig(
  value: Record<string, unknown> | DiscoveryModeSubscriptionConfig,
): value is DiscoveryModeSubscriptionConfig {
  return (
    typeof value.modeId === 'string' &&
    (value.settingsMode === 'easy' || value.settingsMode === 'advanced') &&
    value.settings !== null &&
    typeof value.settings === 'object' &&
    !Array.isArray(value.settings)
  )
}

export function normalizeDiscoveryModeSubscription(
  subscription: Pick<SubscriptionConfig, 'sourceType' | 'sourceConfig' | 'userId'>,
  fallbackUserId?: number,
): DiscoveryModeRequest {
  if (subscription.sourceType !== DISCOVERY_MODE_SUBSCRIPTION_TYPE) {
    throw new Error(`Unsupported subscription source type '${subscription.sourceType}'`)
  }
  if (!isDiscoveryModeSubscriptionConfig(subscription.sourceConfig)) {
    throw new Error('Invalid discovery mode subscription config')
  }

  const userId = subscription.userId ?? fallbackUserId
  if (typeof userId !== 'number') {
    throw new Error('Discovery mode subscriptions require a userId')
  }

  return {
    modeId: subscription.sourceConfig.modeId,
    triggerType: 'subscription',
    settingsMode: subscription.sourceConfig.settingsMode,
    userId,
    rawUserSettings: subscription.sourceConfig.settings,
    normalizedSettings: subscription.sourceConfig.settings,
    providerContext: {},
    fallbackPolicy: 'allow-fallback',
  }
}

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
    if (subscription.sourceType === DISCOVERY_MODE_SUBSCRIPTION_TYPE) {
      const discoveryModeRunner = deps.discoveryModeRunner ?? runDiscoveryMode
      if (!deps.discoveryModeRegistry || !deps.pipelineOrchestrator || !deps.discoveryModePipelineDeps) {
        throw new Error('Discovery mode subscriptions require discovery mode dependencies')
      }

      const discoveryRequest = normalizeDiscoveryModeSubscription(subscription, deps.userId)
      const discoveryResult = await discoveryModeRunner({
        request: discoveryRequest,
        registry: deps.discoveryModeRegistry,
        orchestrator: deps.pipelineOrchestrator,
        pipelineDeps: deps.discoveryModePipelineDeps,
      })
      const batchStats = discoveryResult.batchId
        ? await queries.getBatchStats?.(discoveryResult.batchId)
        : null
      const artistsNew = batchStats?.added ?? 0
      const artistsFound = discoveryResult.artistsFound ?? artistsNew

      await jobRecorder.complete(jobId, {
        metadata: { adapterType: subscription.sourceType, artistsFound, artistsNew },
        batchId: discoveryResult.batchId,
      })
      await queries.updateSubscription(subscription.id, {
        lastRunAt: new Date(),
        lastResultCount: artistsNew,
        lastError: null,
      })

      return {
        runId: jobId,
        batchId: discoveryResult.batchId,
        artistsFound,
        artistsNew,
      }
    }

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
