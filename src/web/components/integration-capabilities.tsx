import type { MessageKey } from '@/core/i18n/messages/types'
import { useI18n } from '@/web/lib/i18n'

type Capability = {
  serviceKey: string
  serviceLabel: string
  discovery: MessageKey | null
  subscriptions: MessageKey | null
  librarySync: MessageKey | null
  playlistExport: MessageKey | null
  import_: MessageKey | null
}

const INTEGRATIONS: Capability[] = [
  {
    serviceKey: 'listenbrainz',
    serviceLabel: 'ListenBrainz',
    discovery: 'integration.radioArtistTagUser',
    subscriptions: 'integration.lbSubscriptions',
    librarySync: null,
    playlistExport: null,
    import_: null,
  },
  {
    serviceKey: 'spotify',
    serviceLabel: 'Spotify',
    discovery: null,
    subscriptions: 'integration.spotifySubscriptions',
    librarySync: null,
    playlistExport: 'integration.yes',
    import_: 'integration.playlist',
  },
  {
    serviceKey: 'deezer',
    serviceLabel: 'Deezer',
    discovery: null,
    subscriptions: 'integration.deezerSubscriptions',
    librarySync: null,
    playlistExport: null,
    import_: 'integration.deezerImport',
  },
  {
    serviceKey: 'lastfm',
    serviceLabel: 'Last.fm',
    discovery: null,
    subscriptions: 'integration.lastfmSubscriptions',
    librarySync: null,
    playlistExport: null,
    import_: null,
  },
  {
    serviceKey: 'lidarr',
    serviceLabel: 'Lidarr',
    discovery: null,
    subscriptions: null,
    librarySync: 'integration.artistsAlbums',
    playlistExport: null,
    import_: null,
  },
  {
    serviceKey: 'plex',
    serviceLabel: 'Plex',
    discovery: null,
    subscriptions: null,
    librarySync: 'integration.artistsAlbums',
    playlistExport: 'integration.yes',
    import_: null,
  },
  {
    serviceKey: 'jellyfin',
    serviceLabel: 'Jellyfin',
    discovery: null,
    subscriptions: null,
    librarySync: 'integration.artistsAlbums',
    playlistExport: 'integration.yes',
    import_: null,
  },
  {
    serviceKey: 'emby',
    serviceLabel: 'Emby',
    discovery: null,
    subscriptions: null,
    librarySync: 'integration.artistsAlbums',
    playlistExport: 'integration.yes',
    import_: null,
  },
  {
    serviceKey: 'ai',
    serviceLabel: '',
    discovery: 'integration.moodDiscover',
    subscriptions: null,
    librarySync: null,
    playlistExport: null,
    import_: null,
  },
]

function Cell({ messageKey }: { messageKey: MessageKey | null }) {
  const { t } = useI18n()
  return <>{messageKey ? t(messageKey) : '-'}</>
}

export function IntegrationCapabilities() {
  const { t } = useI18n()

  return (
    <div className="mb-6 overflow-x-auto">
      <h3 className="text-sm font-medium text-text mb-3">
        {t('settings.integrationCapabilities')}
      </h3>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 pr-3 text-muted font-medium">
              {t('settings.capService')}
            </th>
            <th className="text-left py-2 px-3 text-muted font-medium">
              {t('settings.capDiscovery')}
            </th>
            <th className="text-left py-2 px-3 text-muted font-medium">
              {t('settings.capSubscriptions')}
            </th>
            <th className="text-left py-2 px-3 text-muted font-medium">
              {t('settings.capLibrarySync')}
            </th>
            <th className="text-left py-2 px-3 text-muted font-medium">
              {t('settings.capPlaylistExport')}
            </th>
            <th className="text-left py-2 px-3 text-muted font-medium">
              {t('settings.capImport')}
            </th>
          </tr>
        </thead>
        <tbody>
          {INTEGRATIONS.map((row) => (
            <tr key={row.serviceKey} className="border-b border-border/50">
              <td className="py-2 pr-3 font-medium text-text">
                {row.serviceLabel || t('integration.aiProvider')}
              </td>
              <td className="py-2 px-3 text-muted">
                <Cell messageKey={row.discovery} />
              </td>
              <td className="py-2 px-3 text-muted">
                <Cell messageKey={row.subscriptions} />
              </td>
              <td className="py-2 px-3 text-muted">
                <Cell messageKey={row.librarySync} />
              </td>
              <td className="py-2 px-3 text-muted">
                <Cell messageKey={row.playlistExport} />
              </td>
              <td className="py-2 px-3 text-muted">
                <Cell messageKey={row.import_} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
