import { discoveryCandidatesToDiscoveredArtists } from '@/core/discovery-modes/candidates'
import { executeDiscoveryMode } from '@/core/discovery-modes/executor'
import type { DiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import type { JobRecorder } from '@/core/jobs/types'
import type { PipelineDeps, PipelineOrchestrator } from '@/core/pipeline/orchestrator'
import { errMsg } from '@/core/validation'

type RunDiscoveryModeParams = {
  request: DiscoveryModeRequest
  registry: DiscoveryModeRegistry
  orchestrator: Pick<PipelineOrchestrator, 'run'>
  subscriptionId?: number
  maxArtistsPerRun?: number
  pipelineDeps: Omit<
    PipelineDeps,
    'explicitCandidates' | 'explicitDiscoveryMode' | 'jobRecorder' | 'trigger' | 'userId'
  >
  jobRecorder?: JobRecorder
}

function extractProviderPath(providerContext: Record<string, unknown>): string[] {
  const providerPath = providerContext.providerPath
  if (!Array.isArray(providerPath)) {
    return []
  }

  return providerPath.filter((segment): segment is string => typeof segment === 'string')
}

export async function runDiscoveryMode({
  request,
  registry,
  orchestrator,
  subscriptionId,
  maxArtistsPerRun,
  pipelineDeps,
  jobRecorder,
}: RunDiscoveryModeParams): Promise<{ batchId: number; artistsFound: number }> {
  const providerPath = extractProviderPath(request.providerContext)

  let jobId: number | null = null
  if (jobRecorder) {
    try {
      jobId = await jobRecorder.start({
        type: 'quick_discover',
        userId: request.userId,
        metadata: {
          trigger: request.triggerType,
          discoveryMode: {
            modeId: request.modeId,
            settingsMode: request.settingsMode,
            providerPath,
          },
        },
      })
    } catch (error: unknown) {
      console.error('[discovery-mode] Failed to record job start:', error)
    }
  }

  try {
    const execution = await executeDiscoveryMode(request, registry)
    const explicitCandidates = discoveryCandidatesToDiscoveredArtists(execution.candidates).slice(
      0,
      maxArtistsPerRun ?? Number.POSITIVE_INFINITY,
    )

    const result = await orchestrator.run({
      ...pipelineDeps,
      userId: request.userId,
      subscriptionId,
      trigger: request.triggerType === 'subscription' ? 'scheduled' : 'manual',
      explicitDiscoveryMode: {
        modeId: request.modeId,
        settingsMode: request.settingsMode,
        providerPath,
      },
      explicitCandidates,
    })

    if (jobId != null && jobRecorder) {
      await jobRecorder.complete(jobId, {
        metadata: {
          trigger: request.triggerType,
          artistsDiscovered: explicitCandidates.length,
          discoveryMode: {
            modeId: request.modeId,
            settingsMode: request.settingsMode,
            providerPath,
          },
        },
        batchId: result.batchId,
      })
    }

    return { batchId: result.batchId, artistsFound: explicitCandidates.length }
  } catch (error: unknown) {
    if (jobId != null && jobRecorder) {
      await jobRecorder.fail(jobId, errMsg(error)).catch(() => {})
    }
    throw error
  }
}
