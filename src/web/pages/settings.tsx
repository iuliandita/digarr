import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { SupportedLocale } from '@/core/i18n/locales'
import type { MessageKey } from '@/core/i18n/messages/types'
import { errMsg } from '@/core/validation'
import { DEFAULT_PREFERENCES, type Preferences } from '@/db/schema'
import { AdministrationTab } from '../components/admin/administration-tab'
import { setAudiodbProxyFlag } from '../components/artist-thumb'
import { BlockedArtistsTab } from '../components/blocked-artists-tab'
import { CollapsibleSection } from '../components/collapsible-section'
import { Field } from '../components/field'
import { Hint } from '../components/hint'
import { IntegrationCapabilities } from '../components/integration-capabilities'
import { LanguageSwitcher } from '../components/language-switcher'
import { ServiceCard } from '../components/service-card'
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
  WebhookIcon,
} from '../components/service-icons'
import { SystemHealthCard } from '../components/system-health-card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import { useInstallPrompt } from '../hooks/use-install-prompt'
import {
  AUTH_EXPIRED_EVENT,
  changePassword,
  clearStoredToken,
  createTargetApi,
  deleteTargetApi,
  disconnectOAuth,
  getAuthMeta,
  getCurrentUser,
  getLidarrMetadataProfiles,
  getLidarrProfiles,
  getLidarrRootFolders,
  getOAuthStatus,
  getSettings,
  getUserPreferences,
  importDeezerFavorites,
  importDeezerFollowed,
  importSpotifyLikedSongs,
  importSpotifyPlaylist,
  initiateOAuth,
  listTargets,
  logoutUser,
  setStoredToken,
  testService,
  testTargetApi,
  testWebhook,
  updateSettings,
  updateTargetApi,
  updateUserPreferences,
} from '../lib/api'
import { useI18n } from '../lib/i18n'
import JobHistoryPage from './job-history'
import { UserManagementPage } from './user-management'

type Settings = {
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
  oidcIssuerUrl?: string
  oidcClientId?: string
  oidcClientSecret?: string
  oidcScopes?: string
  plexUrl?: string
  plexToken?: string
  jellyfinUrl?: string
  jellyfinApiKey?: string
  jellyfinUserId?: string
  embyUrl?: string
  embyApiKey?: string
  embyUserId?: string
  discogsToken?: string
  discogsUsername?: string
  librarySyncIntervalHours?: number
  preferences?: Partial<Preferences>
  setupComplete?: boolean
  _listenbrainzScope?: 'user' | 'global'
  _lastfmScope?: 'user' | 'global'
}

type Tab =
  | 'connections'
  | 'targets'
  | 'recommendations'
  | 'blocked'
  | 'schedule'
  | 'account'
  | 'auth'
  | 'users'
  | 'administration'
  | 'jobs'
  | 'system-health'

function TabBar({
  active,
  onChange,
  isAdmin,
}: {
  active: Tab
  onChange: (t: Tab) => void
  isAdmin: boolean
}) {
  const { t } = useI18n()
  const allTabs: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: 'connections', label: t('settings.tabs.connections') },
    { id: 'targets', label: t('settings.tabs.targets') },
    { id: 'recommendations', label: t('settings.tabs.recommendations') },
    { id: 'blocked', label: t('settings.tabs.blocked') },
    { id: 'schedule', label: t('settings.tabs.schedule'), adminOnly: true },
    { id: 'account', label: t('settings.tabs.account') },
    { id: 'auth', label: t('settings.tabs.authentication'), adminOnly: true },
    { id: 'users', label: t('settings.tabs.users'), adminOnly: true },
    { id: 'administration', label: t('settings.tabs.administration'), adminOnly: true },
    { id: 'jobs', label: t('settings.tabs.jobHistory'), adminOnly: true },
    { id: 'system-health', label: t('settings.tabs.systemHealth'), adminOnly: true },
  ]
  const tabs = allTabs.filter((tab) => !tab.adminOnly || isAdmin)
  return (
    <div
      className="flex gap-1 border-b border-border mb-6 overflow-x-auto -mx-6 px-6"
      style={{ scrollbarWidth: 'none' }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={[
            'px-3 sm:px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0',
            active === tab.id
              ? 'border-accent text-text'
              : 'border-transparent text-muted hover:text-text',
          ].join(' ')}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function SliderField({
  label,
  id,
  value,
  min,
  max,
  step,
  onChange,
  displayValue,
}: {
  label: string
  id: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  displayValue?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm text-muted">
          {label}
        </label>
        <span className="text-sm font-medium text-text tabular-nums">
          {displayValue ?? value.toFixed(2)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--color-accent)] cursor-pointer"
      />
    </div>
  )
}

type ServiceTestState = 'idle' | 'testing' | 'ok' | 'error'

const LOCAL_AI_DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: 'http://localhost:11434',
  'openai-compatible': 'http://localhost:8080',
}

// True when the configured endpoint clearly points back to this machine or a local mDNS host.
// The privacy badge must follow the actual endpoint, not only the selected provider name.
function isLocalAiProvider(provider: string, baseUrl: string): boolean {
  const defaultBaseUrl = LOCAL_AI_DEFAULT_BASE_URLS[provider]
  if (!defaultBaseUrl) return false
  const effectiveBaseUrl = baseUrl.trim() || defaultBaseUrl
  try {
    const host = new URL(effectiveBaseUrl).hostname.toLowerCase()
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '[::1]' ||
      host.endsWith('.local')
    )
  } catch {
    return false
  }
}

