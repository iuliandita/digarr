import type { Preferences } from '@/db/schema'

export type Settings = {
  lidarrUrl?: string
  lidarrApiKey?: string
  listenbrainzUsername?: string
  listenbrainzToken?: string
  lastfmUsername?: string
  lastfmApiKey?: string
  aiProvider?: string
  aiApiKey?: string
  aiModel?: string
  aiBaseUrl?: string
  audiodbApiKey?: string
  audiodbProxyImages?: boolean
  wikidataEnabled?: boolean
  tidalClientId?: string
  tidalClientSecret?: string
  _tidalAppConfigured?: boolean
  _notificationsConfigured?: boolean
  oidcIssuerUrl?: string
  oidcClientId?: string
  oidcClientSecret?: string
  oidcScopes?: string
  plexUrl?: string
  plexToken?: string
  plexSectionId?: string
  plexAccountId?: number | null
  plexAccountName?: string | null
  plexMachineIdentifier?: string | null
  jellyfinUrl?: string
  jellyfinApiKey?: string
  jellyfinUserId?: string
  jellyfinLibraryId?: string
  embyUrl?: string
  embyApiKey?: string
  embyUserId?: string
  embyLibraryId?: string
  discogsToken?: string
  discogsUsername?: string
  subsonicUrl?: string
  subsonicUsername?: string
  subsonicPassword?: string
  librarySyncIntervalHours?: number
  preferences?: Partial<Preferences>
  setupComplete?: boolean
  _listenbrainzScope?: 'user' | 'global'
  _lastfmScope?: 'user' | 'global'
}

export type ServiceTestState = 'idle' | 'testing' | 'ok' | 'error'
