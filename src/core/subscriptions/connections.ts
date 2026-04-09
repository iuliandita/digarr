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
  void settings
  return {
    lbUsername: userConnections?.listenbrainzUsername ?? null,
    lbToken: userConnections?.listenbrainzToken ?? null,
    lfUsername: userConnections?.lastfmUsername ?? null,
    lfApiKey: userConnections?.lastfmApiKey ?? null,
  }
}
