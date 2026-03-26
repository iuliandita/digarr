import type { SettingsRow } from '@/db/queries/settings'
import type { UserConnections } from '@/db/queries/users'

export function resolveSubscriptionSourceConnections(
  settings: SettingsRow | null,
  userConnections: UserConnections | null,
): {
  lbUsername: string | null
  lbToken: string | null
  lfUsername: string | null
  lfApiKey: string | null
} {
  return {
    lbUsername: userConnections?.listenbrainzUsername ?? settings?.listenbrainzUsername ?? null,
    lbToken: userConnections?.listenbrainzToken ?? settings?.listenbrainzToken ?? null,
    lfUsername: userConnections?.lastfmUsername ?? settings?.lastfmUsername ?? null,
    lfApiKey: userConnections?.lastfmApiKey ?? settings?.lastfmApiKey ?? null,
  }
}
