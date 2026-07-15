import { describe, expect, it } from 'vitest'
import {
  type DiscoveryConnectionSnapshot,
  EMPTY_DISCOVERY_SNAPSHOT,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import { createDefaultDiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import { en } from '@/core/i18n/messages/en'
import {
  translateDiscoveryFieldHelp,
  translateDiscoveryFieldLabel,
  translateDiscoveryModeDescription,
  translateDiscoveryModeLabel,
  translateDiscoveryOption,
  translateDiscoveryReason,
} from '@/web/lib/discovery-i18n'

describe('discovery field and option translations', () => {
  const t = (key: string) => `T:${key}`

  it('maps the ListenBrainz feed field to its catalog key', () => {
    expect(
      translateDiscoveryFieldLabel(t, {
        key: 'feedType',
        label: 'Feed',
        type: 'select',
      }),
    ).toBe('T:discoveryMode.field.feed')
  })

  it('uses an explicit catalog-key option label when provided', () => {
    expect(
      translateDiscoveryOption(t, {
        value: 'United States',
        label: 'discoveryMode.option.unitedStates',
      }),
    ).toBe('T:discoveryMode.option.unitedStates')
  })

  it('maps MusicBrainz relationship values to catalog keys', () => {
    expect(translateDiscoveryOption(t, { value: 'member of band', label: 'member of band' })).toBe(
      'T:discoveryMode.option.memberOfBand',
    )
  })

  it('every registry-driven field and option key exists and is live', () => {
    const used = new Set<string>()
    const t = (key: string) => {
      used.add(key)
      return en[key as keyof typeof en] ?? key
    }

    for (const mode of createDefaultDiscoveryModeRegistry().list()) {
      translateDiscoveryModeLabel(t, mode)
      translateDiscoveryModeDescription(t, mode)
      for (const field of [...mode.easyFields, ...mode.advancedFields]) {
        translateDiscoveryFieldLabel(t, field)
        const help = translateDiscoveryFieldHelp((key) => {
          used.add(key)
          return `T:${key}`
        }, field)
        if (field.helpText) {
          expect(help, `${mode.id}.${field.key}`).not.toBe(field.helpText)
        }
        for (const option of field.options ?? []) translateDiscoveryOption(t, option)
      }
    }

    const catalogKeys = Object.keys(en).filter((key) =>
      /^discoveryMode\.(?:[^.]+\.(?:label|description)|field\.[^.]+|option\.[^.]+)$/.test(key),
    )
    expect([...used].sort()).toEqual(catalogKeys.sort())
  })
})

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

  it('reason catalog keys match reasons reachable from registered modes', () => {
    const used = new Set<string>()
    const connectionKeys: Array<keyof DiscoveryConnectionSnapshot> = [
      'hasListenBrainz',
      'hasSpotify',
      'hasLastfm',
      'hasDiscogs',
      'hasDeezer',
      'hasLibrarySync',
      'hasSubsonic',
    ]

    for (let bits = 0; bits < 1 << connectionKeys.length; bits++) {
      const snapshot = { ...EMPTY_DISCOVERY_SNAPSHOT }
      connectionKeys.forEach((key, index) => {
        snapshot[key] = Boolean(bits & (1 << index))
      })
      for (const mode of createDefaultDiscoveryModeRegistry().list()) {
        const reason = evaluateDiscoveryModeAvailability(mode.id, snapshot).reason
        translateDiscoveryReason((key) => {
          used.add(key)
          return en[key]
        }, reason)
      }
    }

    const catalogKeys = Object.keys(en).filter((key) => key.startsWith('discoveryMode.reason.'))
    expect([...used].sort()).toEqual(catalogKeys.sort())
  })
})
