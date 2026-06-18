import { discoveryCandidatesToDiscoveredArtists } from '@/core/discovery-modes/candidates'
import { executeDiscoveryMode } from '@/core/discovery-modes/executor'
import { prepareDiscoveryModeRequest } from '@/core/discovery-modes/prepare'
import type { DiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'
import { recordFailureSafely } from '@/core/jobs/record-failure-safely'
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
  existingJobId?: number
}

function extractProviderPath(providerContext: Record<string, unknown>): string[] {
  const providerPath = providerContext.providerPath
  if (!Array.isArray(providerPath)) {
    return []
  }

  return providerPath.filter((segment): segment is string => typeof segment === 'string')
}

export function buildDiscoveryModeJobMetadata(request: DiscoveryModeRequest) {
  return {
    trigger: request.triggerType,
    discoveryMode: {
      modeId: request.modeId,
      settingsMode: request.settingsMode,
      providerPath: extractProviderPath(request.providerContext),
    },
  }
}

export async function runDiscoveryMode({
  request,
  registry,
  orchestrator,
  subscriptionId,
  maxArtistsPerRun,
  pipelineDeps,
  jobRecorder,
  existingJobId,
}: RunDiscoveryModeParams): Promise<{ batchId: number; artistsFound: number }> {
  const preparedRequest = await prepareDiscoveryModeRequest(request, registry)
  const providerPath = extractProviderPath(preparedRequest.providerContext)

  let jobId: number | null = existingJobId ?? null
  if (jobId == null && jobRecorder) {
    try {
      jobId = await jobRecorder.start({
        type: 'quick_discover',
        userId: preparedRequest.userId,
        metadata: buildDiscoveryModeJobMetadata(preparedRequest),
      })
    } catch (error: unknown) {
      console.error('[discovery-mode] Failed to record job start:', error)
    }
  }

  try {
    const execution = await executeDiscoveryMode(preparedRequest, registry)
    const explicitCandidates = discoveryCandidatesToDiscoveredArtists(execution.candidates).slice(
      0,
      maxArtistsPerRun ?? Number.POSITIVE_INFINITY,
    )

    const result = await orchestrator.run({
      ...pipelineDeps,
      userId: preparedRequest.userId,
      subscriptionId,
      trigger: preparedRequest.triggerType === 'subscription' ? 'scheduled' : 'manual',
      explicitDiscoveryMode: {
        modeId: preparedRequest.modeId,
        settingsMode: preparedRequest.settingsMode,
        providerPath,
      },
      explicitCandidates,
    })

    if (jobId != null && jobRecorder) {
      await jobRecorder.complete(jobId, {
        metadata: {
          trigger: preparedRequest.triggerType,
          artistsDiscovered: explicitCandidates.length,
          discoveryMode: {
            modeId: preparedRequest.modeId,
            settingsMode: preparedRequest.settingsMode,
            providerPath,
          },
        },
        batchId: result.batchId,
      })
    }

    return { batchId: result.batchId, artistsFound: explicitCandidates.length }
  } catch (error: unknown) {
    if (jobId != null && jobRecorder) {
      await recordFailureSafely(jobRecorder, jobId, errMsg(error))
    }
    throw error
  }
}
