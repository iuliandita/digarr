import type { SettingsRow } from '@/db/queries/settings'
import type { UserConnections, UserPublic } from '@/db/queries/users'

type LegacyListeningConfig = Partial<
  Pick<
    SettingsRow,
    'listenbrainzUsername' | 'listenbrainzToken' | 'lastfmUsername' | 'lastfmApiKey'
  >
>

type Logger = {
  info: (message: string) => void
  warn: (message: string) => void
}

export async function migrateLegacyListeningConnections(args: {
  settings: SettingsRow | null
  envLegacy: LegacyListeningConfig
  users: UserPublic[]
  getUserConnections: (userId: number) => Promise<UserConnections | null>
  updateUserConnections: (userId: number, data: Partial<UserConnections>) => Promise<void>
  updateSettings: (
    partial: Partial<
      Pick<
        SettingsRow,
        'listenbrainzUsername' | 'listenbrainzToken' | 'lastfmUsername' | 'lastfmApiKey'
      >
    >,
  ) => Promise<void>
  log?: Logger
}): Promise<void> {
  const log = args.log ?? console
  const legacy = {
    listenbrainzUsername:
      args.settings?.listenbrainzUsername ?? args.envLegacy.listenbrainzUsername ?? null,
    listenbrainzToken: args.settings?.listenbrainzToken ?? args.envLegacy.listenbrainzToken ?? null,
    lastfmUsername: args.settings?.lastfmUsername ?? args.envLegacy.lastfmUsername ?? null,
    lastfmApiKey: args.settings?.lastfmApiKey ?? args.envLegacy.lastfmApiKey ?? null,
  }

  const hasLegacy =
    Boolean(legacy.listenbrainzUsername && legacy.listenbrainzToken) ||
    Boolean(legacy.lastfmUsername && legacy.lastfmApiKey)
  if (!hasLegacy) return

  const targetUser = resolveTargetUser(args.users)
  if (!targetUser) {
    log.warn(
      '[boot] Legacy global listening sources need manual reassignment before they can be used safely.',
    )
    return
  }

  const existing = await args.getUserConnections(targetUser.id)
  const patch: Partial<UserConnections> = {}

  if (legacy.listenbrainzUsername && legacy.listenbrainzToken && !existing?.listenbrainzUsername) {
    patch.listenbrainzUsername = legacy.listenbrainzUsername
    patch.listenbrainzToken = legacy.listenbrainzToken
  }
  if (legacy.lastfmUsername && legacy.lastfmApiKey && !existing?.lastfmUsername) {
    patch.lastfmUsername = legacy.lastfmUsername
    patch.lastfmApiKey = legacy.lastfmApiKey
  }

  if (Object.keys(patch).length > 0) {
    await args.updateUserConnections(targetUser.id, patch)
  }

  if (
    args.settings &&
    (args.settings.listenbrainzUsername ||
      args.settings.listenbrainzToken ||
      args.settings.lastfmUsername ||
      args.settings.lastfmApiKey)
  ) {
    await args.updateSettings({
      listenbrainzUsername: null,
      listenbrainzToken: null,
      lastfmUsername: null,
      lastfmApiKey: null,
    })
  }

  log.info(`[boot] Migrated legacy global listening sources to user "${targetUser.username}"`)
}

function resolveTargetUser(users: UserPublic[]): UserPublic | null {
  if (users.length === 1) return users[0] ?? null
  const admins = users.filter((user) => user.isAdmin)
  if (admins.length === 1) return admins[0] ?? null
  return null
}
