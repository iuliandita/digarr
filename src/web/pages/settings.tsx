import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { errMsg } from '@/core/validation'
import { DEFAULT_PREFERENCES, type Preferences } from '@/db/schema'
import { AdministrationTab } from '../components/admin/administration-tab'
import { CollapsibleSection } from '../components/collapsible-section'
import { Field } from '../components/field'
import { Hint } from '../components/hint'
import { ServiceCard } from '../components/service-card'
import {
  AiProviderIcon,
  DiscogsIcon,
  JellyfinIcon,
  LastfmIcon,
  LidarrIcon,
  ListenBrainzIcon,
  PlexIcon,
  SpotifyIcon,
  WebhookIcon,
} from '../components/service-icons'
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
  getAuthStatus,
  getCurrentUser,
  getLidarrMetadataProfiles,
  getLidarrProfiles,
  getLidarrRootFolders,
  getOAuthStatus,
  getSettings,
  getUserPreferences,
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
  updateUserPreferences,
} from '../lib/api'
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
  preferences?: Partial<Preferences>
  setupComplete?: boolean
  _listenbrainzScope?: 'user' | 'global'
  _lastfmScope?: 'user' | 'global'
}

type Tab =
  | 'connections'
  | 'targets'
  | 'recommendations'
  | 'schedule'
  | 'account'
  | 'auth'
  | 'users'
  | 'administration'

function TabBar({
  active,
  onChange,
  isAdmin,
}: {
  active: Tab
  onChange: (t: Tab) => void
  isAdmin: boolean
}) {
  const allTabs: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: 'connections', label: 'Connections' },
    { id: 'targets', label: 'Targets' },
    { id: 'recommendations', label: 'Recommendations' },
    { id: 'schedule', label: 'Schedule', adminOnly: true },
    { id: 'account', label: 'Account' },
    { id: 'auth', label: 'Authentication', adminOnly: true },
    { id: 'users', label: 'Users', adminOnly: true },
    { id: 'administration', label: 'Administration', adminOnly: true },
  ]
  const tabs = allTabs.filter((t) => !t.adminOnly || isAdmin)
  return (
    <div
      className="flex gap-1 border-b border-border mb-6 overflow-x-auto -mx-6 px-6"
      style={{ scrollbarWidth: 'none' }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={[
            'px-3 sm:px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0',
            active === t.id
              ? 'border-accent text-text'
              : 'border-transparent text-muted hover:text-text',
          ].join(' ')}
        >
          {t.label}
        </button>
      ))}
      {isAdmin && (
        <Link
          to="/settings/jobs"
          className="px-3 sm:px-4 py-2 text-sm font-medium border-b-2 border-transparent -mb-px transition-colors whitespace-nowrap shrink-0 text-muted hover:text-text"
        >
          Job History
        </Link>
      )}
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

