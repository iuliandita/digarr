import type { DiscoveryConfigField } from '@/core/discovery-modes/types'
import type { MessageKey } from '@/core/i18n/messages/types'

type Translate = (key: MessageKey) => string

const MODE_ID_ALIASES: Record<string, string> = {
  'lb-artist-radio': 'artist-radio',
  'lb-user-radio': 'user-radio',
  'lb-tag-radio': 'tag-radio',
}

const FIELD_KEY_ALIASES: Record<string, string> = {
  feedType: 'feed',
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
  targetUsername: 'helpConnectedAccount',
  maxUsers: 'helpSimilarUsers',
  tags: 'helpTags',
  rawTagExpression: 'helpRawTagExpression',
  count: 'helpRecordingCount',
  popBegin: 'helpPopularityMin',
  popEnd: 'helpPopularityMax',
}

const OPTION_VALUE_ALIASES: Record<string, string> = {
  easy: 'safe',
  hard: 'adventurous',
  'member of band': 'memberOfBand',
  collaboration: 'collaboration',
  'supporting musician': 'supportingMusician',
  'is person': 'isPerson',
  sibling: 'sibling',
  married: 'married',
  'involved with': 'involvedWith',
}

const REASON_KEY_ALIASES: Record<string, MessageKey> = {
  'Connect ListenBrainz to use this mode.': 'discoveryMode.reason.connectListenBrainz',
  'Connect a listening source first.': 'discoveryMode.reason.connectListeningSource',
  'Connect ListenBrainz or Last.fm to use this mode.':
    'discoveryMode.reason.connectListenBrainzOrLastfm',
  'Connect Discogs to use this mode.': 'discoveryMode.reason.connectDiscogs',
  'Connect Last.fm to use this mode.': 'discoveryMode.reason.connectLastfm',
  'Connect Deezer to use this mode.': 'discoveryMode.reason.connectDeezer',
  'Connect Spotify to use this mode.': 'discoveryMode.reason.connectSpotify',
  'Reconnect Spotify to grant follow access.': 'discoveryMode.reason.reconnectSpotifyFollow',
  'Connect Subsonic to use this mode.': 'discoveryMode.reason.connectSubsonic',
  'Using fallback providers for release discovery.': 'discoveryMode.reason.releaseRadarFallback',
  'This mode is not implemented yet.': 'discoveryMode.notImplementedYet',
  'This mode is not shipped yet.': 'discoveryMode.notShippedYet',
  'Sync a library first to use this mode.': 'discoveryMode.reason.libraryRequired',
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
  if (option.label.startsWith('discoveryMode.')) {
    return translateKnownKey(t, option.label as MessageKey) ?? option.value
  }
  const key = `discoveryMode.option.${normalizeOptionValue(option.value)}` as MessageKey
  return translateKnownKey(t, key) ?? option.label
}

export function translateDiscoveryReason(t: Translate, reason?: string | null): string | null {
  if (!reason) return null
  const key = REASON_KEY_ALIASES[reason]
  if (!key) return reason
  return translateKnownKey(t, key) ?? reason
}

export function buildDiscoveryFieldRequiredMessage(
  t: Translate,
  field: DiscoveryConfigField,
): string {
  return t('discoveryMode.fieldRequired').replace('{0}', translateDiscoveryFieldLabel(t, field))
}

export function collectDiscoveryMessageKeys(
  modes: Array<{
    id: string
    label: string
    description: string
    easyFields: DiscoveryConfigField[]
    advancedFields: DiscoveryConfigField[]
  }>,
): Set<MessageKey> {
  const keys = new Set<MessageKey>()
  const collect = (key: MessageKey) => {
    keys.add(key)
    return key
  }

  for (const mode of modes) {
    translateDiscoveryModeLabel(collect, mode)
    translateDiscoveryModeDescription(collect, mode)
    for (const field of [...mode.easyFields, ...mode.advancedFields]) {
      translateDiscoveryFieldLabel(collect, field)
      translateDiscoveryFieldHelp(collect, field)
      for (const option of field.options ?? []) translateDiscoveryOption(collect, option)
    }
  }

  return keys
}
