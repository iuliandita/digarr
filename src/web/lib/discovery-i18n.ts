import type { DiscoveryConfigField } from '@/core/discovery-modes/types'
import type { MessageKey } from '@/core/i18n/messages/types'

type Translate = (key: MessageKey) => string

const MODE_ID_ALIASES: Record<string, string> = {
  'lb-artist-radio': 'artist-radio',
  'lb-user-radio': 'user-radio',
  'lb-tag-radio': 'tag-radio',
}

const FIELD_KEY_ALIASES: Record<string, string> = {
  seedArtistMbid: 'artist',
  targetUsername: 'username',
  maxUsers: 'usersToSample',
  count: 'recordingsToFetch',
  popBegin: 'popularityMin',
  popEnd: 'popularityMax',
  windowDays: 'releaseWindow',
  relationshipTypes: 'relationships',
}

const FIELD_HELP_KEY_ALIASES: Record<string, string> = {
  seedArtistMbid: 'helpArtistSeed',
}

const OPTION_VALUE_ALIASES: Record<string, string> = {
  easy: 'safe',
  hard: 'adventurous',
}

const REASON_KEY_ALIASES: Record<string, MessageKey> = {
  'Connect ListenBrainz to use this mode.': 'discoveryMode.reason.connectListenBrainz',
  'Connect a listening source first.': 'discoveryMode.reason.connectListeningSource',
  'Connect ListenBrainz or Last.fm to use this mode.':
    'discoveryMode.reason.connectListenBrainzOrLastfm',
  'Using fallback providers for release discovery.': 'discoveryMode.reason.releaseRadarFallback',
  'This mode is not shipped yet.': 'discoveryMode.notShippedYet',
}

function normalizeModeId(modeId: string): string {
  return MODE_ID_ALIASES[modeId] ?? modeId
}

function normalizeFieldKey(fieldKey: string): string {
  return FIELD_KEY_ALIASES[fieldKey] ?? fieldKey
}

function normalizeOptionValue(value: string): string {
  const aliased = OPTION_VALUE_ALIASES[value] ?? value
  return aliased.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

function translateKnownKey(t: Translate, key: MessageKey): string | null {
  const translated = t(key)
  return translated === key ? null : translated
}

export function translateDiscoveryModeLabel(
  t: Translate,
  mode: { id: string; label: string },
): string {
  const key = `discoveryMode.${normalizeModeId(mode.id)}.label` as MessageKey
  return translateKnownKey(t, key) ?? mode.label
}

export function translateDiscoveryModeDescription(
  t: Translate,
  mode: { id: string; description: string },
): string {
  const key = `discoveryMode.${normalizeModeId(mode.id)}.description` as MessageKey
  return translateKnownKey(t, key) ?? mode.description
}

export function translateDiscoveryFieldLabel(t: Translate, field: DiscoveryConfigField): string {
  const key = `discoveryMode.field.${normalizeFieldKey(field.key)}` as MessageKey
  return translateKnownKey(t, key) ?? field.label
}

export function translateDiscoveryFieldHelp(
  t: Translate,
  field: DiscoveryConfigField,
): string | undefined {
  if (!field.helpText) return undefined
  const keySuffix = FIELD_HELP_KEY_ALIASES[field.key]
  if (!keySuffix) return field.helpText
  return translateKnownKey(t, `discoveryMode.field.${keySuffix}` as MessageKey) ?? field.helpText
}

export function translateDiscoveryOption(
  t: Translate,
  option: { value: string; label: string },
): string {
  const key = `discoveryMode.option.${normalizeOptionValue(option.value)}` as MessageKey
  return translateKnownKey(t, key) ?? option.label
}

export function translateDiscoveryReason(t: Translate, reason?: string | null): string | null {
  if (!reason) return null
  const key = REASON_KEY_ALIASES[reason]
  return key ? t(key) : reason
}

export function buildDiscoveryFieldRequiredMessage(
  t: Translate,
  field: DiscoveryConfigField,
): string {
  return t('discoveryMode.fieldRequired').replace('{0}', translateDiscoveryFieldLabel(t, field))
}
