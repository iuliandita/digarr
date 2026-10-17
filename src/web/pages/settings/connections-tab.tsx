import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import { Field } from '../../components/field'
import { GenreCoverageSummary } from '../../components/genre-coverage-summary'
import { Hint } from '../../components/hint'
import { IntegrationCapabilities } from '../../components/integration-capabilities'
import { ServiceCard, type ServiceStatus } from '../../components/service-card'
import {
  AiProviderIcon,
  DeezerIcon,
  DiscogsIcon,
  EmbyIcon,
  JellyfinIcon,
  LastfmIcon,
  LidarrIcon,
  ListenBrainzIcon,
  PlexIcon,
  SpotifyIcon,
  SubsonicIcon,
  TidalIcon,
} from '../../components/service-icons'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Disclosure } from '../../components/ui/disclosure'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import {
  ApiError,
  disconnectOAuth,
  getCurrentUser,
  getDashboardGenreCoverage,
  getOAuthStatus,
  getPlexSections,
  importDeezerFavorites,
  importDeezerFollowed,
  importSpotifyLikedSongs,
  importSpotifyPlaylist,
  initiateOAuth,
  testService,
  updateSettings,
} from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { LidarrPreferencesSection } from './lidarr-preferences'
import { NotificationChannelsCard } from './notification-channels'
import { isLocalAiProvider } from './shared'
import type { ServiceTestState, Settings } from './types'