function ConnectionsTab({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const { t } = useI18n()
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
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
  const [webhookUrl, setWebhookUrl] = useState(settings.preferences?.webhookUrl ?? '')
  const [savingWebhook, setSavingWebhook] = useState(false)
  const [testingWebhook, setTestingWebhook] = useState(false)
  const [plexUrl, setPlexUrl] = useState(settings.plexUrl ?? '')
  const [plexToken, setPlexToken] = useState(
    settings.plexToken === '***' ? '' : (settings.plexToken ?? ''),
  )
  const [jellyfinUrl, setJellyfinUrl] = useState(settings.jellyfinUrl ?? '')
  const [jellyfinApiKey, setJellyfinApiKey] = useState(
    settings.jellyfinApiKey === '***' ? '' : (settings.jellyfinApiKey ?? ''),
  )
  const [jellyfinUserId, setJellyfinUserId] = useState(settings.jellyfinUserId ?? '')
  const [embyUrl, setEmbyUrl] = useState(settings.embyUrl ?? '')
  const [embyApiKey, setEmbyApiKey] = useState(
    settings.embyApiKey === '***' ? '' : (settings.embyApiKey ?? ''),
  )
  const [embyUserId, setEmbyUserId] = useState(settings.embyUserId ?? '')
  const [discogsUsername, setDiscogsUsername] = useState(settings.discogsUsername ?? '')
  const [discogsToken, setDiscogsToken] = useState(
    settings.discogsToken === '***' ? '' : (settings.discogsToken ?? ''),
  )
  const [spotifyClientId, setSpotifyClientId] = useState('')
  const [spotifyClientSecret, setSpotifyClientSecret] = useState('')
  const [importingSpotifyLikes, setImportingSpotifyLikes] = useState(false)
  const [importingPlaylist, setImportingPlaylist] = useState(false)
  const [playlistIdInput, setPlaylistIdInput] = useState('')
  const [importingDeezerFavs, setImportingDeezerFavs] = useState(false)
  const [importingDeezerFollowed, setImportingDeezerFollowed] = useState(false)

  const [tests, setTests] = useState<Record<string, ServiceTestState>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const queryClient = useQueryClient()
  const aiProviderLabel = t('settings.aiProviderTitle')
  const webhookLabel = t('settings.webhookTitle')
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

  function setTest(key: string, val: ServiceTestState) {
    setTests((prev) => ({ ...prev, [key]: val }))
  }
  function setSave(key: string, val: boolean) {
    setSaving((prev) => ({ ...prev, [key]: val }))
  }

  const configuredServices: Record<string, boolean> = {
    lidarr: Boolean(settings.lidarrUrl && settings.lidarrApiKey),
    listenbrainz: Boolean(settings.listenbrainzUsername && settings.listenbrainzToken),
    lastfm: Boolean(settings.lastfmUsername && settings.lastfmApiKey),
    ai: Boolean(settings.aiProvider && settings.aiModel),
    plex: Boolean(settings.plexUrl && settings.plexToken),
    jellyfin: Boolean(settings.jellyfinUrl && settings.jellyfinApiKey && settings.jellyfinUserId),
    emby: Boolean(settings.embyUrl && settings.embyApiKey && settings.embyUserId),
    discogs: Boolean(settings.discogsUsername && settings.discogsToken),
  }

  function serviceStatus(key: string): 'connected' | 'not_configured' | 'error' | 'testing' {
    const t = tests[key]
    if (t === 'testing') return 'testing'
    if (t === 'ok') return 'connected'
    if (t === 'error') return 'error'
    // If no test has been run but the service has saved credentials, show as connected
    if (configuredServices[key]) return 'connected'
    return 'not_configured'
  }

  function createTester(key: string, label: string, testFn: () => Promise<{ message: string }>) {
    return async () => {
      setTest(key, 'testing')
      try {
        await testFn()
        setTest(key, 'ok')
        toast.success(formatLabelMessage('settings.serviceConnectedToast', label))
      } catch {
        setTest(key, 'error')
        toast.error(formatLabelMessage('settings.serviceUnreachableToast', label))
      }
    }
  }

  function createSaver(key: string, label: string, saveFn: () => Promise<unknown>) {
    return async () => {
      setSave(key, true)
      try {
        await saveFn()
        toast.success(formatLabelMessage('settings.serviceSettingsSavedToast', label))
        onSaved()
      } catch {
        toast.error(formatLabelMessage('settings.serviceSettingsFailedToast', label))
      } finally {
        setSave(key, false)
      }
    }
  }

  async function handleSaveWebhook() {
    setSavingWebhook(true)
    try {
      const prefs = settings.preferences ?? {}
      await updateSettings({
        preferences: { ...prefs, webhookUrl: webhookUrl || undefined },
      })
      toast.success(t('settings.webhookSaved'))
      onSaved()
    } catch {
      toast.error(t('settings.webhookFailed'))
    } finally {
      setSavingWebhook(false)
    }
  }

  async function handleTestWebhook() {
    setTestingWebhook(true)
    try {
      await testWebhook()
      toast.success(t('settings.webhookTestSuccess'))
    } catch {
      toast.error(t('settings.webhookTestFailed'))
    } finally {
      setTestingWebhook(false)
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
  const saveAi = createSaver('ai', aiProviderLabel, () =>
    updateSettings({
      aiProvider,
      aiModel: aiModel || undefined,
      aiApiKey: aiApiKey || undefined,
      aiBaseUrl: aiBaseUrl || undefined,
    }),
  )

  const testPlex = createTester('plex', 'Plex', () =>
    testService('plex', { url: plexUrl, token: plexToken }),
  )
  const savePlex = createSaver('plex', 'Plex', () =>
    updateSettings({ plexUrl, plexToken: plexToken || undefined }),
  )

  const testJellyfin = createTester('jellyfin', 'Jellyfin', () =>
    testService('jellyfin', { url: jellyfinUrl, apiKey: jellyfinApiKey, userId: jellyfinUserId }),
  )
  const saveJellyfin = createSaver('jellyfin', 'Jellyfin', () =>
    updateSettings({
      jellyfinUrl,
      jellyfinApiKey: jellyfinApiKey || undefined,
      jellyfinUserId: jellyfinUserId || undefined,
    }),
  )

  const testEmby = createTester('emby', 'Emby', () =>
    testService('emby', { url: embyUrl, apiKey: embyApiKey, userId: embyUserId }),
  )
  const saveEmby = createSaver('emby', 'Emby', () =>
    updateSettings({
      embyUrl,
      embyApiKey: embyApiKey || undefined,
      embyUserId: embyUserId || undefined,
    }),
  )

  const testDiscogs = createTester('discogs', 'Discogs', () =>
    testService('discogs', { username: discogsUsername, token: discogsToken }),
  )
  const saveDiscogs = createSaver('discogs', 'Discogs', () =>
    updateSettings({ discogsUsername, discogsToken: discogsToken || undefined }),
  )

  async function initiateSpotifyOAuth() {
    try {
      const res = await initiateOAuth('spotify', {
        clientId: spotifyClientId,
        clientSecret: spotifyClientSecret,
        redirectUri: `${window.location.origin}/api/v1/auth/oauth/spotify/callback`,
      })
      window.location.href = res.authUrl
    } catch {
      toast.error(t('settings.spotifyAuthorizationFailed'))
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
  const isPlexConfigured = !!(plexUrl || settings.plexUrl)
  const isJellyfinConfigured = !!(jellyfinUrl || settings.jellyfinUrl)
  const isEmbyConfigured = !!(embyUrl || settings.embyUrl)
  const isDiscogsConfigured = !!(discogsUsername || settings.discogsUsername)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.globalSettings')}
        </h3>
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
          <IntegrationCapabilities />
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
                    className="text-accent underline"
                  >
                    {t('settings.getApiKey')}
                  </a>
                </span>
              }
              status={serviceStatus('lidarr')}
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
          <Hint id="settings-ai-tip" type="inline">
            {t('settings.aiTip')}
          </Hint>
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
                      className="text-accent underline"
                    >
                      {t('settings.getApiKey')}
                    </a>
                  )}
                  {aiProvider === 'openai' && (
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline"
                    >
                      {t('settings.getApiKey')}
                    </a>
                  )}
                  {aiProvider === 'gemini' && (
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline"
                    >
                      {t('settings.getApiKey')}
                    </a>
                  )}
                  {aiProvider === 'ollama' && (
                    <a
                      href="https://ollama.com/library"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline"
                    >
                      {t('settings.browseModels')}
                    </a>
                  )}
                </span>
              }
              status={serviceStatus('ai')}
              icon={<AiProviderIcon provider={aiProvider} />}
            >
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
              {aiProvider === 'openai-compatible' && (
                <p className="text-xs text-muted">{t('settings.aiOpenAiCompatibleHelp')}</p>
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

          {/* Webhook */}
          <ServiceCard
            name={webhookLabel}
            description={t('settings.webhookDescription')}
            status={webhookUrl ? 'connected' : 'not_configured'}
            icon={<WebhookIcon />}
          >
            <Field label={t('settings.fieldWebhookUrl')} id="webhook-url">
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://ntfy.sh/my-topic"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestWebhook}
                disabled={testingWebhook || !webhookUrl}
              >
                {testingWebhook ? t('settings.sending') : t('settings.testWebhook')}
              </Button>
              <Button size="sm" onClick={handleSaveWebhook} disabled={savingWebhook}>
                {savingWebhook
                  ? t('settings.saving')
                  : webhookUrl
                    ? t('settings.save')
                    : t('settings.configure')}
              </Button>
            </div>
          </ServiceCard>
        </>
      )}

      <div className="pt-2">
        <h3 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.yourConnections')}
        </h3>
        <p className="text-xs text-muted mt-1">{t('settings.yourConnectionsDescription')}</p>
      </div>

      <Hint id="settings-connections-tip" type="inline">
        {t('settings.connectionsTip')}
      </Hint>

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
                className="text-accent underline"
              >
                {t('settings.getToken')}
              </a>
              {settings._listenbrainzScope === 'user' && (
                <span className="text-xs text-accent ml-2">{t('settings.yourAccount')}</span>
              )}
            </span>
          }
          status={serviceStatus('listenbrainz')}
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
                className="text-accent underline"
              >
                {t('settings.getApiKey')}
              </a>
              {settings._lastfmScope === 'user' && (
                <span className="text-xs text-accent ml-2">{t('settings.yourAccount')}</span>
              )}
            </span>
          }
          status={serviceStatus('lastfm')}
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
                className="text-accent underline"
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

      {/* Plex */}
      <div>
        <ServiceCard
          name="Plex"
          description={t('settings.plexDescription')}
          status={serviceStatus('plex')}
          icon={<PlexIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('settings.fieldServerUrl')} id="plex-url">
              <Input
                id="plex-url"
                type="url"
                placeholder="http://localhost:32400"
                value={plexUrl}
                onChange={(e) => setPlexUrl(e.target.value)}
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
                onChange={(e) => setPlexToken(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {canTestUserConnections && (
              <Button
                size="sm"
                variant="outline"
                onClick={testPlex}
                disabled={tests.plex === 'testing'}
              >
                {tests.plex === 'testing' ? t('settings.testing') : t('settings.testConnection')}
              </Button>
            )}
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
                className="text-accent underline"
              >
                {t('settings.getPersonalAccessToken')}
              </a>
            </span>
          }
          status={serviceStatus('discogs')}
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

function LidarrPreferencesSection() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { data: userPrefs } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: getUserPreferences,
  })
  const { data: qualityProfiles } = useQuery({
    queryKey: ['lidarrProfiles'],
    queryFn: getLidarrProfiles,
  })
  const { data: metadataProfiles } = useQuery({
    queryKey: ['lidarrMetadataProfiles'],
    queryFn: getLidarrMetadataProfiles,
  })
  const { data: rootFolders } = useQuery({
    queryKey: ['lidarrRootFolders'],
    queryFn: getLidarrRootFolders,
  })

  const [qualityProfileId, setQualityProfileId] = useState('1')
  const [metadataProfileId, setMetadataProfileId] = useState('1')
  const [rootFolderId, setRootFolderId] = useState('1')
  const [saving, setSaving] = useState(false)

  // Sync local state from user prefs when they load
  useEffect(() => {
    if (!userPrefs) return
    const p = userPrefs as Record<string, unknown>
    setQualityProfileId(String(p.qualityProfileId ?? 1))
    setMetadataProfileId(String(p.metadataProfileId ?? 1))
    setRootFolderId(String(p.rootFolderId ?? 1))
  }, [userPrefs])

  async function handleSave() {
    setSaving(true)
    try {
      await updateUserPreferences({
        qualityProfileId: parseInt(qualityProfileId, 10) || 1,
        metadataProfileId: parseInt(metadataProfileId, 10) || 1,
        rootFolderId: parseInt(rootFolderId, 10) || 1,
      })
      queryClient.invalidateQueries({ queryKey: ['user-preferences'] })
      toast.success(t('settings.lidarrPreferencesSaved'))
    } catch {
      toast.error(t('settings.lidarrPreferencesFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="pt-2 mb-4">
        <h3 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.lidarrPreferences')}
        </h3>
        <p className="text-xs text-muted mt-1">{t('settings.lidarrPreferencesDescription')}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('settings.qualityProfile')} id="user-quality-profile">
            <Select
              id="user-quality-profile"
              value={qualityProfileId}
              onChange={(e) => setQualityProfileId(e.target.value)}
            >
              {qualityProfiles ? (
                qualityProfiles.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))
              ) : (
                <option value={qualityProfileId}>{t('common.loading')}</option>
              )}
            </Select>
          </Field>
          <Field label={t('settings.metadataProfile')} id="user-metadata-profile">
            <Select
              id="user-metadata-profile"
              value={metadataProfileId}
              onChange={(e) => setMetadataProfileId(e.target.value)}
            >
              {metadataProfiles ? (
                metadataProfiles.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))
              ) : (
                <option value={metadataProfileId}>{t('common.loading')}</option>
              )}
            </Select>
          </Field>
          <Field label={t('settings.rootFolder')} id="user-root-folder">
            <Select
              id="user-root-folder"
              value={rootFolderId}
              onChange={(e) => setRootFolderId(e.target.value)}
            >
              {rootFolders ? (
                rootFolders.map((f) => (
                  <option key={f.id} value={String(f.id)}>
                    {f.path}
                  </option>
                ))
              ) : (
                <option value={rootFolderId}>{t('common.loading')}</option>
              )}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

