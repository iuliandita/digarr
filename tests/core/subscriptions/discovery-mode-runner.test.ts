// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  normalizeDiscoveryModeSubscription,
  type DiscoveryModeSubscriptionConfig,
} from '@/core/subscriptions/runner'
import type { SubscriptionConfig } from '@/core/subscriptions/types'

function makeSubscription(
  sourceConfig: DiscoveryModeSubscriptionConfig,
  overrides: Partial<SubscriptionConfig> = {},
): SubscriptionConfig {
  return {
    id: 1,
    userId: 7,
    sourceType: 'discovery-mode',
    sourceConfig,
    maxArtistsPerRun: null,
    scoreThreshold: null,
    scoringWeightPreset: null,
    scoringWeightOverrides: null,
    ...overrides,
  }
}

describe('normalizeDiscoveryModeSubscription', () => {
  it('turns a discovery-mode subscription into a subscription-triggered discovery request', () => {
    const request = normalizeDiscoveryModeSubscription(
      makeSubscription({
        modeId: 'labels',
        settingsMode: 'advanced',
        settings: { seedArtists: ['Broadcast'], depth: 2 },
      }),
      7,
    )

    expect(request).toEqual({
      modeId: 'labels',
      triggerType: 'subscription',
      settingsMode: 'advanced',
      userId: 7,
      rawUserSettings: { seedArtists: ['Broadcast'], depth: 2 },
      normalizedSettings: { seedArtists: ['Broadcast'], depth: 2 },
      providerContext: {},
      fallbackPolicy: 'allow-fallback',
    })
  })
})
