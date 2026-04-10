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