type AddTargetField =
  | {
      kind?: 'input'
      key: string
      label: string
      placeholder: string
      type?: 'password' | 'url' | 'text'
    }
  | {
      kind: 'select'
      key: string
      label: string
      options: Array<{ value: string; label: string }>
    }

type AddTargetType = {
  value: string
  label: string
  fields: AddTargetField[]
}

function getTargetTypes(
  t: ReturnType<typeof useI18n>['t'],
  lidarrTargets: Array<{ id: number; name: string }>,
): AddTargetType[] {
  const lidarrTargetLabel = `${t('settings.targetTypeLidarr')} ${t('jobHistory.targetType')}`

  return [
    {
      value: 'lidarr',
      label: t('settings.targetTypeLidarr'),
      fields: [
        {
          key: 'url',
          label: t('settings.fieldUrl'),
          placeholder: 'http://lidarr:8686',
          type: 'url',
        },
        {
          key: 'apiKey',
          label: t('settings.fieldApiKey'),
          placeholder: t('settings.fieldApiKeyOptional'),
          type: 'password',
        },
      ],
    },
    {
      value: 'slskd',
      label: t('settings.targetTypeSlskd'),
      fields: [
        {
          key: 'url',
          label: t('settings.fieldUrl'),
          placeholder: 'http://slskd:5030',
          type: 'url',
        },
        {
          key: 'apiKey',
          label: t('settings.fieldApiKey'),
          placeholder: t('settings.fieldApiKeyOptional'),
          type: 'password',
        },
        {
          kind: 'select',
          key: 'lidarrTargetId',
          label: lidarrTargetLabel,
          options: [
            { value: '', label: t('common.none') },
            ...lidarrTargets.map((target) => ({
              value: String(target.id),
              label: target.name,
            })),
          ],
        },
      ],
    },
    {
      value: 'emby-playlist',
      label: t('settings.targetTypeEmbyPlaylist'),
      fields: [
        { key: 'url', label: t('settings.fieldUrl'), placeholder: 'http://emby:8096', type: 'url' },
        {
          key: 'apiKey',
          label: t('settings.fieldApiKey'),
          placeholder: t('settings.fieldApiKey'),
          type: 'password',
        },
        { key: 'userId', label: t('settings.fieldUserId'), placeholder: t('settings.fieldUserId') },
      ],
    },
  ]
}

