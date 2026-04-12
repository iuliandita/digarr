import { useI18n } from '@/web/lib/i18n'

type Capability = {
  service: string
  serviceKey: string
  discovery: string
  subscriptions: string
  librarySync: string
  playlistExport: string
  import_: string
}

const INTEGRATIONS: Capability[] = [
  {
    service: 'ListenBrainz',
    serviceKey: 'listenbrainz',
    discovery: 'Radio (Artist, Tag, User), Similar Users',
    subscriptions: 'Weekly Jams, Fresh Releases, Artist Radio, Tag Radio, Similar Users',
    librarySync: '-',
    playlistExport: '-',
    import_: '-',
  },
  {
    service: 'Spotify',
    serviceKey: 'spotify',
    discovery: '-',
    subscriptions: 'Liked Songs, Charts, Playlist',
    librarySync: '-',
    playlistExport: 'Yes',
    import_: 'Playlist',
  },
  {
    service: 'Deezer',
    serviceKey: 'deezer',
    discovery: '-',
    subscriptions: 'Favorites, Followed, Flow',
    librarySync: '-',
    playlistExport: '-',
    import_: 'Favorites, Followed, Playlists',
  },
  {
    service: 'Last.fm',
    serviceKey: 'lastfm',
    discovery: '-',
    subscriptions: 'Charts, Tag Radio',
    librarySync: '-',
    playlistExport: '-',
    import_: '-',
  },
  {
    service: 'Lidarr',
    serviceKey: 'lidarr',
    discovery: '-',
    subscriptions: '-',
    librarySync: 'Artists, Albums',
    playlistExport: '-',
    import_: '-',
  },
  {
    service: 'Plex',
    serviceKey: 'plex',
    discovery: '-',
    subscriptions: '-',
    librarySync: 'Artists, Albums',
    playlistExport: 'Yes',
    import_: '-',
  },
  {
    service: 'Jellyfin',
    serviceKey: 'jellyfin',
    discovery: '-',
    subscriptions: '-',
    librarySync: 'Artists, Albums',
    playlistExport: 'Yes',
    import_: '-',
  },
  {
    service: 'Emby',
    serviceKey: 'emby',
    discovery: '-',
    subscriptions: '-',
    librarySync: 'Artists, Albums',
    playlistExport: 'Yes',
    import_: '-',
  },
  {
    service: 'AI Provider',
    serviceKey: 'ai',
    discovery: 'Mood Discover',
    subscriptions: '-',
    librarySync: '-',
    playlistExport: '-',
    import_: '-',
  },
]

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
              <td className="py-2 pr-3 font-medium text-text">{row.service}</td>
              <td className="py-2 px-3 text-muted">{row.discovery}</td>
              <td className="py-2 px-3 text-muted">{row.subscriptions}</td>
              <td className="py-2 px-3 text-muted">{row.librarySync}</td>
              <td className="py-2 px-3 text-muted">{row.playlistExport}</td>
              <td className="py-2 px-3 text-muted">{row.import_}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