export function ConnectionsTab({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const { t } = useI18n()
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const { data: genreCoverage } = useQuery({
    queryKey: ['dashboard-genre-coverage'],
    queryFn: getDashboardGenreCoverage,
    staleTime: 30_000,
  })
  const isAdmin = currentUser?.isAdmin ?? false
  const prefs = settings.preferences ?? {}
  const [lidarrUrl, setLidarrUrl] = useState(settings.lidarrUrl ?? '')
  const [lidarrPublicUrl, setLidarrPublicUrl] = useState(prefs.lidarrPublicUrl ?? '')
  const [lidarrApiKey, setLidarrApiKey] = useState(
    settings.lidarrApiKey === '***' ? '' : (settings.lidarrApiKey ?? ''),
  )
  const [lbUsername, setLbUsername] = useState(settings.listenbrainzUsername ?? '')
  const [lbToken, setLbToken] = useState(
    settings.listenbrainzToken === '***' ? '' : (settings.listenbrainzToken ?? ''),
  )
  const [lfUsername, setLfUsername] = useState(settings.lastfmUsername ?? '')
  const [lfApiKey, setLfApiKey] = useState(
    settings.lastfmApiKey === '***' ? '' : (settings.lastfmApiKey ?? ''),
  )
  const [aiProvider, setAiProvider] = useState<string>(settings.aiProvider ?? 'anthropic')
  const [aiModel, setAiModel] = useState(settings.aiModel ?? '')
  const [aiApiKey, setAiApiKey] = useState(
    settings.aiApiKey === '***' ? '' : (settings.aiApiKey ?? ''),
  )
  const [aiBaseUrl, setAiBaseUrl] = useState(settings.aiBaseUrl ?? '')
  const [tidalClientId, setTidalClientId] = useState(settings.tidalClientId ?? '')
  const [tidalClientSecret, setTidalClientSecret] = useState(
    settings.tidalClientSecret === '***' ? '' : (settings.tidalClientSecret ?? ''),
  )
  const [plexUrl, setPlexUrl] = useState(settings.plexUrl ?? '')
  const [plexToken, setPlexToken] = useState(
    settings.plexToken === '***' ? '' : (settings.plexToken ?? ''),
  )
  const [plexSectionId, setPlexSectionId] = useState(settings.plexSectionId ?? '')
  const [plexTestSections, setPlexTestSections] = useState<{
    url: string
    token: string
    sections: Array<{ key: string; title: string }>
  } | null>(null)
  const [plexAccountId, setPlexAccountId] = useState(String(settings.plexAccountId ?? ''))
  const [plexAccounts, setPlexAccounts] = useState<Array<{ id: number; name: string }>>([])
  const [jellyfinUrl, setJellyfinUrl] = useState(settings.jellyfinUrl ?? '')
  const [jellyfinApiKey, setJellyfinApiKey] = useState(
    settings.jellyfinApiKey === '***' ? '' : (settings.jellyfinApiKey ?? ''),
  )
  const [jellyfinUserId, setJellyfinUserId] = useState(settings.jellyfinUserId ?? '')
  const [jellyfinLibraryId, setJellyfinLibraryId] = useState(settings.jellyfinLibraryId ?? '')
  const [jellyfinLibraries, setJellyfinLibraries] = useState<Array<{ id: string; name: string }>>(
    [],
  )
  const [embyUrl, setEmbyUrl] = useState(settings.embyUrl ?? '')
  const [embyApiKey, setEmbyApiKey] = useState(
    settings.embyApiKey === '***' ? '' : (settings.embyApiKey ?? ''),
  )
  const [embyUserId, setEmbyUserId] = useState(settings.embyUserId ?? '')
  const [embyLibraryId, setEmbyLibraryId] = useState(settings.embyLibraryId ?? '')
  const [embyLibraries, setEmbyLibraries] = useState<Array<{ id: string; name: string }>>([])
  const [discogsUsername, setDiscogsUsername] = useState(settings.discogsUsername ?? '')
  const [discogsToken, setDiscogsToken] = useState(
    settings.discogsToken === '***' ? '' : (settings.discogsToken ?? ''),
  )
  const [subsonicUrl, setSubsonicUrl] = useState(settings.subsonicUrl ?? '')
  const [subsonicUsername, setSubsonicUsername] = useState(settings.subsonicUsername ?? '')
  const [subsonicPassword, setSubsonicPassword] = useState(
    settings.subsonicPassword === '***' ? '' : (settings.subsonicPassword ?? ''),
  )
  const [spotifyClientId, setSpotifyClientId] = useState('')
  const [spotifyClientSecret, setSpotifyClientSecret] = useState('')
  const [redirectUriCopied, setRedirectUriCopied] = useState(false)
  const spotifyRedirectUri = `${window.location.origin}/api/v1/auth/oauth/spotify/callback`
  const [importingSpotifyLikes, setImportingSpotifyLikes] = useState(false)
  const [importingPlaylist, setImportingPlaylist] = useState(false)
  const [playlistIdInput, setPlaylistIdInput] = useState('')
  const [importingDeezerFavs, setImportingDeezerFavs] = useState(false)
  const [importingDeezerFollowed, setImportingDeezerFollowed] = useState(false)

  const [tests, setTests] = useState<Record<string, ServiceTestState>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({})

  const queryClient = useQueryClient()
  const savedPlexToken = settings.plexToken === '***' ? '' : (settings.plexToken ?? '')
  const { data: savedPlexSections } = useQuery({
    queryKey: [
      'plex-sections',
      currentUser?.id,
      settings.plexUrl,
      settings.plexMachineIdentifier,
      Boolean(settings.plexToken),
    ],
    queryFn: getPlexSections,
    enabled: Boolean(currentUser?.id && settings.plexUrl && settings.plexToken),
    retry: false,
  })
  const plexSections =
    plexTestSections?.url === plexUrl && plexTestSections.token === plexToken
      ? plexTestSections.sections
      : plexUrl === (settings.plexUrl ?? '') && plexToken === savedPlexToken
        ? (savedPlexSections?.sections ?? [])
        : []
  const aiProviderLabel = t('settings.aiProviderTitle')
  const canTestUserConnections = isAdmin

  function formatLabelMessage(key: MessageKey, label: string) {
    return t(key).replace('{0}', label)
  }

  const { data: spotifyStatus } = useQuery({
    queryKey: ['spotify-oauth-status'],
    queryFn: () => getOAuthStatus('spotify'),
  })
  const spotifyConnected = spotifyStatus?.connected ?? false

  const { data: deezerStatus } = useQuery({
    queryKey: ['deezer-oauth-status'],
    queryFn: () => getOAuthStatus('deezer'),
  })
  const deezerConnected = deezerStatus?.connected ?? false

  const { data: tidalStatus } = useQuery({
    queryKey: ['tidal-oauth-status'],
    queryFn: () => getOAuthStatus('tidal'),
  })
  const tidalConnected = tidalStatus?.connected ?? false
  const tidalAppConfigured = settings._tidalAppConfigured ?? false

  function setTest(key: string, val: ServiceTestState) {
    setTests((prev) => ({ ...prev, [key]: val }))
  }
  // An edit invalidates the last test; a passing test of an unsaved draft must not read as saved.
  function markEdited(key: string) {
    setTests((prev) => ({ ...prev, [key]: 'idle' }))
    setDirty((prev) => ({ ...prev, [key]: true }))
  }
  function setSave(key: string, val: boolean) {
    setSaving((prev) => ({ ...prev, [key]: val }))
  }

  const configuredServices: Record<string, boolean> = {
    lidarr: Boolean(settings.lidarrUrl && settings.lidarrApiKey),
    listenbrainz: Boolean(settings.listenbrainzUsername && settings.listenbrainzToken),
    lastfm: Boolean(settings.lastfmUsername && settings.lastfmApiKey),
    ai: Boolean(settings.aiProvider && settings.aiModel),
    tidal: Boolean(settings.tidalClientId && settings.tidalClientSecret),
    plex: Boolean(settings.plexUrl && settings.plexToken),
    jellyfin: Boolean(settings.jellyfinUrl && settings.jellyfinApiKey && settings.jellyfinUserId),
    emby: Boolean(settings.embyUrl && settings.embyApiKey && settings.embyUserId),
    discogs: Boolean(settings.discogsUsername && settings.discogsToken),
    subsonic: Boolean(
      settings.subsonicUrl && settings.subsonicUsername && settings.subsonicPassword,
    ),
  }

  function serviceStatus(key: string): ServiceStatus {
    const t = tests[key]
    if (t === 'testing') return 'testing'
    if (t === 'ok') {
      return dirty[key] || !configuredServices[key] ? 'test_passed_unsaved' : 'test_passed'
    }
    if (t === 'error') return 'error'
    if (configuredServices[key]) return 'saved'
    return 'not_configured'
  }

  function probeFailureDetail(err: unknown): string | null {
    if (err instanceof ApiError && err.data && typeof err.data === 'object') {
      const detail = (err.data as Record<string, unknown>).detail
      if (typeof detail === 'string' && detail.trim()) return detail.trim()
    }
    return null
  }

  function createTester(key: string, label: string, testFn: () => Promise<{ message: string }>) {
    return async () => {
      setTest(key, 'testing')
      try {
        await testFn()
        setTest(key, 'ok')
        toast.success(formatLabelMessage('settings.serviceConnectedToast', label))
      } catch (err) {
        setTest(key, 'error')
        const base = formatLabelMessage('settings.serviceUnreachableToast', label)
        const detail = probeFailureDetail(err)
        toast.error(detail ? `${base}: ${detail}` : base)
      }
    }
  }

  function createSaver(key: string, label: string, saveFn: () => Promise<unknown>) {
    return async () => {
      setSave(key, true)
      try {
        await saveFn()
        setDirty((prev) => ({ ...prev, [key]: false }))
        toast.success(formatLabelMessage('settings.serviceSettingsSavedToast', label))
        onSaved()
      } catch {
        toast.error(formatLabelMessage('settings.serviceSettingsFailedToast', label))
      } finally {
        setSave(key, false)
      }
    }
  }

  const testLidarr = createTester('lidarr', 'Lidarr', () =>
    testService('lidarr', { url: lidarrUrl, apiKey: lidarrApiKey }),
  )
  const saveLidarr = createSaver('lidarr', 'Lidarr', () =>
    updateSettings({
      lidarrUrl,
      lidarrApiKey: lidarrApiKey || undefined,
      preferences: {
        ...prefs,
        lidarrPublicUrl: lidarrPublicUrl || undefined,
      },
    }),
  )

  const testListenbrainz = createTester('listenbrainz', 'ListenBrainz', () =>
    testService('listenbrainz', { username: lbUsername, token: lbToken }),
  )
  const saveListenbrainz = createSaver('listenbrainz', 'ListenBrainz', () =>
    updateSettings({
      listenbrainzUsername: lbUsername,
      listenbrainzToken: lbToken || undefined,
    }),
  )

  const testLastfm = createTester('lastfm', 'Last.fm', () =>
    testService('lastfm', { username: lfUsername, apiKey: lfApiKey }),
  )
  const saveLastfm = createSaver('lastfm', 'Last.fm', () =>
    updateSettings({ lastfmUsername: lfUsername, lastfmApiKey: lfApiKey || undefined }),
  )

  const testAi = createTester('ai', aiProviderLabel, () => {
    const config: Record<string, string> = { provider: aiProvider, model: aiModel }
    if (aiProvider !== 'ollama' && aiProvider !== 'openai-compatible') config.apiKey = aiApiKey
    if (aiProvider === 'openai-compatible' && aiApiKey) config.apiKey = aiApiKey
    if (aiProvider === 'ollama' || aiProvider === 'openai-compatible') config.baseUrl = aiBaseUrl
    return testService('ai', config)
  })
  // Save, then re-probe with an empty body so the backend tests the values it
  // just persisted. Test-without-save (or a stale saved model) otherwise passes
  // the Test button while every real run fails against the stored row.
  const saveAi = async () => {
    setSave('ai', true)
    try {
      await updateSettings({
        aiProvider,
        aiModel: aiModel || undefined,
        aiApiKey: aiApiKey || undefined,
        aiBaseUrl: aiBaseUrl || undefined,
      })
      setDirty((prev) => ({ ...prev, ai: false }))
      toast.success(formatLabelMessage('settings.serviceSettingsSavedToast', aiProviderLabel))
      onSaved()
    } catch {
      toast.error(formatLabelMessage('settings.serviceSettingsFailedToast', aiProviderLabel))
      return
    } finally {
      setSave('ai', false)
    }
    setTest('ai', 'testing')
    try {
      await testService('ai', {})
      setTest('ai', 'ok')
    } catch (err) {
      setTest('ai', 'error')
      const base = t('settings.aiSavedTestFailedToast')
      const detail = probeFailureDetail(err)
      toast.error(detail ? `${base}: ${detail}` : base, { duration: 10_000 })
    }
  }

  const testTidal = createTester('tidal', 'TIDAL', () =>
    testService('tidal', { clientId: tidalClientId, clientSecret: tidalClientSecret }),
  )
  const saveTidal = createSaver('tidal', 'TIDAL', () =>
    updateSettings({
      tidalClientId: tidalClientId || undefined,
      tidalClientSecret: tidalClientSecret || undefined,
    }),
  )

  const testPlex = createTester('plex', 'Plex', async () => {
    const res = await testService('plex', {
      url: plexUrl,
      token: plexToken,
      sectionId: plexSectionId,
      accountId: plexAccountId ? Number(plexAccountId) : null,
    })
    if (Array.isArray(res.sections)) {
      setPlexTestSections({ url: plexUrl, token: plexToken, sections: res.sections })
    }
    if (Array.isArray(res.accounts)) setPlexAccounts(res.accounts)
    if (res.sectionId && !plexSectionId) setPlexSectionId(res.sectionId)
    return res
  })
  const savePlex = createSaver('plex', 'Plex', async () => {
    await updateSettings({
      plexUrl,
      plexToken: plexToken || undefined,
      plexSectionId: plexSectionId || null,
      plexAccountId: plexAccountId ? Number(plexAccountId) : null,
    })
    await queryClient.invalidateQueries({ queryKey: ['plex-sections', currentUser?.id] })
  })

  const testJellyfin = createTester('jellyfin', 'Jellyfin', async () => {
    const res = await testService('jellyfin', {
      url: jellyfinUrl,
      apiKey: jellyfinApiKey,
      userId: jellyfinUserId,
      libraryId: jellyfinLibraryId,
    })
    if (Array.isArray(res.libraries)) setJellyfinLibraries(res.libraries)
    return res
  })
  const saveJellyfin = createSaver('jellyfin', 'Jellyfin', () =>
    updateSettings({
      jellyfinUrl,
      jellyfinApiKey: jellyfinApiKey || undefined,
      jellyfinUserId: jellyfinUserId || undefined,
      jellyfinLibraryId: jellyfinLibraryId || null,
    }),
  )

  const testEmby = createTester('emby', 'Emby', async () => {
    const res = await testService('emby', {
      url: embyUrl,
      apiKey: embyApiKey,
      userId: embyUserId,
      libraryId: embyLibraryId,
    })
    if (Array.isArray(res.libraries)) setEmbyLibraries(res.libraries)
    return res
  })
  const saveEmby = createSaver('emby', 'Emby', () =>
    updateSettings({
      embyUrl,
      embyApiKey: embyApiKey || undefined,
      embyUserId: embyUserId || undefined,
      embyLibraryId: embyLibraryId || null,
    }),
  )

  const testDiscogs = createTester('discogs', 'Discogs', () =>
    testService('discogs', { username: discogsUsername, token: discogsToken }),
  )
  const saveDiscogs = createSaver('discogs', 'Discogs', () =>
    updateSettings({ discogsUsername, discogsToken: discogsToken || undefined }),
  )

  const testSubsonic = createTester('subsonic', 'Subsonic', () =>
    testService('subsonic', {
      url: subsonicUrl,
      username: subsonicUsername,
      password: subsonicPassword,
    }),
  )
  const saveSubsonic = createSaver('subsonic', 'Subsonic', () =>
    updateSettings({
      subsonicUrl,
      subsonicUsername,
      subsonicPassword: subsonicPassword || undefined,
    }),
  )

  async function initiateSpotifyOAuth() {
    try {
      const res = await initiateOAuth('spotify', {
        clientId: spotifyClientId,
        clientSecret: spotifyClientSecret,
        redirectUri: spotifyRedirectUri,
      })
      window.location.href = res.authUrl
    } catch {
      toast.error(t('settings.spotifyAuthorizationFailed'))
    }
  }

  async function copySpotifyRedirectUri() {
    try {
      await navigator.clipboard.writeText(spotifyRedirectUri)
      setRedirectUriCopied(true)
      setTimeout(() => setRedirectUriCopied(false), 1500)
    } catch {
      toast.error(t('common.unknownError'))
    }
  }

  async function disconnectSpotify() {
    try {
      await disconnectOAuth('spotify')
      queryClient.invalidateQueries({ queryKey: ['spotify-oauth-status'] })
      toast.success(t('settings.spotifyDisconnected'))
    } catch {
      toast.error(t('settings.spotifyDisconnectFailed'))
    }
  }

  async function startSpotifyLikedSongsImport() {
    setImportingSpotifyLikes(true)
    try {
      const res = await importSpotifyLikedSongs()
      toast.success(
        res.created ? t('settings.spotifyLikedSongsStarted') : t('settings.importStartedAgain'),
      )
    } catch {
      toast.error(t('settings.spotifyLikedSongsFailed'))
    } finally {
      setImportingSpotifyLikes(false)
    }
  }

  async function startSpotifyPlaylistImport() {
    if (!playlistIdInput.trim()) return
    setImportingPlaylist(true)
    try {
      const res = await importSpotifyPlaylist(playlistIdInput.trim())
      toast.success(
        res.created
          ? t('settings.playlistImportStarted')
          : t('settings.playlistImportStartedAgain'),
      )
      setPlaylistIdInput('')
    } catch {
      toast.error(t('settings.spotifyPlaylistFailed'))
    } finally {
      setImportingPlaylist(false)
    }
  }

  const isLidarrConfigured = !!(lidarrUrl || settings.lidarrUrl)
  const isLbConfigured = !!(lbUsername || settings.listenbrainzUsername)
  const isLfConfigured = !!(lfUsername || settings.lastfmUsername)
  const isAiConfigured = !!(aiModel || settings.aiModel)
  const isTidalConfigured = !!(tidalClientId || settings.tidalClientId)
  const isPlexConfigured = !!(plexUrl || settings.plexUrl)
  const isJellyfinConfigured = !!(jellyfinUrl || settings.jellyfinUrl)
  const isEmbyConfigured = !!(embyUrl || settings.embyUrl)
  const isDiscogsConfigured = !!(discogsUsername || settings.discogsUsername)
  const isSubsonicConfigured = !!(subsonicUrl || settings.subsonicUrl)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lead font-semibold text-text">{t('settings.globalSettings')}</h2>
        {!isAdmin && <p className="text-xs text-muted mt-1">{t('settings.adminOnly')}</p>}
      </div>

      {!isAdmin ? (
        <div className="space-y-2">
          {settings.lidarrUrl && (
            <div className="rounded-lg border border-border bg-surface p-3 flex items-center gap-3">
              <img src="/icons/lidarr.png" alt="" className="w-5 h-5" />
              <div>
                <span className="text-sm font-medium text-text">Lidarr</span>
                <p className="text-xs text-muted">{settings.lidarrUrl as string}</p>
              </div>
            </div>
          )}
          {settings.aiModel && (
            <div className="rounded-lg border border-border bg-surface p-3 flex items-center gap-3">
              <span className="text-sm font-medium text-text">{aiProviderLabel}</span>
              <span className="text-xs text-muted">
                {settings.aiProvider as string} / {settings.aiModel as string}
              </span>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Lidarr */}
          <div>
            <ServiceCard
              name="Lidarr"
              description={
                <span>
                  {t('settings.lidarrDescription')}{' '}
                  <a
                    href="https://wiki.servarr.com/lidarr/settings#security"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-text underline"
                  >
                    {t('settings.getApiKey')}
                  </a>
                </span>
              }
              status={serviceStatus('lidarr')}
              onEdit={() => markEdited('lidarr')}
              icon={<LidarrIcon />}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('settings.fieldUrl')} id="lidarr-url">
                  <Input
                    id="lidarr-url"
                    type="url"
                    placeholder="http://localhost:8686"
                    value={lidarrUrl}
                    onChange={(e) => setLidarrUrl(e.target.value)}
                  />
                </Field>
                <Field label={t('settings.fieldApiKey')} id="lidarr-apikey">
                  <Input
                    id="lidarr-apikey"
                    type="password"
                    placeholder={
                      settings.lidarrApiKey === '***'
                        ? `(${t('settings.saved')})`
                        : t('settings.fieldApiKey')
                    }
                    value={lidarrApiKey}
                    onChange={(e) => setLidarrApiKey(e.target.value)}
                  />
                </Field>
              </div>
              <Disclosure title={t('settings.advancedSettings')}>
                <Field label={t('settings.fieldPublicUrl')} id="lidarr-public-url">
                  <Input
                    id="lidarr-public-url"
                    type="url"
                    placeholder="https://lidarr.example.com"
                    value={lidarrPublicUrl}
                    onChange={(e) => setLidarrPublicUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted mt-1">{t('settings.lidarrPublicUrlHelp')}</p>
                </Field>
              </Disclosure>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={testLidarr}
                  disabled={tests.lidarr === 'testing'}
                >
                  {tests.lidarr === 'testing'
                    ? t('settings.testing')
                    : t('settings.testConnection')}
                </Button>
                <Button size="sm" onClick={saveLidarr} disabled={saving.lidarr}>
                  {saving.lidarr
                    ? t('settings.saving')
                    : isLidarrConfigured
                      ? t('settings.save')
                      : t('settings.configure')}
                </Button>
              </div>
            </ServiceCard>
          </div>

          {/* AI Provider */}
          <div>
            <ServiceCard
              name={aiProviderLabel}
              description={
                <span>
                  {t('settings.aiDescription')}{' '}
                  {aiProvider === 'anthropic' && (
                    <a
                      href="https://console.anthropic.com/settings/keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-text underline"
                    >
                      {t('settings.getApiKey')}
                    </a>
                  )}
                  {aiProvider === 'openai' && (
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-text underline"
                    >
                      {t('settings.getApiKey')}
                    </a>
                  )}
                  {aiProvider === 'gemini' && (
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-text underline"
                    >
                      {t('settings.getApiKey')}
                    </a>
                  )}
                  {aiProvider === 'ollama' && (
                    <a
                      href="https://ollama.com/library"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-text underline"
                    >
                      {t('settings.browseModels')}
                    </a>
                  )}
                </span>
              }
              status={serviceStatus('ai')}
              onEdit={() => markEdited('ai')}
              icon={<AiProviderIcon />}
            >
              <Hint id="settings-ai-tip" type="inline">
                {t('settings.aiTip')}
              </Hint>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('settings.fieldProvider')} id="ai-provider">
                  <Select
                    id="ai-provider"
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value)}
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="ollama">Ollama</option>
                    <option value="openai-compatible">OpenAI-Compatible</option>
                  </Select>
                </Field>
                <Field label={t('settings.fieldModel')} id="ai-model">
                  <Input
                    id="ai-model"
                    placeholder={
                      aiProvider === 'anthropic'
                        ? 'claude-haiku-4-5-20251001'
                        : aiProvider === 'openai'
                          ? 'gpt-5.4-mini'
                          : aiProvider === 'gemini'
                            ? 'gemini-3-flash-preview'
                            : aiProvider === 'openai-compatible'
                              ? t('settings.fieldModel')
                              : 'llama4'
                    }
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                  />
                </Field>
              </div>
              {aiProvider !== 'ollama' && (
                <Field
                  label={
                    aiProvider === 'openai-compatible'
                      ? t('settings.fieldApiKeyOptional')
                      : t('settings.fieldApiKey')
                  }
                  id="ai-apikey"
                >
                  <Input
                    id="ai-apikey"
                    type="password"
                    placeholder={
                      settings.aiApiKey === '***'
                        ? `(${t('settings.saved')})`
                        : t('settings.fieldApiKey')
                    }
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                  />
                  {aiProvider === 'openai-compatible' && (
                    <p className="text-xs text-muted mt-1">
                      {t('settings.aiOpenAiCompatibleHelp')}
                    </p>
                  )}
                </Field>
              )}
              {(aiProvider === 'ollama' || aiProvider === 'openai-compatible') && (
                <Field label={t('settings.fieldBaseUrl')} id="ai-baseurl">
                  <Input
                    id="ai-baseurl"
                    type="url"
                    placeholder={
                      aiProvider === 'openai-compatible'
                        ? 'http://localhost:8080'
                        : 'http://localhost:11434'
                    }
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                  />
                </Field>
              )}
              {(() => {
                const local = isLocalAiProvider(aiProvider, aiBaseUrl)
                return (
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3 pt-1">
                    <Badge
                      variant={local ? 'success' : 'info'}
                      className="self-start whitespace-nowrap"
                    >
                      {local
                        ? t('settings.aiPrivacyBadgeLocal')
                        : t('settings.aiPrivacyBadgeHosted')}
                    </Badge>
                    <p className="text-xs text-muted">
                      {local ? t('settings.aiPrivacyNoteLocal') : t('settings.aiPrivacyNoteHosted')}
                    </p>
                  </div>
                )
              })()}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={testAi}
                  disabled={tests.ai === 'testing'}
                >
                  {tests.ai === 'testing' ? t('settings.testing') : t('settings.testConnection')}
                </Button>
                <Button size="sm" onClick={saveAi} disabled={saving.ai}>
                  {saving.ai
                    ? t('settings.saving')
                    : isAiConfigured
                      ? t('settings.save')
                      : t('settings.configure')}
                </Button>
              </div>
            </ServiceCard>
          </div>

          {/* Notification channels */}
          <NotificationChannelsCard settings={settings} isAdmin={isAdmin} onSaved={onSaved} />

          {/* TIDAL search */}
          <ServiceCard
            name={t('settings.tidalAppName')}
            icon={<TidalIcon />}
            description={t('settings.tidalDescription')}
            badge={
              <span className="rounded bg-warning/20 px-1.5 py-0.5 text-caption font-normal text-warning">
                {t('search.experimental')}
              </span>
            }
            status={serviceStatus('tidal')}
            onEdit={() => markEdited('tidal')}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('settings.fieldClientId')} id="tidal-client-id">
                <Input
                  id="tidal-client-id"
                  value={tidalClientId}
                  onChange={(e) => setTidalClientId(e.target.value)}
                />
              </Field>
              <Field label={t('settings.fieldClientSecret')} id="tidal-client-secret">
                <Input
                  id="tidal-client-secret"
                  type="password"
                  placeholder={
                    settings.tidalClientSecret === '***'
                      ? `(${t('settings.saved')})`
                      : t('settings.fieldClientSecret')
                  }
                  value={tidalClientSecret}
                  onChange={(e) => setTidalClientSecret(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={testTidal}
                disabled={tests.tidal === 'testing'}
              >
                {tests.tidal === 'testing' ? t('settings.testing') : t('settings.testConnection')}
              </Button>
              <Button size="sm" onClick={saveTidal} disabled={saving.tidal}>
                {saving.tidal
                  ? t('settings.saving')
                  : isTidalConfigured
                    ? t('settings.save')
                    : t('settings.configure')}
              </Button>
            </div>
          </ServiceCard>

          <Disclosure title={t('settings.integrationCapabilities')}>
            <IntegrationCapabilities />
          </Disclosure>
        </>
      )}

      <div className="pt-2">
        <h2 className="text-lead font-semibold text-text">{t('settings.yourConnections')}</h2>
        <p className="text-xs text-muted mt-1">{t('settings.yourConnectionsDescription')}</p>
      </div>

      <Hint id="settings-connections-tip" type="inline">
        {t('settings.connectionsTip')}
      </Hint>

      {genreCoverage && genreCoverage.totalArtists > 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <GenreCoverageSummary coverage={genreCoverage} />
        </div>
      ) : null}

      {/* ListenBrainz */}
      <div>
        <ServiceCard
          name="ListenBrainz"
          description={
            <span>
              {t('settings.listenbrainzDescription')}{' '}
              <a
                href="https://listenbrainz.org/settings/"
                target="_blank"
                rel="noreferrer"
                className="text-accent-text underline"
              >
                {t('settings.getToken')}
              </a>
              {settings._listenbrainzScope === 'user' && (
                <span className="text-xs text-accent-text ml-2">{t('settings.yourAccount')}</span>
              )}
            </span>
          }
          status={serviceStatus('listenbrainz')}
          onEdit={() => markEdited('listenbrainz')}
          icon={<ListenBrainzIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('settings.fieldUsername')} id="lb-username">
              <Input
                id="lb-username"
                placeholder={t('settings.fieldUsername')}
                value={lbUsername}
                onChange={(e) => setLbUsername(e.target.value)}
              />
            </Field>
            <Field label={t('settings.fieldUserToken')} id="lb-token">
              <Input
                id="lb-token"
                type="password"
                placeholder={
                  settings.listenbrainzToken === '***'
                    ? `(${t('settings.saved')})`
                    : t('settings.fieldUserToken')
                }
                value={lbToken}
                onChange={(e) => setLbToken(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {canTestUserConnections && (
              <Button
                size="sm"
                variant="outline"
                onClick={testListenbrainz}
                disabled={tests.listenbrainz === 'testing'}
              >
                {tests.listenbrainz === 'testing'
                  ? t('settings.testing')
                  : t('settings.testConnection')}
              </Button>
            )}
            <Button size="sm" onClick={saveListenbrainz} disabled={saving.listenbrainz}>
              {saving.listenbrainz
                ? t('settings.saving')
                : isLbConfigured
                  ? t('settings.save')
                  : t('settings.configure')}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Last.fm */}
      <div>
        <ServiceCard
          name="Last.fm"
          description={
            <span>
              {t('settings.lastfmDescription')}{' '}
              <a
                href="https://www.last.fm/api/account/create"
                target="_blank"
                rel="noreferrer"
                className="text-accent-text underline"
              >
                {t('settings.getApiKey')}
              </a>
              {settings._lastfmScope === 'user' && (
                <span className="text-xs text-accent-text ml-2">{t('settings.yourAccount')}</span>
              )}
            </span>
          }
          status={serviceStatus('lastfm')}
          onEdit={() => markEdited('lastfm')}
          icon={<LastfmIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('settings.fieldUsername')} id="lfm-username">
              <Input
                id="lfm-username"
                placeholder={t('settings.fieldUsername')}
                value={lfUsername}
                onChange={(e) => setLfUsername(e.target.value)}
              />
            </Field>
            <Field label={t('settings.fieldApiKey')} id="lfm-apikey">
              <Input
                id="lfm-apikey"
                type="password"
                placeholder={
                  settings.lastfmApiKey === '***'
                    ? `(${t('settings.saved')})`
                    : t('settings.fieldApiKey')
                }
                value={lfApiKey}
                onChange={(e) => setLfApiKey(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {canTestUserConnections && (
              <Button
                size="sm"
                variant="outline"
                onClick={testLastfm}
                disabled={tests.lastfm === 'testing'}
              >
                {tests.lastfm === 'testing' ? t('settings.testing') : t('settings.testConnection')}
              </Button>
            )}
            <Button size="sm" onClick={saveLastfm} disabled={saving.lastfm}>
              {saving.lastfm
                ? t('settings.saving')
                : isLfConfigured
                  ? t('settings.save')
                  : t('settings.configure')}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Spotify */}
      <div>
        <ServiceCard
          name="Spotify"
          description={
            <span>
              {t('settings.spotifyDescription')}{' '}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-accent-text underline"
              >
                {t('settings.createSpotifyApp')}
              </a>
            </span>
          }
          status={spotifyConnected ? 'connected' : 'not_configured'}
          icon={<SpotifyIcon />}
        >
          {spotifyConnected ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">{t('settings.spotifyImportDescription')}</p>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={startSpotifyLikedSongsImport}
                  disabled={importingSpotifyLikes}
                >
                  {importingSpotifyLikes ? t('common.importing') : t('settings.importLikedSongs')}
                </Button>
                <Button size="sm" variant="outline" onClick={disconnectSpotify}>
                  {t('settings.disconnect')}
                </Button>
              </div>
              <div className="flex gap-1.5 pt-1">
                <input
                  type="text"
                  value={playlistIdInput}
                  onChange={(e) => setPlaylistIdInput(e.target.value)}
                  placeholder={t('importArtists.playlistPlaceholder')}
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-sm bg-bg border border-border rounded-md text-text placeholder:text-muted/60 focus:outline-none focus:border-accent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') startSpotifyPlaylistImport()
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startSpotifyPlaylistImport}
                  disabled={!playlistIdInput.trim() || importingPlaylist}
                >
                  {importingPlaylist ? t('common.importing') : t('settings.importPlaylist')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Field label={t('settings.fieldRedirectUri')} id="spotify-redirect-uri">
                <div className="flex gap-1.5">
                  <Input
                    id="spotify-redirect-uri"
                    readOnly
                    value={spotifyRedirectUri}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={copySpotifyRedirectUri}
                    aria-label={t('settings.copyRedirectUri')}
                    title={t('settings.copyRedirectUri')}
                  >
                    {redirectUriCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted">{t('settings.redirectUriHelp')}</p>
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('settings.fieldClientId')} id="spotify-client-id">
                  <Input
                    id="spotify-client-id"
                    placeholder={t('settings.fieldClientId')}
                    value={spotifyClientId}
                    onChange={(e) => setSpotifyClientId(e.target.value)}
                  />
                </Field>
                <Field label={t('settings.fieldClientSecret')} id="spotify-client-secret">
                  <Input
                    id="spotify-client-secret"
                    type="password"
                    placeholder={t('settings.fieldClientSecret')}
                    value={spotifyClientSecret}
                    onChange={(e) => setSpotifyClientSecret(e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={initiateSpotifyOAuth}
                  disabled={!spotifyClientId || !spotifyClientSecret}
                >
                  {t('settings.connectWithSpotify')}
                </Button>
              </div>
            </>
          )}
        </ServiceCard>
      </div>

      {/* Deezer */}
      <div>
        <ServiceCard
          name={t('settings.deezer')}
          description={t('settings.deezerDescription')}
          status={deezerConnected ? 'connected' : 'not_configured'}
          icon={<DeezerIcon />}
        >
          {deezerConnected ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">{t('settings.deezerImportDescription')}</p>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={async () => {
                    setImportingDeezerFavs(true)
                    try {
                      const res = await importDeezerFavorites()
                      toast.success(
                        res.created
                          ? t('settings.deezerFavoritesStarted')
                          : t('settings.importStartedAgain'),
                      )
                    } catch {
                      toast.error(t('settings.deezerFavoritesFailed'))
                    } finally {
                      setImportingDeezerFavs(false)
                    }
                  }}
                  disabled={importingDeezerFavs}
                >
                  {importingDeezerFavs ? t('common.importing') : t('settings.importFavorites')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setImportingDeezerFollowed(true)
                    try {
                      const res = await importDeezerFollowed()
                      toast.success(
                        res.created
                          ? t('settings.deezerFollowedStarted')
                          : t('settings.importStartedAgain'),
                      )
                    } catch {
                      toast.error(t('settings.deezerFollowedFailed'))
                    } finally {
                      setImportingDeezerFollowed(false)
                    }
                  }}
                  disabled={importingDeezerFollowed}
                >
                  {importingDeezerFollowed ? t('common.importing') : t('settings.importFollowed')}
                </Button>
              </div>
              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await disconnectOAuth('deezer')
                      queryClient.invalidateQueries({ queryKey: ['deezer-oauth-status'] })
                      toast.success(t('settings.deezerDisconnected'))
                    } catch {
                      toast.error(t('settings.deezerDisconnectFailed'))
                    }
                  }}
                >
                  {t('settings.disconnect')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted">{t('settings.deezerConnectHelp')}</p>
              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const res = await initiateOAuth('deezer', {
                        clientId: '',
                        clientSecret: '',
                        redirectUri: `${window.location.origin}/api/v1/auth/oauth/deezer/callback`,
                      })
                      window.location.href = res.authUrl
                    } catch {
                      toast.error(t('settings.deezerAuthorizationFailed'))
                    }
                  }}
                >
                  {t('settings.connectDeezer')}
                </Button>
              </div>
            </>
          )}
        </ServiceCard>
      </div>

      {/* TIDAL */}
      <div>
        <ServiceCard
          name="TIDAL"
          description={t('settings.tidalConnectDescription')}
          badge={
            <span className="rounded bg-warning/20 px-1.5 py-0.5 text-caption font-normal text-warning">
              {t('search.experimental')}
            </span>
          }
          status={tidalConnected ? 'connected' : 'not_configured'}
          icon={<TidalIcon />}
        >
          {tidalConnected ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">{t('settings.tidalConnected')}</p>
              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await disconnectOAuth('tidal')
                      queryClient.invalidateQueries({ queryKey: ['tidal-oauth-status'] })
                      toast.success(t('settings.tidalDisconnected'))
                    } catch {
                      toast.error(t('settings.tidalDisconnectFailed'))
                    }
                  }}
                >
                  {t('settings.disconnect')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted">
                {tidalAppConfigured
                  ? t('settings.tidalConnectHelp')
                  : t('settings.tidalAppNotConfigured')}
              </p>
              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  disabled={!tidalAppConfigured}
                  onClick={async () => {
                    try {
                      const res = await initiateOAuth('tidal', {
                        clientId: '',
                        clientSecret: '',
                        redirectUri: `${window.location.origin}/api/v1/auth/oauth/tidal/callback`,
                      })
                      window.location.href = res.authUrl
                    } catch {
                      toast.error(t('settings.tidalAuthorizationFailed'))
                    }
                  }}
                >
                  {t('settings.connectTidal')}
                </Button>
              </div>
            </>
          )}
        </ServiceCard>
      </div>

      {/* Plex */}
      <div>
        <ServiceCard
          name="Plex"
          description={t('settings.plexDescription')}
          status={serviceStatus('plex')}
          onEdit={() => markEdited('plex')}
          icon={<PlexIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('settings.fieldServerUrl')} id="plex-url">
              <Input
                id="plex-url"
                type="url"
                placeholder="http://localhost:32400"
                value={plexUrl}
                onChange={(e) => {
                  setPlexUrl(e.target.value)
                  setPlexAccountId('')
                  setPlexAccounts([])
                  setPlexTestSections(null)
                }}
              />
            </Field>
            <Field label={t('settings.plexToken')} id="plex-token">
              <Input
                id="plex-token"
                type="password"
                placeholder={
                  settings.plexToken === '***'
                    ? `(${t('settings.saved')})`
                    : t('settings.plexToken')
                }
                value={plexToken}
                onChange={(e) => {
                  setPlexToken(e.target.value)
                  setPlexTestSections(null)
                  setPlexAccountId('')
                  setPlexAccounts([])
                }}
              />
            </Field>
          </div>
          <Field label={t('settings.plexLibrary')} id="plex-section">
            <Select
              id="plex-section"
              value={plexSectionId}
              onChange={(e) => setPlexSectionId(e.target.value)}
            >
              <option value="">{t('settings.plexLibraryAuto')}</option>
              {plexSections.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.title}
                </option>
              ))}
              {plexSectionId && !plexSections.some((s) => s.key === plexSectionId) && (
                <option value={plexSectionId}>
                  {t('settings.plexLibrarySection').replace('{0}', plexSectionId)}
                </option>
              )}
            </Select>
            <p className="text-xs text-muted mt-1">{t('settings.plexLibraryHint')}</p>
          </Field>
          <Field label={t('settings.plexAccount')} id="plex-account">
            <Select
              id="plex-account"
              value={plexAccountId}
              onChange={(e) => setPlexAccountId(e.target.value)}
            >
              <option value="">{t('settings.plexAccountNone')}</option>
              {plexAccounts.map((account) => (
                <option key={account.id} value={String(account.id)}>
                  {account.name}
                </option>
              ))}
              {plexAccountId &&
                !plexAccounts.some((account) => String(account.id) === plexAccountId) && (
                  <option value={plexAccountId}>{settings.plexAccountName ?? plexAccountId}</option>
                )}
            </Select>
            <p className="text-xs text-muted mt-1">{t('settings.plexAccountHint')}</p>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={testPlex}
              disabled={tests.plex === 'testing'}
            >
              {tests.plex === 'testing' ? t('settings.testing') : t('settings.testConnection')}
            </Button>
            <Button size="sm" onClick={savePlex} disabled={saving.plex}>
              {saving.plex
                ? t('settings.saving')
                : isPlexConfigured
                  ? t('settings.save')
                  : t('settings.configure')}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Jellyfin */}
      <div>
        <ServiceCard
          name="Jellyfin"
          description={t('settings.jellyfinDescription')}
          status={serviceStatus('jellyfin')}
          onEdit={() => markEdited('jellyfin')}
          icon={<JellyfinIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('settings.fieldServerUrl')} id="jellyfin-url">
              <Input
                id="jellyfin-url"
                type="url"
                placeholder="http://localhost:8096"
                value={jellyfinUrl}
                onChange={(e) => setJellyfinUrl(e.target.value)}
              />
            </Field>
            <Field label={t('settings.fieldApiKey')} id="jellyfin-apikey">
              <Input
                id="jellyfin-apikey"
                type="password"
                placeholder={
                  settings.jellyfinApiKey === '***'
                    ? `(${t('settings.saved')})`
                    : t('settings.fieldApiKey')
                }
                value={jellyfinApiKey}
                onChange={(e) => setJellyfinApiKey(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('settings.fieldUsernameOrUserId')} id="jellyfin-userid">
            <Input
              id="jellyfin-userid"
              placeholder={t('settings.fieldUsernameOrUserId')}
              value={jellyfinUserId}
              onChange={(e) => setJellyfinUserId(e.target.value)}
            />
            <p className="text-xs text-muted mt-1">{t('settings.jellyfinUserIdHelp')}</p>
          </Field>
          <Field label={t('settings.musicLibrary')} id="jellyfin-library">
            <Select
              id="jellyfin-library"
              value={jellyfinLibraryId}
              onChange={(e) => setJellyfinLibraryId(e.target.value)}
            >
              <option value="">{t('settings.musicLibraryAll')}</option>
              {jellyfinLibraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              {jellyfinLibraryId && !jellyfinLibraries.some((l) => l.id === jellyfinLibraryId) && (
                <option value={jellyfinLibraryId}>
                  {t('settings.musicLibraryId').replace('{0}', jellyfinLibraryId)}
                </option>
              )}
            </Select>
            <p className="text-xs text-muted mt-1">{t('settings.musicLibraryHint')}</p>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            {canTestUserConnections && (
              <Button
                size="sm"
                variant="outline"
                onClick={testJellyfin}
                disabled={tests.jellyfin === 'testing'}
              >
                {tests.jellyfin === 'testing'
                  ? t('settings.testing')
                  : t('settings.testConnection')}
              </Button>
            )}
            <Button size="sm" onClick={saveJellyfin} disabled={saving.jellyfin}>
              {saving.jellyfin
                ? t('settings.saving')
                : isJellyfinConfigured
                  ? t('settings.save')
                  : t('settings.configure')}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Emby */}
      <div>
        <ServiceCard
          name="Emby"
          description={t('settings.embyDescription')}
          status={serviceStatus('emby')}
          onEdit={() => markEdited('emby')}
          icon={<EmbyIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('settings.fieldServerUrl')} id="emby-url">
              <Input
                id="emby-url"
                type="url"
                placeholder="http://localhost:8096"
                value={embyUrl}
                onChange={(e) => setEmbyUrl(e.target.value)}
              />
            </Field>
            <Field label={t('settings.fieldApiKey')} id="emby-apikey">
              <Input
                id="emby-apikey"
                type="password"
                placeholder={
                  settings.embyApiKey === '***'
                    ? `(${t('settings.saved')})`
                    : t('settings.fieldApiKey')
                }
                value={embyApiKey}
                onChange={(e) => setEmbyApiKey(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('settings.fieldUserId')} id="emby-userid">
            <Input
              id="emby-userid"
              placeholder={t('settings.fieldUserId')}
              value={embyUserId}
              onChange={(e) => setEmbyUserId(e.target.value)}
            />
            <p className="text-xs text-muted mt-1">{t('settings.embyUserIdHelp')}</p>
          </Field>
          <Field label={t('settings.musicLibrary')} id="emby-library">
            <Select
              id="emby-library"
              value={embyLibraryId}
              onChange={(e) => setEmbyLibraryId(e.target.value)}
            >
              <option value="">{t('settings.musicLibraryAll')}</option>
              {embyLibraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              {embyLibraryId && !embyLibraries.some((l) => l.id === embyLibraryId) && (
                <option value={embyLibraryId}>
                  {t('settings.musicLibraryId').replace('{0}', embyLibraryId)}
                </option>
              )}
            </Select>
            <p className="text-xs text-muted mt-1">{t('settings.musicLibraryHint')}</p>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            {canTestUserConnections && (
              <Button
                size="sm"
                variant="outline"
                onClick={testEmby}
                disabled={tests.emby === 'testing'}
              >
                {tests.emby === 'testing' ? t('settings.testing') : t('settings.testConnection')}
              </Button>
            )}
            <Button size="sm" onClick={saveEmby} disabled={saving.emby}>
              {saving.emby
                ? t('settings.saving')
                : isEmbyConfigured
                  ? t('settings.save')
                  : t('settings.configure')}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Subsonic */}
      <div>
        <ServiceCard
          name="Subsonic"
          description={t('settings.subsonicDescription')}
          status={serviceStatus('subsonic')}
          onEdit={() => markEdited('subsonic')}
          icon={<SubsonicIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('settings.fieldServerUrl')} id="subsonic-url">
              <Input
                id="subsonic-url"
                type="url"
                placeholder="http://navidrome:4533"
                value={subsonicUrl}
                onChange={(e) => setSubsonicUrl(e.target.value)}
              />
            </Field>
            <Field label={t('settings.fieldUsername')} id="subsonic-username">
              <Input
                id="subsonic-username"
                autoComplete="off"
                placeholder={t('settings.fieldUsername')}
                value={subsonicUsername}
                onChange={(e) => setSubsonicUsername(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('settings.fieldPassword')} id="subsonic-password">
            <Input
              id="subsonic-password"
              type="password"
              autoComplete="new-password"
              placeholder={
                settings.subsonicPassword === '***'
                  ? `(${t('settings.saved')})`
                  : t('settings.fieldPassword')
              }
              value={subsonicPassword}
              onChange={(e) => setSubsonicPassword(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            {canTestUserConnections && (
              <Button
                size="sm"
                variant="outline"
                onClick={testSubsonic}
                disabled={tests.subsonic === 'testing'}
              >
                {tests.subsonic === 'testing'
                  ? t('settings.testing')
                  : t('settings.testConnection')}
              </Button>
            )}
            <Button size="sm" onClick={saveSubsonic} disabled={saving.subsonic}>
              {saving.subsonic
                ? t('settings.saving')
                : isSubsonicConfigured
                  ? t('settings.save')
                  : t('settings.configure')}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Discogs */}
      <div>
        <ServiceCard
          name="Discogs"
          description={
            <span>
              {t('settings.discogsDescription')}{' '}
              <a
                href="https://www.discogs.com/settings/developers"
                target="_blank"
                rel="noreferrer"
                className="text-accent-text underline"
              >
                {t('settings.getPersonalAccessToken')}
              </a>
            </span>
          }
          status={serviceStatus('discogs')}
          onEdit={() => markEdited('discogs')}
          icon={<DiscogsIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('settings.fieldUsername')} id="discogs-username">
              <Input
                id="discogs-username"
                placeholder={t('settings.fieldUsername')}
                value={discogsUsername}
                onChange={(e) => setDiscogsUsername(e.target.value)}
              />
            </Field>
            <Field label={t('settings.fieldPersonalAccessToken')} id="discogs-token">
              <Input
                id="discogs-token"
                type="password"
                placeholder={
                  settings.discogsToken === '***'
                    ? `(${t('settings.saved')})`
                    : t('settings.fieldPersonalAccessToken')
                }
                value={discogsToken}
                onChange={(e) => setDiscogsToken(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {canTestUserConnections && (
              <Button
                size="sm"
                variant="outline"
                onClick={testDiscogs}
                disabled={tests.discogs === 'testing'}
              >
                {tests.discogs === 'testing' ? t('settings.testing') : t('settings.testConnection')}
              </Button>
            )}
            <Button size="sm" onClick={saveDiscogs} disabled={saving.discogs}>
              {saving.discogs
                ? t('settings.saving')
                : isDiscogsConfigured
                  ? t('settings.save')
                  : t('settings.configure')}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Lidarr Preferences - per-user, visible to all */}
      {settings.lidarrUrl && <LidarrPreferencesSection />}
    </div>
  )
}