function TargetTypeIcon({ type }: { type: string }) {
  const iconMap: Record<string, string> = {
    lidarr: '/icons/lidarr.png',
    'emby-playlist': '/icons/emby.svg',
    jellyfin: '/icons/jellyfin.svg',
    'spotify-playlist': '/icons/spotify.svg',
  }
  const src = iconMap[type]
  if (src) return <img src={src} alt="" className="w-5 h-5" />
  return (
    <span className="w-5 h-5 rounded bg-accent text-accent-fg text-micro font-bold flex items-center justify-center uppercase">
      {type.charAt(0)}
    </span>
  )
}

function normalizeTargetConfig(
  type: string,
  config: Record<string, string>,
): Record<string, unknown> {
  const normalizedEntries = Object.entries(config).filter(([, value]) => value !== '')
  const normalizedConfig = Object.fromEntries(normalizedEntries) as Record<string, unknown>

  if (type === 'slskd' && typeof normalizedConfig.lidarrTargetId === 'string') {
    const lidarrTargetId = Number.parseInt(normalizedConfig.lidarrTargetId, 10)
    if (Number.isFinite(lidarrTargetId)) {
      normalizedConfig.lidarrTargetId = lidarrTargetId
    } else {
      delete normalizedConfig.lidarrTargetId
    }
  }

  return normalizedConfig
}

function serializeTargetConfigForForm(config: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config)
      .filter(([, value]) => value !== '***')
      .map(([key, value]) => [key, typeof value === 'string' ? value : String(value)]),
  )
}

