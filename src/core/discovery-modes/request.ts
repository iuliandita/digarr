import type { DiscoveryModeRegistry } from './registry'

export type DiscoverySettingsMode = 'easy' | 'advanced'
export type DiscoveryTriggerType = 'manual' | 'subscription'

export type DiscoveryModeRequest = {
  modeId: string
  triggerType: DiscoveryTriggerType
  settingsMode: DiscoverySettingsMode
  userId: number
  rawUserSettings: Record<string, unknown>
  normalizedSettings: Record<string, unknown>
  providerContext: Record<string, unknown>
  fallbackPolicy: 'strict' | 'allow-fallback'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function normalizeDiscoveryModeRequest(
  userId: number,
  body: unknown,
  registry: DiscoveryModeRegistry,
): DiscoveryModeRequest {
  const input = asRecord(body)
  const modeId = typeof input.modeId === 'string' ? input.modeId.trim() : ''
  if (!modeId) {
    throw new Error('modeId is required')
  }
  if (!registry.get(modeId)) {
    throw new Error(`Unknown discovery mode '${modeId}'`)
  }

  const settingsMode = input.settingsMode === 'advanced' ? 'advanced' : 'easy'
  const fallbackPolicy = input.fallbackPolicy === 'strict' ? 'strict' : 'allow-fallback'
  const rawUserSettings = asRecord(input.rawUserSettings)
  const normalizedSettingsInput = asRecord(input.normalizedSettings)

  return {
    modeId,
    triggerType: 'manual',
    settingsMode,
    userId,
    rawUserSettings,
    normalizedSettings:
      Object.keys(normalizedSettingsInput).length > 0 ? normalizedSettingsInput : rawUserSettings,
    providerContext: asRecord(input.providerContext),
    fallbackPolicy,
  }
}
