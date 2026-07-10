import { describe, expect, it } from 'vitest'
import {
  EMPTY_DISCOVERY_SNAPSHOT,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import { createDefaultDiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import { translateDiscoveryReason } from '@/web/lib/discovery-i18n'

describe('translateDiscoveryReason', () => {
  it('falls back to the original reason when the mapped key is missing', () => {
    const reason = 'This mode is not implemented yet.'
    const t = (key: string) => key

    expect(translateDiscoveryReason(t, reason)).toBe(reason)
  })

  it('maps the connect reasons of the four newest modes to i18n keys', () => {
    const t = (key: string) => `T:${key}`

    expect(translateDiscoveryReason(t, 'Connect Last.fm to use this mode.')).toBe(
      'T:discoveryMode.reason.connectLastfm',
    )
    expect(translateDiscoveryReason(t, 'Connect Deezer to use this mode.')).toBe(
      'T:discoveryMode.reason.connectDeezer',
    )
    expect(translateDiscoveryReason(t, 'Connect Spotify to use this mode.')).toBe(
      'T:discoveryMode.reason.connectSpotify',
    )
    expect(translateDiscoveryReason(t, 'Connect Subsonic to use this mode.')).toBe(
      'T:discoveryMode.reason.connectSubsonic',
    )
  })

  it('every registered mode disabled-reason has an i18n alias', () => {
    const t = (key: string) => `T:${key}`

    for (const mode of createDefaultDiscoveryModeRegistry().list()) {
      const result = evaluateDiscoveryModeAvailability(mode.id, EMPTY_DISCOVERY_SNAPSHOT)
      if (result.reason) {
        expect(translateDiscoveryReason(t, result.reason), `mode ${mode.id}`).not.toBe(
          result.reason,
        )
      }
    }
  })
})
