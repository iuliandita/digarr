import { normalizeDiscoveryCandidates } from './candidates'
import type { DiscoveryModeRegistry } from './registry'
import type { DiscoveryModeRequest } from './request'
import type { DiscoveryExecutionResult } from './types'

export async function executeDiscoveryMode(
  request: DiscoveryModeRequest,
  registry: DiscoveryModeRegistry,
): Promise<DiscoveryExecutionResult> {
  const mode = registry.get(request.modeId)
  if (!mode) {
    throw new Error(`Unknown discovery mode '${request.modeId}'`)
  }

  const result = await mode.executor(request)

  return {
    candidates: normalizeDiscoveryCandidates(result.candidates, request.modeId),
  }
}
