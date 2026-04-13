import type { DiscoveryModeRegistry } from './registry'
import type { DiscoveryModeRequest } from './request'

export async function prepareDiscoveryModeRequest(
  request: DiscoveryModeRequest,
  registry: DiscoveryModeRegistry,
): Promise<DiscoveryModeRequest> {
  const mode = registry.get(request.modeId)
  if (!mode) {
    throw new Error(`Unknown discovery mode '${request.modeId}'`)
  }

  return mode.prepare ? mode.prepare(request) : request
}