function AddTargetDialog({
  onClose,
  onSaved,
  targets,
  initialTarget,
}: {
  onClose: () => void
  onSaved: () => void
  targets: Array<{ id: number; type: string; name: string; enabled: boolean }>
  initialTarget?: {
    id: number
    type: string
    name: string
    enabled: boolean
    config: Record<string, unknown>
  }
}) {
  const { t } = useI18n()
  const targetTypes = getTargetTypes(
    t,
    targets
      .filter((target) => target.type === 'lidarr' && target.enabled)
      .map((target) => ({ id: target.id, name: target.name })),
  )
  const [type, setType] = useState(initialTarget?.type ?? '')
  const [name, setName] = useState(initialTarget?.name ?? '')
  const [enabled, setEnabled] = useState(initialTarget?.enabled ?? true)
  const [config, setConfig] = useState<Record<string, string>>(
    initialTarget ? serializeTargetConfigForForm(initialTarget.config) : {},
  )
  const [saving, setSaving] = useState(false)

  const selectedType = targetTypes.find((tt) => tt.value === type)
  const isEditing = Boolean(initialTarget)

  async function handleSave() {
    if (!type || !selectedType) return
    setSaving(true)
    try {
      if (initialTarget) {
        await updateTargetApi(initialTarget.id, {
          name: name || selectedType.label,
          enabled,
          config: normalizeTargetConfig(type, config),
        })
        toast.success(t('settings.targetUpdated'))
      } else {
        await createTargetApi({
          type,
          name: name || selectedType.label,
          config: normalizeTargetConfig(type, config),
        })
        toast.success(t('settings.targetAdded'))
      }
      onSaved()
      onClose()
    } catch {
      toast.error(isEditing ? t('settings.targetUpdateFailed') : t('settings.targetAddFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      <h4 className="text-sm font-medium text-text">
        {isEditing ? t('settings.editTarget') : t('settings.addTarget')}
      </h4>

      {!isEditing && (
        <div>
          <label className="block text-xs text-muted mb-1">
            {t('settings.type')}
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value)
                setConfig({})
              }}
              className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
            >
              <option value="">{t('settings.selectTargetType')}</option>
              {targetTypes.map((tt) => (
                <option key={tt.value} value={tt.value}>
                  {tt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {selectedType && (
        <>
          <div>
            <label className="block text-xs text-muted mb-1">
              {t('settings.name')}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={selectedType.label}
                className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
              />
            </label>
          </div>

          {isEditing && (
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              {t('common.enabled')}
            </label>
          )}

          {selectedType.fields.map((field) => (
            <div key={field.key}>
              {(() => {
                const fieldId = `add-target-${type}-${field.key}`
                return (
                  <label htmlFor={fieldId} className="block text-xs text-muted mb-1">
                    {field.label}
                    {field.kind === 'select' ? (
                      <select
                        id={fieldId}
                        value={config[field.key] ?? ''}
                        onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                        className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
                      >
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={fieldId}
                        type={field.type ?? 'text'}
                        value={config[field.key] ?? ''}
                        onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                        placeholder={field.placeholder}
                        className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
                      />
                    )}
                  </label>
                )
              })()}
            </div>
          ))}

          {selectedType.value === 'slskd' && (
            <div className="rounded-md border border-border bg-bg/60 p-3 space-y-2">
              <p className="text-xs text-muted">{t('settings.slskdModeHelp')}</p>
              <ul className="space-y-1 text-xs text-muted list-disc pl-4">
                <li>{t('settings.slskdReleasePolicy')}</li>
                <li>{t('settings.slskdQualityPolicy')}</li>
              </ul>
              <p className="text-xs text-muted">
                {config.lidarrTargetId
                  ? t('settings.approvalActionLidarrSlskd')
                  : t('settings.approvalActionSlskd')}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !type}>
              {saving
                ? isEditing
                  ? t('settings.saving')
                  : t('settings.adding')
                : isEditing
                  ? t('settings.saveChanges')
                  : t('settings.addTarget')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function TargetsTab() {
  const { t } = useI18n()
  const { data: targets, refetch } = useQuery({
    queryKey: ['targets'],
    queryFn: listTargets,
  })
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const isAdmin = currentUser?.isAdmin ?? false
  const [testing, setTesting] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editingTargetId, setEditingTargetId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<
    Record<number, { success: boolean; message: string }>
  >({})

  async function handleTest(id: number) {
    setTesting(id)
    try {
      const result = await testTargetApi(id)
      setTestResults((prev) => ({
        ...prev,
        [id]: { success: result.success, message: result.message },
      }))
      if (result.success) {
        toast.success(t('settings.targetTestSuccess'))
      } else {
        toast.error(result.message || t('settings.targetTestFailed'))
      }
    } catch {
      toast.error(t('settings.targetTestFailed'))
    } finally {
      setTesting(null)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteTargetApi(id)
      toast.success(t('settings.targetRemoved'))
      refetch()
    } catch {
      toast.error(t('settings.targetRemoveFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <Hint id="settings-targets-tip" type="inline">
        {t('settings.targetsTip')}
      </Hint>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">{t('settings.tabs.targets')}</h3>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setAddOpen(!addOpen)}>
            {addOpen ? t('common.cancel') : t('settings.addTarget')}
          </Button>
        )}
      </div>

      {addOpen && (
        <AddTargetDialog
          onClose={() => setAddOpen(false)}
          onSaved={() => refetch()}
          targets={targets ?? []}
        />
      )}

      {!addOpen && targets?.length === 0 && (
        <p className="text-sm text-muted">{t('settings.noTargets')}</p>
      )}

      {targets?.map((target) => {
        const owned = target.owned
        const testResult = testResults[target.id]
        const linkedLidarrTarget =
          typeof target.config.lidarrTargetId === 'number'
            ? targets?.find((item) => item.id === target.config.lidarrTargetId)
            : null
        return (
          <div key={target.id} className="rounded-lg border border-border bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <TargetTypeIcon type={target.type} />
                  <span className="text-sm font-medium text-text">{target.name}</span>
                  <span className="text-xs text-muted capitalize">({target.type})</span>
                  <span className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted border border-border">
                    {target.enabled ? t('common.enabled') : t('common.disabled')}
                  </span>
                  {testResult && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        testResult.success
                          ? 'bg-approve/15 text-approve'
                          : 'bg-reject/15 text-reject'
                      }`}
                    >
                      {testResult.success
                        ? t('settings.connected')
                        : t('settings.targetTestFailed')}
                    </span>
                  )}
                </div>
                {!owned && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-bg text-muted border border-border">
                    {t('settings.shared')}
                  </span>
                )}
              </div>
              {owned && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingTargetId(target.id)}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(target.id)}
                    disabled={testing === target.id}
                  >
                    {testing === target.id ? t('settings.testing') : t('settings.test')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(target.id)}
                    className="text-reject"
                  >
                    {t('settings.remove')}
                  </Button>
                </div>
              )}
            </div>
            {typeof target.config.url === 'string' && (
              <p className="text-xs text-muted">{target.config.url}</p>
            )}
            {linkedLidarrTarget && (
              <p className="text-xs text-muted">
                {t('settings.linkedTarget')} {linkedLidarrTarget.name}
              </p>
            )}
            {testResult?.message && <p className="text-xs text-muted">{testResult.message}</p>}
            {editingTargetId === target.id && (
              <AddTargetDialog
                onClose={() => setEditingTargetId(null)}
                onSaved={() => {
                  setEditingTargetId(null)
                  refetch()
                }}
                targets={targets ?? []}
                initialTarget={target}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function RecommendationsTab() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { data: prefs, isLoading: prefsLoading } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: getUserPreferences,
  })
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  })

  useEffect(() => {
    if (!settings) return
    const proxy = (settings as { audiodbProxyImages?: boolean }).audiodbProxyImages
    if (typeof proxy === 'boolean') setAudiodbProxyFlag(proxy)
  }, [settings])

  if (prefsLoading || !prefs) {
    return <div className="text-sm text-muted">{t('settings.loadingPreferences')}</div>
  }

  return (
    <RecommendationsTabInner
      prefs={prefs}
      settings={(settings ?? {}) as Settings}
      queryClient={queryClient}
    />
  )
}

function RecommendationsTabInner({
  prefs,
  settings,
  queryClient,
}: {
  prefs: Record<string, unknown>
  settings: Settings
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const { t } = useI18n()
  const weights =
    (prefs.scoringWeights as Preferences['scoringWeights']) ?? DEFAULT_PREFERENCES.scoringWeights

  const [scoreThreshold, setScoreThreshold] = useState((prefs.scoreThreshold as number) ?? 0.5)
  const [consensus, setConsensus] = useState(weights.consensus)
  const [similarity, setSimilarity] = useState(weights.similarity)
  const [genreOverlap, setGenreOverlap] = useState(weights.genreOverlap)
  const [aiConfidence, setAiConfidence] = useState(weights.aiConfidence)
  const [feedbackBoost, setFeedbackBoost] = useState(weights.feedbackBoost)
  const [popularity, setPopularity] = useState(weights.popularity ?? 0)
  const [rejectionCooldown, setRejectionCooldown] = useState(
    String((prefs.rejectionCooldownDays as number) ?? 90),
  )
  const [topArtistsLimit, setTopArtistsLimit] = useState(
    String((prefs.topArtistsLimit as number) ?? 30),
  )
  const [librarySeedRatio, setLibrarySeedRatio] = useState(
    (prefs.librarySeedRatio as number) ?? 0.3,
  )
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(
    (prefs.autoApproveEnabled as boolean) ?? false,
  )
  const [autoApproveThreshold, setAutoApproveThreshold] = useState(
    (prefs.autoApproveThreshold as number) ?? 0.8,
  )
  const [autoApproveMonitorOption, setAutoApproveMonitorOption] = useState(
    (prefs.autoApproveMonitorOption as string) ?? 'all',
  )
  const [fanartApiKey, setFanartApiKey] = useState(String(prefs.fanartApiKey ?? ''))
  const [metadataFallbackUrl, setMetadataFallbackUrl] = useState(
    String(prefs.metadataFallbackUrl ?? ''),
  )
  const [audiodbApiKey, setAudiodbApiKey] = useState(
    settings.audiodbApiKey === '***' ? '' : (settings.audiodbApiKey ?? ''),
  )
  const [audiodbProxyImages, setAudiodbProxyImages] = useState<boolean>(
    Boolean(settings.audiodbProxyImages),
  )
  const [wikidataEnabled, setWikidataEnabled] = useState<boolean>(
    settings.wikidataEnabled !== false,
  )
  const [saving, setSaving] = useState(false)

  const weightSum =
    consensus + similarity + genreOverlap + aiConfidence + feedbackBoost + popularity
  const weightsOk = Math.abs(weightSum - 1.0) < 0.01

  async function handleSave() {
    setSaving(true)
    try {
      await updateUserPreferences({
        scoreThreshold,
        scoringWeights: {
          consensus,
          similarity,
          genreOverlap,
          aiConfidence,
          feedbackBoost,
          popularity,
        },
        rejectionCooldownDays:
          parseInt(rejectionCooldown, 10) || (prefs.rejectionCooldownDays as number),
        topArtistsLimit: parseInt(topArtistsLimit, 10) || (prefs.topArtistsLimit as number),
        librarySeedRatio,
        autoApproveEnabled,
        autoApproveThreshold,
        autoApproveMonitorOption: autoApproveMonitorOption as 'all' | 'new' | 'none',
        fanartApiKey: fanartApiKey === '***' ? undefined : fanartApiKey || undefined,
        metadataFallbackUrl: metadataFallbackUrl || undefined,
      })
      await updateSettings({
        audiodbApiKey: audiodbApiKey === '***' ? undefined : audiodbApiKey || null,
        audiodbProxyImages,
        wikidataEnabled,
      })
      setAudiodbProxyFlag(audiodbProxyImages)
      queryClient.invalidateQueries({ queryKey: ['user-preferences'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success(t('settings.recommendationsSaved'))
    } catch {
      toast.error(t('settings.recommendationsFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <Hint id="settings-recommendations-tip" type="inline">
        {t('settings.recommendationsTip')}
      </Hint>

      {/* Essential - always visible */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.scoreThreshold')}
        </h2>
        <SliderField
          label={t('settings.minScoreToShow')}
          id="score-threshold"
          value={scoreThreshold}
          min={0}
          max={1}
          step={0.05}
          onChange={setScoreThreshold}
        />
      </section>

      {/* Tuning - collapsed by default */}
      <CollapsibleSection title={t('settings.scoringWeights')}>
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-3">
            <span
              className={`text-xs tabular-nums ${weightsOk ? 'text-muted' : 'text-yellow-400'}`}
            >
              {t('settings.totalWeight')} {weightSum.toFixed(2)}
              {weightsOk ? '' : ` ${t('settings.shouldSumToOne')}`}
            </span>
          </div>
          <SliderField
            label={t('settings.consensus')}
            id="w-consensus"
            value={consensus}
            min={0}
            max={1}
            step={0.05}
            onChange={setConsensus}
          />
          <SliderField
            label={t('settings.similarity')}
            id="w-similarity"
            value={similarity}
            min={0}
            max={1}
            step={0.05}
            onChange={setSimilarity}
          />
          <SliderField
            label={t('settings.genreOverlap')}
            id="w-genre"
            value={genreOverlap}
            min={0}
            max={1}
            step={0.05}
            onChange={setGenreOverlap}
          />
          <SliderField
            label={t('settings.aiConfidence')}
            id="w-ai"
            value={aiConfidence}
            min={0}
            max={1}
            step={0.05}
            onChange={setAiConfidence}
          />
          <SliderField
            label={t('settings.feedbackBoost')}
            id="w-feedback"
            value={feedbackBoost}
            min={0}
            max={1}
            step={0.05}
            onChange={setFeedbackBoost}
          />
          <SliderField
            label={t('settings.popularity')}
            id="w-popularity"
            value={popularity}
            min={0}
            max={1}
            step={0.05}
            onChange={setPopularity}
          />
          <p className="text-xs text-muted">{t('settings.popularityHelp')}</p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title={t('settings.autoApprove')}>
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted">{t('settings.autoApproveDescription')}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoApproveEnabled}
              onChange={(e) => setAutoApproveEnabled(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-sm text-text">{t('settings.enableAutoApprove')}</span>
          </label>
          {autoApproveEnabled && (
            <div className="space-y-3 pl-6">
              <SliderField
                label={t('settings.minimumScore')}
                id="auto-approve-threshold"
                value={autoApproveThreshold}
                min={0.5}
                max={1.0}
                step={0.05}
                onChange={setAutoApproveThreshold}
                displayValue={`${Math.round(autoApproveThreshold * 100)}%`}
              />
              <div className="space-y-1.5">
                <label htmlFor="auto-approve-monitor" className="text-sm text-muted">
                  {t('settings.monitorMode')}
                </label>
                <select
                  id="auto-approve-monitor"
                  value={autoApproveMonitorOption}
                  onChange={(e) => setAutoApproveMonitorOption(e.target.value)}
                  className="mt-1 w-full bg-bg border border-border rounded text-sm text-text px-2 py-1.5"
                >
                  <option value="all">{t('settings.monitorAll')}</option>
                  <option value="new">{t('settings.monitorNew')}</option>
                  <option value="none">{t('settings.monitorNone')}</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Advanced - collapsed by default */}
      <CollapsibleSection title={t('settings.advancedSettings')}>
        <div className="space-y-6 pt-2">
          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">
              {t('settings.limits')}
            </h3>
            <Field label={t('settings.rejectionCooldown')} id="rejection-cooldown">
              <Input
                id="rejection-cooldown"
                type="number"
                min={1}
                value={rejectionCooldown}
                onChange={(e) => setRejectionCooldown(e.target.value)}
                className="max-w-[120px]"
              />
            </Field>
            <Field label={t('settings.topArtistsLimit')} id="top-artists-limit">
              <Input
                id="top-artists-limit"
                type="number"
                min={1}
                value={topArtistsLimit}
                onChange={(e) => setTopArtistsLimit(e.target.value)}
                className="max-w-[120px]"
              />
            </Field>
          </section>

          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">
              {t('settings.libraryDiscovery')}
            </h3>
            <p className="text-xs text-muted">{t('settings.libraryDiscoveryHelp')}</p>
            <SliderField
              label={t('settings.librarySeedRatio')}
              id="library-seed-ratio"
              value={librarySeedRatio}
              min={0}
              max={1}
              step={0.05}
              onChange={setLibrarySeedRatio}
            />
          </section>

          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">
              {t('settings.imageSources')}
            </h3>
            <p className="text-xs text-muted">{t('settings.imageSourcesHelp')}</p>
            <Field label={t('settings.audiodb.apiKey')} id="audiodb-api-key">
              <Input
                id="audiodb-api-key"
                type="password"
                value={audiodbApiKey}
                onChange={(e) => setAudiodbApiKey(e.target.value)}
                placeholder={t('settings.audiodb.apiKeyPlaceholder')}
              />
            </Field>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={audiodbProxyImages}
                onChange={(e) => setAudiodbProxyImages(e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm">
                {t('settings.audiodb.proxyImages')}
                <span className="block text-micro text-muted">
                  {t('settings.audiodb.proxyHint')}
                </span>
              </span>
            </label>
            <Field label={t('settings.fieldFanartApiKey')} id="fanart-api-key">
              <Input
                id="fanart-api-key"
                type="password"
                value={fanartApiKey}
                onChange={(e) => setFanartApiKey(e.target.value)}
                placeholder={t('settings.fieldFanartApiKey')}
              />
            </Field>
            <Field label={t('settings.fieldMetadataFallbackUrl')} id="metadata-fallback-url">
              <Input
                id="metadata-fallback-url"
                value={metadataFallbackUrl}
                onChange={(e) => setMetadataFallbackUrl(e.target.value)}
                placeholder="https://api.musicinfo.pro"
              />
            </Field>
            <p className="text-micro text-muted">{t('settings.metadataFallbackHelp')}</p>
          </section>

          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">
              {t('settings.wikidata.title')}
            </h3>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={wikidataEnabled}
                onChange={(e) => setWikidataEnabled(e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm">{t('settings.wikidata.enabled')}</span>
            </label>
          </section>
        </div>
      </CollapsibleSection>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? t('settings.saving') : t('settings.save')}
      </Button>
    </div>
  )
}

type CronPreset = { label: string; value: string }

const PRESETS: CronPreset[] = [
  { label: 'Daily', value: '0 0 * * *' },
  { label: 'Weekly', value: '0 0 * * 0' },
  { label: 'Biweekly', value: '0 0 1,15 * *' },
  { label: 'Monthly', value: '0 0 1 * *' },
]

function ScheduleTab({ settings }: { settings: Settings }) {
  const { t } = useI18n()
  const prefs = settings.preferences ?? {}
  const [cron, setCron] = useState(prefs.scheduleCron ?? '0 0 * * *')
  const [librarySyncIntervalHours, setLibrarySyncIntervalHours] = useState(
    String(settings.librarySyncIntervalHours ?? 6),
  )
  const [saving, setSaving] = useState(false)

  const presetLabels: Record<string, string> = {
    Daily: t('settings.daily'),
    Weekly: t('settings.weekly'),
    Biweekly: t('settings.biweekly'),
    Monthly: t('settings.monthly'),
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateSettings({
        preferences: { ...prefs, scheduleCron: cron },
        librarySyncIntervalHours: Number.parseInt(librarySyncIntervalHours, 10) || 6,
      })
      toast.success(t('settings.scheduleSaved'))
    } catch {
      toast.error(t('settings.scheduleFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Hint id="settings-schedule-tip" type="inline">
        {t('settings.scheduleTip')}
      </Hint>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.presets')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              variant={cron === p.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCron(p.value)}
            >
              {presetLabels[p.label] ?? p.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.customCron')}
        </h2>
        <Field label={t('settings.cronExpression')} id="cron-expr">
          <Input
            id="cron-expr"
            placeholder="0 0 * * *"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            className="font-mono"
          />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.librarySyncInterval')}
        </h2>
        <Field label={t('settings.librarySyncIntervalHours')} id="library-sync-interval-hours">
          <Input
            id="library-sync-interval-hours"
            type="number"
            min="1"
            max="24"
            value={librarySyncIntervalHours}
            onChange={(e) => setLibrarySyncIntervalHours(e.target.value)}
          />
        </Field>
        <p className="text-xs text-muted">{t('settings.librarySyncIntervalHelp')}</p>
      </section>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? t('settings.saving') : t('settings.save')}
      </Button>
    </div>
  )
}

function AccountTab() {
  const { t, locale, setLocale } = useI18n()
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const { canInstall, showIosHint, promptInstall, dismiss } = useInstallPrompt()

  async function handleLogout() {
    try {
      await logoutUser()
    } catch {
      // Session might already be invalid
    }
    clearStoredToken()
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error(t('settings.passwordsDoNotMatch'))
      return
    }
    if (newPassword.length < 12) {
      toast.error(t('settings.passwordTooShort'))
      return
    }
    setSaving(true)
    try {
      const res = await changePassword(currentPassword, newPassword)
      // Server invalidated old sessions and issued a new token
      if (res.token) setStoredToken(res.token)
      toast.success(t('settings.passwordChanged'))
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      const msg = errMsg(err)
      toast.error(
        msg.includes('401') || msg.includes('403') ? t('settings.currentPasswordIncorrect') : msg,
      )
    } finally {
      setSaving(false)
    }
  }

  function handleLocaleChange(nextLocale: SupportedLocale) {
    setLocale(nextLocale)
  }

  return (
    <div className="space-y-6 max-w-lg">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.profile')}
        </h2>
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted">
            {t('settings.signedInAs')}{' '}
            <span className="text-text font-medium">{user?.username ?? '...'}</span>
            {user?.isAdmin && (
              <span className="ml-2 text-xs bg-accent text-accent-fg px-1.5 py-0.5 rounded">
                {t('userManagement.adminBadge')}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            {t('settings.logOut')}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.changePassword')}
        </h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <Field label={t('settings.currentPassword')} id="current-pw">
            <Input
              id="current-pw"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label={t('settings.newPassword')} id="new-pw">
            <Input
              id="new-pw"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={t('settings.minCharsPassword')}
            />
          </Field>
          <Field label={t('settings.confirmNewPassword')} id="confirm-pw">
            <Input
              id="confirm-pw"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Button type="submit" disabled={saving}>
            {saving ? t('settings.changing') : t('settings.changePassword')}
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.language')}
        </h2>
        <Field label={t('common.language')} id="preferred-locale">
          <LanguageSwitcher value={locale} onChange={handleLocaleChange} />
        </Field>
      </section>

      {(canInstall || showIosHint) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            {t('settings.app')}
          </h2>
          <div className="flex items-center justify-between p-3 bg-surface border border-border rounded-lg">
            <div>
              <p className="text-sm font-medium text-text">{t('settings.installDigarr')}</p>
              {showIosHint ? (
                <p className="text-xs text-muted mt-0.5">{t('settings.installIosHint')}</p>
              ) : (
                <p className="text-xs text-muted mt-0.5">{t('settings.installHint')}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="text-xs text-muted hover:text-text transition-colors"
              >
                {t('discoveryMode.dismiss')}
              </button>
              {canInstall && (
                <button
                  type="button"
                  onClick={promptInstall}
                  className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-fg rounded hover:bg-accent/90 transition-colors"
                >
                  {t('settings.install')}
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function AuthTab({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const { t } = useI18n()
  const [oidcIssuerUrl, setOidcIssuerUrl] = useState(settings.oidcIssuerUrl ?? '')
  const [oidcClientId, setOidcClientId] = useState(settings.oidcClientId ?? '')
  const [oidcClientSecret, setOidcClientSecret] = useState(
    settings.oidcClientSecret === '***' ? '' : (settings.oidcClientSecret ?? ''),
  )
  const [secretDirty, setSecretDirty] = useState(false)
  const [oidcScopes, setOidcScopes] = useState(settings.oidcScopes ?? '')
  const [saving, setSaving] = useState(false)
  const [testingOidc, setTestingOidc] = useState(false)

  // proxyAuthEnabled moved off /auth/status (fingerprint hardening); fetch
  // it from /auth/meta (auth-gated). Settings page is always authenticated.
  const { data: authMeta } = useQuery({
    queryKey: ['authMeta'],
    queryFn: getAuthMeta,
  })

  async function handleSave() {
    setSaving(true)
    try {
      const updates: Record<string, unknown> = {
        oidcIssuerUrl: oidcIssuerUrl || undefined,
        oidcClientId: oidcClientId || undefined,
        oidcScopes: oidcScopes || undefined,
      }
      if (secretDirty) {
        updates.oidcClientSecret = oidcClientSecret || undefined
      }
      await updateSettings(updates)
      toast.success(t('settings.authSaved'))
      onSaved()
    } catch {
      toast.error(t('settings.authFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleTestOidc() {
    setTestingOidc(true)
    try {
      await testService('oidc', {
        issuerUrl: oidcIssuerUrl,
        clientId: oidcClientId,
        clientSecret: oidcClientSecret || undefined,
      })
      toast.success(t('settings.oidcTestSuccess'))
    } catch {
      toast.error(t('settings.oidcTestFailed'))
    } finally {
      setTestingOidc(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Hint id="settings-auth-tip" type="inline">
        {t('settings.authTip')}
      </Hint>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            {t('settings.oidcSso')}
          </h2>
          <p className="text-xs text-muted mt-1">{t('settings.oidcDescription')}</p>
        </div>
        <Field label={t('settings.fieldIssuerUrl')} id="oidc-issuer-url">
          <Input
            id="oidc-issuer-url"
            type="url"
            placeholder="https://auth.example.com"
            value={oidcIssuerUrl}
            onChange={(e) => setOidcIssuerUrl(e.target.value)}
          />
        </Field>
        <Field label={t('settings.fieldClientId')} id="oidc-client-id">
          <Input
            id="oidc-client-id"
            placeholder={t('settings.fieldClientId')}
            value={oidcClientId}
            onChange={(e) => setOidcClientId(e.target.value)}
          />
        </Field>
        <Field label={t('settings.fieldClientSecret')} id="oidc-client-secret">
          <Input
            id="oidc-client-secret"
            type="password"
            placeholder={
              settings.oidcClientSecret === '***'
                ? `(${t('settings.saved')})`
                : t('settings.fieldClientSecret')
            }
            value={oidcClientSecret}
            onChange={(e) => {
              setOidcClientSecret(e.target.value)
              setSecretDirty(true)
            }}
          />
        </Field>
        <Field label={t('settings.fieldScopes')} id="oidc-scopes">
          <Input
            id="oidc-scopes"
            placeholder="openid profile email"
            value={oidcScopes}
            onChange={(e) => setOidcScopes(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestOidc}
            disabled={testingOidc || !oidcIssuerUrl || !oidcClientId}
          >
            {testingOidc ? t('settings.testing') : t('settings.testConnection')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            {t('settings.reverseProxyAuth')}
          </h2>
          <p className="text-xs text-muted mt-1">
            {t('settings.reverseProxyDescription')} {t('settings.reverseProxyConfigHint')}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 text-sm">
          {authMeta?.proxyAuthEnabled ? (
            <span className="text-text">{t('settings.proxyEnabled')}</span>
          ) : (
            <span className="text-muted">{t('settings.proxyDisabled')}</span>
          )}
        </div>
      </section>
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border mb-6">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-9 w-28 mb-1" />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-40 w-full rounded-lg" />
      ))}
    </div>
  )
}

export function SettingsPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(initialTab ?? 'connections')
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const isAdmin = currentUser?.isAdmin ?? false
  const {
    data,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  })

  function refetch() {
    queryClient.invalidateQueries({ queryKey: ['settings'] })
  }

  useEffect(() => {
    if (initialTab && initialTab !== tab) {
      setTab(initialTab)
    }
  }, [initialTab, tab])

  function handleTabChange(nextTab: Tab) {
    setTab(nextTab)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('tab', nextTab)
    setSearchParams(nextParams, { replace: true })
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-text mb-6">{t('settings.title')}</h1>
        <SettingsSkeleton />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-6xl mx-auto text-reject">
        <p>Failed to load settings: {error?.message ?? 'Unknown error'}</p>
        <Button variant="outline" size="sm" onClick={refetch} className="mt-3">
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-text mb-6">{t('settings.title')}</h1>
      <TabBar active={tab} onChange={handleTabChange} isAdmin={isAdmin} />
      {tab === 'connections' && <ConnectionsTab settings={data} onSaved={refetch} />}
      {tab === 'targets' && <TargetsTab />}
      {tab === 'recommendations' && <RecommendationsTab />}
      {tab === 'blocked' && <BlockedArtistsTab />}
      {tab === 'schedule' && <ScheduleTab settings={data} />}
      {tab === 'account' && <AccountTab />}
      {tab === 'auth' && <AuthTab settings={data} onSaved={refetch} />}
      {tab === 'users' && <UserManagementPage />}
      {tab === 'administration' && <AdministrationTab />}
      {tab === 'jobs' && <JobHistoryPage embedded />}
      {tab === 'system-health' && <SystemHealthCard embedded />}
    </div>
  )
}