function ConnectionsTab({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
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

  const [tests, setTests] = useState<Record<string, ServiceTestState>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const queryClient = useQueryClient()

  const { data: spotifyStatus } = useQuery({
    queryKey: ['spotify-oauth-status'],
    queryFn: () => getOAuthStatus('spotify'),
  })
  const spotifyConnected = spotifyStatus?.connected ?? false

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

  function createTester(
    key: string,
    label: string,
    testFn: () => Promise<{ success: boolean; message?: string }>,
  ) {
    return async () => {
      setTest(key, 'testing')
      try {
        const res = await testFn()
        setTest(key, res.success ? 'ok' : 'error')
        if (res.success) toast.success(`${label} connected`)
        else toast.error(res.message || `${label} connection failed`)
      } catch {
        setTest(key, 'error')
        toast.error(`Could not reach ${label}`)
      }
    }
  }

  function createSaver(key: string, label: string, saveFn: () => Promise<unknown>) {
    return async () => {
      setSave(key, true)
      try {
        await saveFn()
        toast.success(`${label} settings saved`)
        onSaved()
      } catch {
        toast.error(`Failed to save ${label} settings`)
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
      toast.success('Webhook saved')
      onSaved()
    } catch {
      toast.error('Failed to save webhook')
    } finally {
      setSavingWebhook(false)
    }
  }

  async function handleTestWebhook() {
    setTestingWebhook(true)
    try {
      const res = await testWebhook()
      if (res.success) toast.success('Test notification sent')
      else toast.error(res.message || 'Webhook test failed')
    } catch {
      toast.error('Failed to send test notification')
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

  const testAi = createTester('ai', 'AI provider', () => {
    const config: Record<string, string> = { provider: aiProvider, model: aiModel }
    if (aiProvider !== 'ollama' && aiProvider !== 'openai-compatible') config.apiKey = aiApiKey
    if (aiProvider === 'openai-compatible' && aiApiKey) config.apiKey = aiApiKey
    if (aiProvider === 'ollama' || aiProvider === 'openai-compatible') config.baseUrl = aiBaseUrl
    return testService('ai', config)
  })
  const saveAi = createSaver('ai', 'AI', () =>
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
        redirectUri: `${window.location.origin}/api/auth/oauth/spotify/callback`,
      })
      window.location.href = res.authUrl
    } catch {
      toast.error('Failed to start Spotify authorization')
    }
  }

  async function disconnectSpotify() {
    try {
      await disconnectOAuth('spotify')
      queryClient.invalidateQueries({ queryKey: ['spotify-oauth-status'] })
      toast.success('Spotify disconnected')
    } catch {
      toast.error('Failed to disconnect Spotify')
    }
  }

  async function startSpotifyLikedSongsImport() {
    setImportingSpotifyLikes(true)
    try {
      const res = await importSpotifyLikedSongs()
      toast.success(res.created ? 'Spotify Liked Songs import started' : 'Import started again')
    } catch {
      toast.error('Failed to start Spotify Liked Songs import')
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
        res.created ? 'Playlist import started' : 'Import started again for this playlist',
      )
      setPlaylistIdInput('')
    } catch {
      toast.error('Failed to start playlist import')
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
        <h3 className="text-sm font-semibold text-text uppercase tracking-wide">Global Settings</h3>
        {!isAdmin && (
          <p className="text-xs text-muted mt-1">Only admins can modify global settings.</p>
        )}
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
              <span className="text-sm font-medium text-text">AI Provider</span>
              <span className="text-xs text-muted">
                {settings.aiProvider as string} / {settings.aiModel as string}
              </span>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Lidarr */}
          <div className={isLidarrConfigured ? '' : 'opacity-60'}>
            <ServiceCard
              name="Lidarr"
              description={
                <span>
                  Music library manager -- required for adding artists.{' '}
                  <a
                    href="https://wiki.servarr.com/lidarr/settings#security"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    Get API key
                  </a>
                </span>
              }
              status={serviceStatus('lidarr')}
              icon={<LidarrIcon />}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="URL" id="lidarr-url">
                  <Input
                    id="lidarr-url"
                    type="url"
                    placeholder="http://localhost:8686"
                    value={lidarrUrl}
                    onChange={(e) => setLidarrUrl(e.target.value)}
                  />
                </Field>
                <Field label="API Key" id="lidarr-apikey">
                  <Input
                    id="lidarr-apikey"
                    type="password"
                    placeholder={
                      settings.lidarrApiKey === '***' ? '(saved)' : 'Your Lidarr API key'
                    }
                    value={lidarrApiKey}
                    onChange={(e) => setLidarrApiKey(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Public URL (optional)" id="lidarr-public-url">
                <Input
                  id="lidarr-public-url"
                  type="url"
                  placeholder="https://lidarr.example.com"
                  value={lidarrPublicUrl}
                  onChange={(e) => setLidarrPublicUrl(e.target.value)}
                />
                <p className="text-xs text-muted mt-1">
                  Browser-accessible URL for linking to Lidarr artist pages. Leave empty if the API
                  URL is already reachable from your browser.
                </p>
              </Field>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={testLidarr}
                  disabled={tests.lidarr === 'testing'}
                >
                  {tests.lidarr === 'testing' ? 'Testing...' : 'Test Connection'}
                </Button>
                <Button size="sm" onClick={saveLidarr} disabled={saving.lidarr}>
                  {saving.lidarr ? 'Saving...' : isLidarrConfigured ? 'Save' : 'Configure'}
                </Button>
              </div>
            </ServiceCard>
          </div>

          {/* AI Provider */}
          <Hint id="settings-ai-tip" type="inline">
            Choose an AI provider to power recommendations. Ollama runs locally for free. Cloud
            providers (Claude, GPT, Gemini) need API keys.
          </Hint>
          <div className={isAiConfigured ? '' : 'opacity-60'}>
            <ServiceCard
              name="AI Provider"
              description={
                <span>
                  Generates music recommendations.{' '}
                  {aiProvider === 'anthropic' && (
                    <a
                      href="https://console.anthropic.com/settings/keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      Get API key
                    </a>
                  )}
                  {aiProvider === 'openai' && (
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      Get API key
                    </a>
                  )}
                  {aiProvider === 'gemini' && (
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      Get API key
                    </a>
                  )}
                  {aiProvider === 'ollama' && (
                    <a
                      href="https://ollama.com/library"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      Browse models
                    </a>
                  )}
                </span>
              }
              status={serviceStatus('ai')}
              icon={<AiProviderIcon provider={aiProvider} />}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Provider" id="ai-provider">
                  <Select
                    id="ai-provider"
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value)}
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="ollama">Ollama (local)</option>
                    <option value="openai-compatible">OpenAI-Compatible</option>
                  </Select>
                </Field>
                <Field label="Model" id="ai-model">
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
                              ? 'your-model-name'
                              : 'llama4'
                    }
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                  />
                </Field>
              </div>
              {aiProvider !== 'ollama' && (
                <Field
                  label={aiProvider === 'openai-compatible' ? 'API Key (optional)' : 'API Key'}
                  id="ai-apikey"
                >
                  <Input
                    id="ai-apikey"
                    type="password"
                    placeholder={settings.aiApiKey === '***' ? '(saved)' : 'API key'}
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                  />
                </Field>
              )}
              {(aiProvider === 'ollama' || aiProvider === 'openai-compatible') && (
                <Field label="Base URL" id="ai-baseurl">
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
                <p className="text-xs text-muted">
                  Works with Groq, OpenRouter, LiteLLM, LocalAI, and any OpenAI-compatible endpoint.
                  API key is optional for local services.
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={testAi}
                  disabled={tests.ai === 'testing'}
                >
                  {tests.ai === 'testing' ? 'Testing...' : 'Test Connection'}
                </Button>
                <Button size="sm" onClick={saveAi} disabled={saving.ai}>
                  {saving.ai ? 'Saving...' : isAiConfigured ? 'Save' : 'Configure'}
                </Button>
              </div>
            </ServiceCard>
          </div>

          {/* Webhook */}
          <ServiceCard
            name="Webhook"
            description="Scan completion notifications (Discord, Slack, ntfy, Gotify, or any HTTP endpoint)"
            status={webhookUrl ? 'connected' : 'not_configured'}
            icon={<WebhookIcon />}
          >
            <Field label="Webhook URL" id="webhook-url">
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
                {testingWebhook ? 'Sending...' : 'Test Webhook'}
              </Button>
              <Button size="sm" onClick={handleSaveWebhook} disabled={savingWebhook}>
                {savingWebhook ? 'Saving...' : webhookUrl ? 'Save' : 'Configure'}
              </Button>
            </div>
          </ServiceCard>
        </>
      )}

      <div className="pt-2">
        <h3 className="text-sm font-semibold text-text uppercase tracking-wide">
          Your Connections
        </h3>
        <p className="text-xs text-muted mt-1">
          Personal listening sources linked to your account.
        </p>
      </div>

      <Hint id="settings-connections-tip" type="inline">
        Connect your listening sources first -- ListenBrainz, Last.fm, Spotify, or Plex. The
        pipeline uses your listening history to find similar artists.
      </Hint>

      {/* ListenBrainz */}
      <div className={isLbConfigured ? '' : 'opacity-60'}>
        <ServiceCard
          name="ListenBrainz"
          description={
            <span>
              Open-source listening history tracking.{' '}
              <a
                href="https://listenbrainz.org/settings/"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Get token
              </a>
              {settings._listenbrainzScope === 'user' && (
                <span className="text-xs text-accent ml-2">your account</span>
              )}
            </span>
          }
          status={serviceStatus('listenbrainz')}
          icon={<ListenBrainzIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Username" id="lb-username">
              <Input
                id="lb-username"
                placeholder="your-username"
                value={lbUsername}
                onChange={(e) => setLbUsername(e.target.value)}
              />
            </Field>
            <Field label="User Token" id="lb-token">
              <Input
                id="lb-token"
                type="password"
                placeholder={
                  settings.listenbrainzToken === '***' ? '(saved)' : 'ListenBrainz token'
                }
                value={lbToken}
                onChange={(e) => setLbToken(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={testListenbrainz}
              disabled={tests.listenbrainz === 'testing'}
            >
              {tests.listenbrainz === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" onClick={saveListenbrainz} disabled={saving.listenbrainz}>
              {saving.listenbrainz ? 'Saving...' : isLbConfigured ? 'Save' : 'Configure'}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Last.fm */}
      <div className={isLfConfigured ? '' : 'opacity-60'}>
        <ServiceCard
          name="Last.fm"
          description={
            <span>
              Music scrobbling and listening history.{' '}
              <a
                href="https://www.last.fm/api/account/create"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Get API key
              </a>
              {settings._lastfmScope === 'user' && (
                <span className="text-xs text-accent ml-2">your account</span>
              )}
            </span>
          }
          status={serviceStatus('lastfm')}
          icon={<LastfmIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Username" id="lfm-username">
              <Input
                id="lfm-username"
                placeholder="your-username"
                value={lfUsername}
                onChange={(e) => setLfUsername(e.target.value)}
              />
            </Field>
            <Field label="API Key" id="lfm-apikey">
              <Input
                id="lfm-apikey"
                type="password"
                placeholder={settings.lastfmApiKey === '***' ? '(saved)' : 'Last.fm API key'}
                value={lfApiKey}
                onChange={(e) => setLfApiKey(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={testLastfm}
              disabled={tests.lastfm === 'testing'}
            >
              {tests.lastfm === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" onClick={saveLastfm} disabled={saving.lastfm}>
              {saving.lastfm ? 'Saving...' : isLfConfigured ? 'Save' : 'Configure'}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Spotify */}
      <div className={spotifyConnected ? '' : 'opacity-60'}>
        <ServiceCard
          name="Spotify"
          description={
            <span>
              Listening history from Spotify.{' '}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Create a Spotify Developer App
              </a>
            </span>
          }
          status={spotifyConnected ? 'connected' : 'not_configured'}
          icon={<SpotifyIcon />}
        >
          {spotifyConnected ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Import artists from your Spotify account to seed your recommendations.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={startSpotifyLikedSongsImport}
                  disabled={importingSpotifyLikes}
                >
                  {importingSpotifyLikes ? 'Importing...' : 'Import Liked Songs'}
                </Button>
                <Button size="sm" variant="outline" onClick={disconnectSpotify}>
                  Disconnect
                </Button>
              </div>
              <div className="flex gap-1.5 pt-1">
                <input
                  type="text"
                  value={playlistIdInput}
                  onChange={(e) => setPlaylistIdInput(e.target.value)}
                  placeholder="Playlist URL or ID"
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
                  {importingPlaylist ? 'Importing...' : 'Import Playlist'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Client ID" id="spotify-client-id">
                  <Input
                    id="spotify-client-id"
                    placeholder="Your Spotify app client ID"
                    value={spotifyClientId}
                    onChange={(e) => setSpotifyClientId(e.target.value)}
                  />
                </Field>
                <Field label="Client Secret" id="spotify-client-secret">
                  <Input
                    id="spotify-client-secret"
                    type="password"
                    placeholder="Your Spotify app client secret"
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
                  Connect with Spotify
                </Button>
              </div>
            </>
          )}
        </ServiceCard>
      </div>

      {/* Plex */}
      <div className={isPlexConfigured ? '' : 'opacity-60'}>
        <ServiceCard
          name="Plex"
          description="Media server with listening history"
          status={serviceStatus('plex')}
          icon={<PlexIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Server URL" id="plex-url">
              <Input
                id="plex-url"
                type="url"
                placeholder="http://localhost:32400"
                value={plexUrl}
                onChange={(e) => setPlexUrl(e.target.value)}
              />
            </Field>
            <Field label="Plex Token" id="plex-token">
              <Input
                id="plex-token"
                type="password"
                placeholder={settings.plexToken === '***' ? '(saved)' : 'Your Plex token'}
                value={plexToken}
                onChange={(e) => setPlexToken(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={testPlex}
              disabled={tests.plex === 'testing'}
            >
              {tests.plex === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" onClick={savePlex} disabled={saving.plex}>
              {saving.plex ? 'Saving...' : isPlexConfigured ? 'Save' : 'Configure'}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Jellyfin */}
      <div className={isJellyfinConfigured ? '' : 'opacity-60'}>
        <ServiceCard
          name="Jellyfin"
          description="Open-source media server with listening history"
          status={serviceStatus('jellyfin')}
          icon={<JellyfinIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Server URL" id="jellyfin-url">
              <Input
                id="jellyfin-url"
                type="url"
                placeholder="http://localhost:8096"
                value={jellyfinUrl}
                onChange={(e) => setJellyfinUrl(e.target.value)}
              />
            </Field>
            <Field label="API Key" id="jellyfin-apikey">
              <Input
                id="jellyfin-apikey"
                type="password"
                placeholder={settings.jellyfinApiKey === '***' ? '(saved)' : 'Jellyfin API key'}
                value={jellyfinApiKey}
                onChange={(e) => setJellyfinApiKey(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Username or User ID" id="jellyfin-userid">
            <Input
              id="jellyfin-userid"
              placeholder="e.g. admin"
              value={jellyfinUserId}
              onChange={(e) => setJellyfinUserId(e.target.value)}
            />
            <p className="text-xs text-muted mt-1">
              Your Jellyfin username (recommended) or UUID. The username is resolved automatically
              via the Jellyfin API.
            </p>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={testJellyfin}
              disabled={tests.jellyfin === 'testing'}
            >
              {tests.jellyfin === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" onClick={saveJellyfin} disabled={saving.jellyfin}>
              {saving.jellyfin ? 'Saving...' : isJellyfinConfigured ? 'Save' : 'Configure'}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Emby */}
      <div className={isEmbyConfigured ? '' : 'opacity-60'}>
        <ServiceCard
          name="Emby"
          description="Media server with listening history and playlist export"
          status={serviceStatus('emby')}
          icon={
            <span className="w-5 h-5 rounded bg-accent/20 text-accent text-micro font-bold flex items-center justify-center">
              E
            </span>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Server URL" id="emby-url">
              <Input
                id="emby-url"
                type="url"
                placeholder="http://localhost:8096"
                value={embyUrl}
                onChange={(e) => setEmbyUrl(e.target.value)}
              />
            </Field>
            <Field label="API Key" id="emby-apikey">
              <Input
                id="emby-apikey"
                type="password"
                placeholder={settings.embyApiKey === '***' ? '(saved)' : 'Emby API key'}
                value={embyApiKey}
                onChange={(e) => setEmbyApiKey(e.target.value)}
              />
            </Field>
          </div>
          <Field label="User ID" id="emby-userid">
            <Input
              id="emby-userid"
              placeholder="Emby user ID"
              value={embyUserId}
              onChange={(e) => setEmbyUserId(e.target.value)}
            />
            <p className="text-xs text-muted mt-1">
              Found under Emby Dashboard -&gt; Users -&gt; (select user). The URL contains the user
              ID.
            </p>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={testEmby}
              disabled={tests.emby === 'testing'}
            >
              {tests.emby === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" onClick={saveEmby} disabled={saving.emby}>
              {saving.emby ? 'Saving...' : isEmbyConfigured ? 'Save' : 'Configure'}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Discogs */}
      <div className={isDiscogsConfigured ? '' : 'opacity-60'}>
        <ServiceCard
          name="Discogs"
          description={
            <span>
              Collection and wantlist from Discogs.{' '}
              <a
                href="https://www.discogs.com/settings/developers"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Get personal access token
              </a>
            </span>
          }
          status={serviceStatus('discogs')}
          icon={<DiscogsIcon />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Username" id="discogs-username">
              <Input
                id="discogs-username"
                placeholder="your-discogs-username"
                value={discogsUsername}
                onChange={(e) => setDiscogsUsername(e.target.value)}
              />
            </Field>
            <Field label="Personal Access Token" id="discogs-token">
              <Input
                id="discogs-token"
                type="password"
                placeholder={settings.discogsToken === '***' ? '(saved)' : 'Discogs token'}
                value={discogsToken}
                onChange={(e) => setDiscogsToken(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={testDiscogs}
              disabled={tests.discogs === 'testing'}
            >
              {tests.discogs === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button size="sm" onClick={saveDiscogs} disabled={saving.discogs}>
              {saving.discogs ? 'Saving...' : isDiscogsConfigured ? 'Save' : 'Configure'}
            </Button>
          </div>
        </ServiceCard>
      </div>

      {/* Lidarr Preferences -- per-user, visible to all */}
      {settings.lidarrUrl && <LidarrPreferencesSection />}
    </div>
  )
}

function LidarrPreferencesSection() {
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
      toast.success('Lidarr preferences saved')
    } catch {
      toast.error('Failed to save Lidarr preferences')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="pt-2 mb-4">
        <h3 className="text-sm font-semibold text-text uppercase tracking-wide">
          Your Lidarr Preferences
        </h3>
        <p className="text-xs text-muted mt-1">
          Defaults used when you approve recommendations into Lidarr. Each user can set their own.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Quality Profile" id="user-quality-profile">
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
                <option value={qualityProfileId}>Loading...</option>
              )}
            </Select>
          </Field>
          <Field label="Metadata Profile" id="user-metadata-profile">
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
                <option value={metadataProfileId}>Loading...</option>
              )}
            </Select>
          </Field>
          <Field label="Root Folder" id="user-root-folder">
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
                <option value={rootFolderId}>Loading...</option>
              )}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

const TARGET_TYPES = [
  {
    value: 'lidarr',
    label: 'Lidarr',
    fields: [
      { key: 'url', label: 'URL', placeholder: 'http://lidarr:8686' },
      { key: 'apiKey', label: 'API Key', placeholder: 'Enter API key', type: 'password' as const },
    ],
  },
  {
    value: 'emby-playlist',
    label: 'Emby Playlist',
    fields: [
      { key: 'url', label: 'URL', placeholder: 'http://emby:8096' },
      { key: 'apiKey', label: 'API Key', placeholder: 'Enter API key', type: 'password' as const },
      { key: 'userId', label: 'User ID', placeholder: 'Enter Emby user ID' },
    ],
  },
]

function TargetTypeIcon({ type }: { type: string }) {
  const iconMap: Record<string, string> = {
    lidarr: '/icons/lidarr.png',
    jellyfin: '/icons/jellyfin.svg',
    'spotify-playlist': '/icons/spotify.svg',
  }
  const src = iconMap[type]
  if (src) return <img src={src} alt="" className="w-5 h-5" />
  return (
    <span className="w-5 h-5 rounded bg-accent/20 text-accent text-micro font-bold flex items-center justify-center uppercase">
      {type.charAt(0)}
    </span>
  )
}

function AddTargetDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState('')
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const selectedType = TARGET_TYPES.find((t) => t.value === type)

  async function handleSave() {
    if (!type || !selectedType) return
    setSaving(true)
    try {
      await createTargetApi({
        type,
        name: name || selectedType.label,
        config,
      })
      toast.success('Target added')
      onCreated()
      onClose()
    } catch {
      toast.error('Failed to add target')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      <h4 className="text-sm font-medium text-text">Add Target</h4>

      <div>
        <label className="block text-xs text-muted mb-1">
          Type
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value)
              setConfig({})
            }}
            className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
          >
            <option value="">Select a target type...</option>
            {TARGET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedType && (
        <>
          <div>
            <label className="block text-xs text-muted mb-1">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={selectedType.label}
                className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
              />
            </label>
          </div>

          {selectedType.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs text-muted mb-1">
                {field.label}
                <input
                  type={'type' in field ? field.type : 'text'}
                  value={config[field.key] ?? ''}
                  onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="mt-1 w-full rounded-md border border-border bg-bg text-text text-sm px-3 py-2"
                />
              </label>
            </div>
          ))}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !type}>
              {saving ? 'Adding...' : 'Add Target'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function TargetsTab() {
  const { data: targets, refetch } = useQuery({
    queryKey: ['targets'],
    queryFn: listTargets,
  })
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const isAdmin = currentUser?.isAdmin ?? false
  const [testing, setTesting] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  async function handleTest(id: number) {
    setTesting(id)
    try {
      const result = await testTargetApi(id)
      if (result.success) {
        toast.success('Target connection successful')
      } else {
        toast.error(result.message || 'Connection failed')
      }
    } catch {
      toast.error('Failed to test connection')
    } finally {
      setTesting(null)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteTargetApi(id)
      toast.success('Target removed')
      refetch()
    } catch {
      toast.error('Failed to remove target')
    }
  }

  return (
    <div className="space-y-4">
      <Hint id="settings-targets-tip" type="inline">
        Targets define where approved recommendations go -- Lidarr for downloads, Spotify for
        playlists, or media servers for direct playback.
      </Hint>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Targets</h3>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setAddOpen(!addOpen)}>
            {addOpen ? 'Cancel' : 'Add Target'}
          </Button>
        )}
      </div>

      {addOpen && <AddTargetDialog onClose={() => setAddOpen(false)} onCreated={() => refetch()} />}

      {!addOpen && targets?.length === 0 && (
        <p className="text-sm text-muted">
          No targets configured. Approved recommendations will be saved as a curated list.
        </p>
      )}

      {targets?.map((t) => {
        const owned = t.owned
        return (
          <div key={t.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TargetTypeIcon type={t.type} />
                <span className="text-sm font-medium text-text">{t.name}</span>
                <span className="text-xs text-muted capitalize">({t.type})</span>
                {!owned && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-bg text-muted border border-border">
                    shared
                  </span>
                )}
              </div>
              {owned && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(t.id)}
                    disabled={testing === t.id}
                  >
                    {testing === t.id ? 'Testing...' : 'Test'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(t.id)}
                    className="text-reject"
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>
            {typeof t.config.url === 'string' && (
              <p className="text-xs text-muted mt-1">{t.config.url}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RecommendationsTab() {
  const queryClient = useQueryClient()
  const { data: prefs, isLoading: prefsLoading } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: getUserPreferences,
  })

  if (prefsLoading || !prefs) {
    return <div className="text-sm text-muted">Loading preferences...</div>
  }

  return <RecommendationsTabInner prefs={prefs} queryClient={queryClient} />
}

function RecommendationsTabInner({
  prefs,
  queryClient,
}: {
  prefs: Record<string, unknown>
  queryClient: ReturnType<typeof useQueryClient>
}) {
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
      queryClient.invalidateQueries({ queryKey: ['user-preferences'] })
      toast.success('Recommendation settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      <Hint id="settings-recommendations-tip" type="inline">
        Scoring weights control how recommendations are ranked. Tweak these to emphasize genre
        overlap, AI confidence, or similarity.
      </Hint>

      {/* Essential -- always visible */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Score Threshold</h2>
        <SliderField
          label="Minimum score to show recommendation"
          id="score-threshold"
          value={scoreThreshold}
          min={0}
          max={1}
          step={0.05}
          onChange={setScoreThreshold}
        />
      </section>

      {/* Tuning -- collapsed by default */}
      <CollapsibleSection title="Scoring Weights">
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-3">
            <span
              className={`text-xs tabular-nums ${weightsOk ? 'text-muted' : 'text-yellow-400'}`}
            >
              total: {weightSum.toFixed(2)}
              {weightsOk ? '' : ' (should sum to 1.0)'}
            </span>
          </div>
          <SliderField
            label="Consensus"
            id="w-consensus"
            value={consensus}
            min={0}
            max={1}
            step={0.05}
            onChange={setConsensus}
          />
          <SliderField
            label="Similarity"
            id="w-similarity"
            value={similarity}
            min={0}
            max={1}
            step={0.05}
            onChange={setSimilarity}
          />
          <SliderField
            label="Genre Overlap"
            id="w-genre"
            value={genreOverlap}
            min={0}
            max={1}
            step={0.05}
            onChange={setGenreOverlap}
          />
          <SliderField
            label="AI Confidence"
            id="w-ai"
            value={aiConfidence}
            min={0}
            max={1}
            step={0.05}
            onChange={setAiConfidence}
          />
          <SliderField
            label="Feedback Boost"
            id="w-feedback"
            value={feedbackBoost}
            min={0}
            max={1}
            step={0.05}
            onChange={setFeedbackBoost}
          />
          <SliderField
            label="Popularity"
            id="w-popularity"
            value={popularity}
            min={0}
            max={1}
            step={0.05}
            onChange={setPopularity}
          />
          <p className="text-xs text-muted">
            0 = ignore popularity, higher = prefer popular artists. Requires artist metadata import.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Auto-Approve">
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted">
            Automatically add high-scoring recommendations to your targets after each scan. Only
            runs when targets are configured.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoApproveEnabled}
              onChange={(e) => setAutoApproveEnabled(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-sm text-text">Enable auto-approve</span>
          </label>
          {autoApproveEnabled && (
            <div className="space-y-3 pl-6">
              <SliderField
                label="Minimum score"
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
                  Monitor mode
                </label>
                <select
                  id="auto-approve-monitor"
                  value={autoApproveMonitorOption}
                  onChange={(e) => setAutoApproveMonitorOption(e.target.value)}
                  className="mt-1 w-full bg-bg border border-border rounded text-sm text-text px-2 py-1.5"
                >
                  <option value="all">All albums</option>
                  <option value="new">Future releases only</option>
                  <option value="none">None (tracking only)</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Advanced -- collapsed by default */}
      <CollapsibleSection title="Advanced">
        <div className="space-y-6 pt-2">
          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">Limits</h3>
            <Field label="Rejection cooldown (days)" id="rejection-cooldown">
              <Input
                id="rejection-cooldown"
                type="number"
                min={1}
                value={rejectionCooldown}
                onChange={(e) => setRejectionCooldown(e.target.value)}
                className="max-w-[120px]"
              />
            </Field>
            <Field label="Top artists limit" id="top-artists-limit">
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
              Library Discovery
            </h3>
            <p className="text-xs text-muted">
              How much of the discovery should be seeded from your existing Lidarr library vs
              listening history. Higher values find artists similar to what you already own. Lower
              values rely more on ListenBrainz/Last.fm listening data.
            </p>
            <SliderField
              label="Library seed ratio"
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
              Image Sources
            </h3>
            <p className="text-xs text-muted">
              Artist images come from Lidarr/SkyHook by default. A fanart.tv API key enables a
              fallback when SkyHook is down.
            </p>
            <Field label="Fanart.tv API key (optional)" id="fanart-api-key">
              <Input
                id="fanart-api-key"
                type="password"
                value={fanartApiKey}
                onChange={(e) => setFanartApiKey(e.target.value)}
                placeholder="Personal API key from fanart.tv"
              />
            </Field>
            <Field label="Metadata fallback URL (optional)" id="metadata-fallback-url">
              <Input
                id="metadata-fallback-url"
                value={metadataFallbackUrl}
                onChange={(e) => setMetadataFallbackUrl(e.target.value)}
                placeholder="https://api.musicinfo.pro"
              />
            </Field>
            <p className="text-micro text-muted">
              Used when Lidarr's metadata server is down. Defaults to api.musicinfo.pro. Set to your
              own hearring-aid instance URL if self-hosting.
            </p>
          </section>
        </div>
      </CollapsibleSection>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
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
  const prefs = settings.preferences ?? {}
  const [cron, setCron] = useState(prefs.scheduleCron ?? '0 0 * * *')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await updateSettings({ preferences: { ...prefs, scheduleCron: cron } })
      toast.success('Schedule saved')
    } catch {
      toast.error('Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Hint id="settings-schedule-tip" type="inline">
        Set a cron schedule to run the discovery pipeline automatically. Weekly on Monday is a
        popular choice.
      </Hint>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Presets</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              variant={cron === p.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCron(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Custom Cron</h2>
        <Field label="Cron expression" id="cron-expr">
          <Input
            id="cron-expr"
            placeholder="0 0 * * *"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            className="font-mono"
          />
        </Field>
      </section>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </Button>
    </div>
  )
}

function AccountTab() {
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
      toast.error('New passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setSaving(true)
    try {
      const res = await changePassword(currentPassword, newPassword)
      // Server invalidated old sessions and issued a new token
      if (res.token) setStoredToken(res.token)
      toast.success('Password changed')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      const msg = errMsg(err)
      toast.error(
        msg.includes('401') || msg.includes('403') ? 'Current password is incorrect' : msg,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Profile</h2>
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted">
            Signed in as <span className="text-text font-medium">{user?.username ?? '...'}</span>
            {user?.isAdmin && (
              <span className="ml-2 text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                admin
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">Change Password</h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <Field label="Current password" id="current-pw">
            <Input
              id="current-pw"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="New password" id="new-pw">
            <Input
              id="new-pw"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Min 8 characters"
            />
          </Field>
          <Field label="Confirm new password" id="confirm-pw">
            <Input
              id="confirm-pw"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Button type="submit" disabled={saving}>
            {saving ? 'Changing...' : 'Change Password'}
          </Button>
        </form>
      </section>

      {(canInstall || showIosHint) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">App</h2>
          <div className="flex items-center justify-between p-3 bg-surface border border-border rounded-lg">
            <div>
              <p className="text-sm font-medium text-text">Install Digarr</p>
              {showIosHint ? (
                <p className="text-xs text-muted mt-0.5">
                  Tap the share button, then "Add to Home Screen"
                </p>
              ) : (
                <p className="text-xs text-muted mt-0.5">
                  Add to your home screen for quick access
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="text-xs text-muted hover:text-text transition-colors"
              >
                Dismiss
              </button>
              {canInstall && (
                <button
                  type="button"
                  onClick={promptInstall}
                  className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-fg rounded hover:bg-accent/90 transition-colors"
                >
                  Install
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
  const [oidcIssuerUrl, setOidcIssuerUrl] = useState(settings.oidcIssuerUrl ?? '')
  const [oidcClientId, setOidcClientId] = useState(settings.oidcClientId ?? '')
  const [oidcClientSecret, setOidcClientSecret] = useState(
    settings.oidcClientSecret === '***' ? '' : (settings.oidcClientSecret ?? ''),
  )
  const [secretDirty, setSecretDirty] = useState(false)
  const [oidcScopes, setOidcScopes] = useState(settings.oidcScopes ?? '')
  const [saving, setSaving] = useState(false)
  const [testingOidc, setTestingOidc] = useState(false)

  const { data: authStatus } = useQuery({
    queryKey: ['authStatus'],
    queryFn: getAuthStatus,
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
      toast.success('Authentication settings saved')
      onSaved()
    } catch {
      toast.error('Failed to save authentication settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleTestOidc() {
    setTestingOidc(true)
    try {
      const res = await testService('oidc', {
        issuerUrl: oidcIssuerUrl,
        clientId: oidcClientId,
        clientSecret: oidcClientSecret || undefined,
      })
      if (res.success) toast.success('OIDC discovery successful')
      else toast.error(res.message || 'OIDC connection failed')
    } catch {
      toast.error('Could not reach OIDC issuer')
    } finally {
      setTestingOidc(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Hint id="settings-auth-tip" type="inline">
        Configure OIDC/SSO to let users sign in with Authentik, Authelia, or any OpenID Connect
        provider.
      </Hint>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">OIDC / SSO</h2>
          <p className="text-xs text-muted mt-1">
            Configure OpenID Connect for single sign-on. After saving, users will see a "Sign in
            with SSO" button on the login page.
          </p>
        </div>
        <Field label="Issuer URL" id="oidc-issuer-url">
          <Input
            id="oidc-issuer-url"
            type="url"
            placeholder="https://auth.example.com"
            value={oidcIssuerUrl}
            onChange={(e) => setOidcIssuerUrl(e.target.value)}
          />
        </Field>
        <Field label="Client ID" id="oidc-client-id">
          <Input
            id="oidc-client-id"
            placeholder="your-client-id"
            value={oidcClientId}
            onChange={(e) => setOidcClientId(e.target.value)}
          />
        </Field>
        <Field label="Client Secret" id="oidc-client-secret">
          <Input
            id="oidc-client-secret"
            type="password"
            placeholder={settings.oidcClientSecret === '***' ? '(saved)' : 'your-client-secret'}
            value={oidcClientSecret}
            onChange={(e) => {
              setOidcClientSecret(e.target.value)
              setSecretDirty(true)
            }}
          />
        </Field>
        <Field label="Scopes" id="oidc-scopes">
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
            {testingOidc ? 'Testing...' : 'Test Connection'}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
            Reverse Proxy Auth
          </h2>
          <p className="text-xs text-muted mt-1">
            When enabled, Digarr trusts an HTTP header from a configured reverse proxy and
            auto-provisions users from it. Controlled via environment variables (
            <code className="font-mono text-xs">PROXY_AUTH_ENABLED</code>,{' '}
            <code className="font-mono text-xs">PROXY_AUTH_HEADER</code>,{' '}
            <code className="font-mono text-xs">PROXY_TRUSTED_IPS</code>).
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 text-sm">
          {authStatus?.proxyAuthEnabled ? (
            <span className="text-text">
              Proxy authentication is <strong>enabled</strong>. Users are auto-provisioned from the
              configured header.
            </span>
          ) : (
            <span className="text-muted">
              Proxy authentication is <strong>disabled</strong>. Set{' '}
              <code className="font-mono text-xs">PROXY_AUTH_ENABLED=true</code> in your environment
              to enable it.
            </span>
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
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
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

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-text mb-6">Settings</h1>
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
      <h1 className="text-2xl font-bold text-text mb-6">Settings</h1>
      <TabBar active={tab} onChange={setTab} isAdmin={isAdmin} />
      {tab === 'connections' && <ConnectionsTab settings={data} onSaved={refetch} />}
      {tab === 'targets' && <TargetsTab />}
      {tab === 'recommendations' && <RecommendationsTab />}
      {tab === 'schedule' && <ScheduleTab settings={data} />}
      {tab === 'account' && <AccountTab />}
      {tab === 'auth' && <AuthTab settings={data} onSaved={refetch} />}
      {tab === 'users' && <UserManagementPage />}
      {tab === 'administration' && <AdministrationTab />}
    </div>
  )
}
