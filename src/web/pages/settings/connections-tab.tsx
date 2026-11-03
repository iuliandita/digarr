import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Plus, Waves } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { MessageKey } from '@/core/i18n/messages/types'
import { DashboardCardToggle } from '../../components/dashboard-card-toggle'
import { Field } from '../../components/field'
import { GenreCoverageSummary } from '../../components/genre-coverage-summary'
import { Hint } from '../../components/hint'
import { IntegrationCapabilities } from '../../components/integration-capabilities'
import {
  LastfmWriteBack,
  ListenBrainzWriteBack,
} from '../../components/scrobbler-write-back-settings'
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
  WebhookIcon,
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
import { ArtistImagesCard } from './artist-images-card'
import { type ConnectionChoice, ConnectionPicker } from './connection-picker'
import { LidarrPreferencesSection } from './lidarr-preferences'
import { NotificationChannelsCard } from './notification-channels'
import { MediaServerCard, ServiceFormFooter } from './service-form'
import { isLocalAiProvider, savedSecretPlaceholder, unmaskSecret } from './shared'
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [savedOverrides, setSavedOverrides] = useState<Record<string, boolean>>({})
  const addButton = useRef<HTMLButtonElement>(null)
  const formRef = useRef<HTMLFieldSetElement>(null)
  const [focusSaved, setFocusSaved] = useState<string | null>(null)
  const experimental = prefs.showExperimentalIntegrations ?? false
  useEffect(() => {
    if (!selected) return
    if (selected === 'notifications')
      formRef.current?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click()
    const timer = setTimeout(
      () =>
        (
          formRef.current?.querySelector<HTMLElement>('input, select') ??
          formRef.current?.querySelector<HTMLElement>('button')
        )?.focus(),
      0,
    )
    return () => clearTimeout(timer)
  }, [selected])
  useEffect(() => {
    if (!focusSaved) return
    const target = document.querySelector<HTMLElement>(`[data-connection="${focusSaved}"] button`)
    ;(target ?? addButton.current)?.focus()
    setFocusSaved(null)
  }, [focusSaved])
  function closePicker() {
    setPickerOpen(false)
    setSelected(null)
    addButton.current?.focus()
  }

  const [audiomuseUrl, setAudiomuseUrl] = useState(prefs.audiomuseUrl ?? '')
  const [audiomuseToken, setAudiomuseToken] = useState(prefs.audiomuseToken ?? '')
  const [audiomuseSkipTlsVerify, setAudiomuseSkipTlsVerify] = useState(
    prefs.audiomuseSkipTlsVerify ?? false,
  )
  const [lidarrUrl, setLidarrUrl] = useState(settings.lidarrUrl ?? '')
  const [lidarrPublicUrl, setLidarrPublicUrl] = useState(prefs.lidarrPublicUrl ?? '')
  const [lidarrRequireFiles, setLidarrRequireFiles] = useState(prefs.lidarrRequireFiles !== false)
  const [lidarrApiKey, setLidarrApiKey] = useState(unmaskSecret(settings.lidarrApiKey))
  const [lbUsername, setLbUsername] = useState(settings.listenbrainzUsername ?? '')
  const [lbToken, setLbToken] = useState(unmaskSecret(settings.listenbrainzToken))
  const [lfUsername, setLfUsername] = useState(settings.lastfmUsername ?? '')
  const [lfApiKey, setLfApiKey] = useState(unmaskSecret(settings.lastfmApiKey))
  const [aiProvider, setAiProvider] = useState<string>(settings.aiProvider ?? 'anthropic')
  const [aiModel, setAiModel] = useState(settings.aiModel ?? '')
  const [aiApiKey, setAiApiKey] = useState(unmaskSecret(settings.aiApiKey))
  const [aiBaseUrl, setAiBaseUrl] = useState(settings.aiBaseUrl ?? '')
  const [tidalClientId, setTidalClientId] = useState(settings.tidalClientId ?? '')
  const [tidalClientSecret, setTidalClientSecret] = useState(
    unmaskSecret(settings.tidalClientSecret),
  )
  const [plexUrl, setPlexUrl] = useState(settings.plexUrl ?? '')
  const [plexToken, setPlexToken] = useState(unmaskSecret(settings.plexToken))
  const [plexSectionId, setPlexSectionId] = useState(settings.plexSectionId ?? '')
  const [plexTestSections, setPlexTestSections] = useState<{
    url: string
    token: string
    sections: Array<{ key: string; title: string }>
  } | null>(null)
  const [plexAccountId, setPlexAccountId] = useState(String(settings.plexAccountId ?? ''))
  const [plexAccounts, setPlexAccounts] = useState<Array<{ id: number; name: string }>>([])
  const [jellyfinUrl, setJellyfinUrl] = useState(settings.jellyfinUrl ?? '')
  const [jellyfinApiKey, setJellyfinApiKey] = useState(unmaskSecret(settings.jellyfinApiKey))
  const [jellyfinUserId, setJellyfinUserId] = useState(settings.jellyfinUserId ?? '')
  const [jellyfinLibraryId, setJellyfinLibraryId] = useState(settings.jellyfinLibraryId ?? '')
  const [jellyfinLibraries, setJellyfinLibraries] = useState<Array<{ id: string; name: string }>>(
    [],
  )
  const [embyUrl, setEmbyUrl] = useState(settings.embyUrl ?? '')
  const [embyApiKey, setEmbyApiKey] = useState(unmaskSecret(settings.embyApiKey))
  const [embyUserId, setEmbyUserId] = useState(settings.embyUserId ?? '')
  const [embyLibraryId, setEmbyLibraryId] = useState(settings.embyLibraryId ?? '')
  const [embyLibraries, setEmbyLibraries] = useState<Array<{ id: string; name: string }>>([])
  const [discogsUsername, setDiscogsUsername] = useState(settings.discogsUsername ?? '')
  const [discogsToken, setDiscogsToken] = useState(unmaskSecret(settings.discogsToken))
  const [subsonicUrl, setSubsonicUrl] = useState(settings.subsonicUrl ?? '')
  const [subsonicUsername, setSubsonicUsername] = useState(settings.subsonicUsername ?? '')
  const [subsonicPassword, setSubsonicPassword] = useState(unmaskSecret(settings.subsonicPassword))
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
  const savedPlexToken = unmaskSecret(settings.plexToken)
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

  const secretPlaceholder = (value: string | null | undefined, fallback: string) =>
    savedSecretPlaceholder(value, fallback, t('settings.saved'))

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
    audiomuse: Boolean(prefs.audiomuseUrl),
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
        if (key in savedCredentials) {
          setSavedOverrides((prev) => ({
            ...prev,
            [key]: [...(savedCredentials[key] ?? []), ...(draftCredentials[key] ?? [])].some(
              Boolean,
            ),
          }))
        }
        setSelected(null)
        setFocusSaved(key)
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

  const testAudiomuse = createTester('audiomuse', 'AudioMuse-AI', () =>
    testService('audiomuse', {
      url: audiomuseUrl,
      token: audiomuseToken,
      skipTlsVerify: audiomuseSkipTlsVerify,
    }),
  )
  const saveAudiomuse = createSaver('audiomuse', 'AudioMuse-AI', () =>
    updateSettings({ preferences: { audiomuseUrl, audiomuseToken, audiomuseSkipTlsVerify } }),
  )

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
        lidarrRequireFiles,
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
      setSavedOverrides((prev) => ({ ...prev, ai: true }))
      setSelected(null)
      setFocusSaved('ai')
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

  const savedCredentials: Record<string, unknown[]> = {
    audiomuse: [prefs.audiomuseUrl],
    lidarr: [settings.lidarrUrl, settings.lidarrApiKey],
    ai: [settings.aiProvider, settings.aiModel, settings.aiApiKey, settings.aiBaseUrl],
    tidal: [settings.tidalClientId, settings.tidalClientSecret, settings._tidalAppConfigured],
    listenbrainz: [settings.listenbrainzUsername, settings.listenbrainzToken],
    lastfm: [settings.lastfmUsername, settings.lastfmApiKey],
    plex: [settings.plexUrl, settings.plexToken, settings.plexSectionId, settings.plexAccountId],
    jellyfin: [
      settings.jellyfinUrl,
      settings.jellyfinApiKey,
      settings.jellyfinUserId,
      settings.jellyfinLibraryId,
    ],
    emby: [settings.embyUrl, settings.embyApiKey, settings.embyUserId, settings.embyLibraryId],
    subsonic: [settings.subsonicUrl, settings.subsonicUsername, settings.subsonicPassword],
    discogs: [settings.discogsUsername, settings.discogsToken],
    spotify: [spotifyConnected],
    deezer: [deezerConnected],
    'tidal-user': [tidalConnected],
    notifications: [prefs.channels?.length, prefs.webhookUrl],
  }
  const notificationsSaved = savedCredentials.notifications?.some(Boolean) ?? false
  useEffect(() => {
    if (selected === 'notifications' && notificationsSaved) {
      setSelected(null)
      setFocusSaved('notifications')
    }
  }, [selected, notificationsSaved])
  const draftCredentials: Record<string, unknown[]> = {
    audiomuse: [audiomuseUrl],
    lidarr: [lidarrUrl, lidarrApiKey],
    ai: [aiModel, aiApiKey, aiBaseUrl],
    tidal: [tidalClientId, tidalClientSecret],
    listenbrainz: [lbUsername, lbToken],
    lastfm: [lfUsername, lfApiKey],
    plex: [plexUrl, plexToken],
    jellyfin: [jellyfinUrl, jellyfinApiKey, jellyfinUserId],
    emby: [embyUrl, embyApiKey, embyUserId],
    subsonic: [subsonicUrl, subsonicUsername, subsonicPassword],
    discogs: [discogsUsername, discogsToken],
  }
  function isSaved(id: string) {
    return savedOverrides[id] ?? savedCredentials[id]?.some(Boolean) ?? false
  }
  const connectionFields: Record<string, string[]> = {
    listenbrainz: ['listenbrainzUsername', 'listenbrainzToken'],
    lastfm: ['lastfmUsername', 'lastfmApiKey'],
    plex: ['plexUrl', 'plexToken', 'plexSectionId', 'plexAccountId'],
    jellyfin: ['jellyfinUrl', 'jellyfinApiKey', 'jellyfinUserId', 'jellyfinLibraryId'],
    emby: ['embyUrl', 'embyApiKey', 'embyUserId', 'embyLibraryId'],
    subsonic: ['subsonicUrl', 'subsonicUsername', 'subsonicPassword'],
    discogs: ['discogsUsername', 'discogsToken'],
  }
  async function removeConnection(id: string) {
    setSave(id, true)
    try {
      await updateSettings(
        id === 'audiomuse'
          ? { preferences: { audiomuseUrl: '', audiomuseToken: '', audiomuseSkipTlsVerify: false } }
          : Object.fromEntries((connectionFields[id] ?? []).map((field) => [field, null])),
      )
      const reset: Record<string, () => void> = {
        audiomuse: () => {
          setAudiomuseUrl('')
          setAudiomuseToken('')
          setAudiomuseSkipTlsVerify(false)
        },
        listenbrainz: () => {
          setLbUsername('')
          setLbToken('')
        },
        lastfm: () => {
          setLfUsername('')
          setLfApiKey('')
        },
        plex: () => {
          setPlexUrl('')
          setPlexToken('')
          setPlexSectionId('')
          setPlexAccountId('')
          setPlexAccounts([])
          setPlexTestSections(null)
        },
        jellyfin: () => {
          setJellyfinUrl('')
          setJellyfinApiKey('')
          setJellyfinUserId('')
          setJellyfinLibraryId('')
          setJellyfinLibraries([])
        },
        emby: () => {
          setEmbyUrl('')
          setEmbyApiKey('')
          setEmbyUserId('')
          setEmbyLibraryId('')
          setEmbyLibraries([])
        },
        subsonic: () => {
          setSubsonicUrl('')
          setSubsonicUsername('')
          setSubsonicPassword('')
        },
        discogs: () => {
          setDiscogsUsername('')
          setDiscogsToken('')
        },
      }
      reset[id]?.()
      setSavedOverrides((prev) => ({ ...prev, [id]: false }))
      setTest(id, 'idle')
      onSaved()
      addButton.current?.focus()
    } catch {
      toast.error(t('common.unknownError'))
    } finally {
      setSave(id, false)
    }
  }
  async function toggleExperimental(value: boolean) {
    setSave('experimental', true)
    try {
      await updateSettings({ preferences: { showExperimentalIntegrations: value } })
      queryClient.setQueryData(
        ['settings'],
        (previous: Settings | undefined) =>
          previous && {
            ...previous,
            preferences: { ...previous.preferences, showExperimentalIntegrations: value },
          },
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['search-sources'] }),
        queryClient.invalidateQueries({ queryKey: ['discovery-modes'] }),
      ])
      onSaved()
    } catch {
      toast.error(t('common.unknownError'))
    } finally {
      setSave('experimental', false)
    }
  }
  const choices: ConnectionChoice[] = [
    {
      id: 'listenbrainz',
      name: 'ListenBrainz',
      description: 'settings.picker.listenbrainz',
      group: 'settings.picker.listening',
      icon: <ListenBrainzIcon />,
    },
    {
      id: 'lastfm',
      name: 'Last.fm',
      description: 'settings.picker.lastfm',
      group: 'settings.picker.listening',
      icon: <LastfmIcon />,
    },
    {
      id: 'spotify',
      name: 'Spotify',
      description: 'settings.picker.spotify',
      group: 'settings.picker.streaming',
      icon: <SpotifyIcon />,
    },
    {
      id: 'deezer',
      name: 'Deezer',
      description: 'settings.picker.deezer',
      group: 'settings.picker.streaming',
      icon: <DeezerIcon />,
    },
    {
      id: 'tidal-user',
      name: 'TIDAL',
      description: 'settings.picker.tidal',
      group: 'settings.picker.streaming',
      icon: <TidalIcon />,
      experimental: true,
    },
    {
      id: 'plex',
      name: 'Plex',
      description: 'settings.picker.media',
      group: 'settings.picker.servers',
      icon: <PlexIcon />,
    },
    {
      id: 'jellyfin',
      name: 'Jellyfin',
      description: 'settings.picker.jellyfin',
      group: 'settings.picker.servers',
      icon: <JellyfinIcon />,
    },
    {
      id: 'emby',
      name: 'Emby',
      description: 'settings.picker.media',
      group: 'settings.picker.servers',
      icon: <EmbyIcon />,
    },
    {
      id: 'subsonic',
      name: 'Subsonic / Navidrome',
      description: 'settings.picker.subsonic',
      group: 'settings.picker.servers',
      icon: <SubsonicIcon />,
    },
    {
      id: 'discogs',
      name: 'Discogs',
      description: 'settings.picker.discogs',
      group: 'settings.picker.collections',
      icon: <DiscogsIcon />,
    },
    ...(isAdmin
      ? [
          {
            id: 'audiomuse',
            name: 'AudioMuse-AI',
            description: 'settings.picker.audiomuse' as const,
            group: 'settings.globalSettings' as const,
            icon: <Waves aria-hidden="true" size={20} />,
            experimental: true,
          },
          {
            id: 'lidarr',
            name: 'Lidarr',
            description: 'settings.lidarrDescription' as const,
            group: 'settings.globalSettings' as const,
            icon: <LidarrIcon />,
          },
          {
            id: 'ai',
            name: aiProviderLabel,
            description: 'settings.aiDescription' as const,
            group: 'settings.globalSettings' as const,
            icon: <AiProviderIcon />,
          },
          {
            id: 'notifications',
            name: t('settings.channels.title'),
            description: 'settings.channels.description' as const,
            group: 'settings.globalSettings' as const,
            icon: <WebhookIcon />,
          },
          {
            id: 'tidal',
            name: t('settings.tidalAppName'),
            description: 'settings.tidalDescription' as const,
            group: 'settings.globalSettings' as const,
            icon: <TidalIcon />,
            experimental: true,
          },
        ]
      : []),
  ]
  const visible = (id: string) => experimental || !['tidal', 'tidal-user', 'audiomuse'].includes(id)
  const forms: Record<string, ReactNode> = {
    audiomuse: (
      <ServiceCard
        defaultOpen={selected === 'audiomuse'}
        name="AudioMuse-AI"
        icon={<Waves aria-hidden="true" size={20} />}
        description={t('settings.audiomuseDescription')}
        badge={<Badge variant="warning">{t('search.experimental')}</Badge>}
        status={serviceStatus('audiomuse')}
        onEdit={() => markEdited('audiomuse')}
        onRemove={isSaved('audiomuse') ? () => removeConnection('audiomuse') : undefined}
        removing={saving.audiomuse}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('settings.fieldUrl')} id="audiomuse-url">
            <Input
              id="audiomuse-url"
              type="url"
              placeholder="https://localhost:8000"
              value={audiomuseUrl}
              onChange={(e) => setAudiomuseUrl(e.target.value)}
            />
          </Field>
          <Field label={t('settings.audiomuseToken')} id="audiomuse-token">
            <Input
              id="audiomuse-token"
              type="password"
              value={audiomuseToken}
              onChange={(e) => setAudiomuseToken(e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={audiomuseSkipTlsVerify}
            onChange={(e) => setAudiomuseSkipTlsVerify(e.target.checked)}
            className="rounded border-border"
          />
          {t('setup.skipTlsVerification')}
        </label>
        <p className="text-xs text-muted">{t('settings.audiomuseHelp')}</p>
        <ServiceFormFooter
          onTest={testAudiomuse}
          testing={tests.audiomuse === 'testing'}
          onSave={saveAudiomuse}
          saving={saving.audiomuse}
        />
      </ServiceCard>
    ),
    lidarr: (
      <ServiceCard
        defaultOpen={selected === 'lidarr'}
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
              placeholder={secretPlaceholder(settings.lidarrApiKey, t('settings.fieldApiKey'))}
              value={lidarrApiKey}
              onChange={(e) => setLidarrApiKey(e.target.value)}
            />
          </Field>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={lidarrRequireFiles}
              onChange={(e) => setLidarrRequireFiles(e.target.checked)}
              className="rounded border-border"
            />
            {t('settings.lidarrRequireFiles')}
          </label>
          <p className="text-xs text-muted mt-1">{t('settings.lidarrRequireFilesHelp')}</p>
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
        <ServiceFormFooter
          onTest={testLidarr}
          testing={tests.lidarr === 'testing'}
          onSave={saveLidarr}
          saving={saving.lidarr}
          configured={isLidarrConfigured}
        />
        {settings.lidarrUrl && (
          // Saved separately; keep its picks from marking the connection form unsaved.
          <div onChange={(e) => e.stopPropagation()}>
            <LidarrPreferencesSection />
          </div>
        )}
      </ServiceCard>
    ),
    ai: (
      <ServiceCard
        defaultOpen={selected === 'ai'}
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
              placeholder={secretPlaceholder(settings.aiApiKey, t('settings.fieldApiKey'))}
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
            />
            {aiProvider === 'openai-compatible' && (
              <p className="text-xs text-muted mt-1">{t('settings.aiOpenAiCompatibleHelp')}</p>
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
              <Badge variant={local ? 'success' : 'info'} className="self-start whitespace-nowrap">
                {local ? t('settings.aiPrivacyBadgeLocal') : t('settings.aiPrivacyBadgeHosted')}
              </Badge>
              <p className="text-xs text-muted">
                {local ? t('settings.aiPrivacyNoteLocal') : t('settings.aiPrivacyNoteHosted')}
              </p>
            </div>
          )
        })()}
        <ServiceFormFooter
          onTest={testAi}
          testing={tests.ai === 'testing'}
          onSave={saveAi}
          saving={saving.ai}
          configured={isAiConfigured}
        />
      </ServiceCard>
    ),
    tidal: (
      <ServiceCard
        defaultOpen={selected === 'tidal'}
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
              placeholder={secretPlaceholder(
                settings.tidalClientSecret,
                t('settings.fieldClientSecret'),
              )}
              value={tidalClientSecret}
              onChange={(e) => setTidalClientSecret(e.target.value)}
            />
          </Field>
        </div>
        <ServiceFormFooter
          onTest={testTidal}
          testing={tests.tidal === 'testing'}
          onSave={saveTidal}
          saving={saving.tidal}
          configured={isTidalConfigured}
        />
      </ServiceCard>
    ),
    listenbrainz: (
      <ServiceCard
        defaultOpen={selected === 'listenbrainz'}
        onRemove={isSaved('listenbrainz') ? () => removeConnection('listenbrainz') : undefined}
        removing={saving.listenbrainz}
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
              placeholder={secretPlaceholder(
                settings.listenbrainzToken,
                t('settings.fieldUserToken'),
              )}
              value={lbToken}
              onChange={(e) => setLbToken(e.target.value)}
            />
          </Field>
        </div>
        <ServiceFormFooter
          onTest={testListenbrainz}
          testing={tests.listenbrainz === 'testing'}
          onSave={saveListenbrainz}
          saving={saving.listenbrainz}
          configured={isLbConfigured}
          showTest={canTestUserConnections}
        />
        <ListenBrainzWriteBack />
      </ServiceCard>
    ),
    lastfm: (
      <ServiceCard
        defaultOpen={selected === 'lastfm'}
        onRemove={isSaved('lastfm') ? () => removeConnection('lastfm') : undefined}
        removing={saving.lastfm}
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
              placeholder={secretPlaceholder(settings.lastfmApiKey, t('settings.fieldApiKey'))}
              value={lfApiKey}
              onChange={(e) => setLfApiKey(e.target.value)}
            />
          </Field>
        </div>
        <ServiceFormFooter
          onTest={testLastfm}
          testing={tests.lastfm === 'testing'}
          onSave={saveLastfm}
          saving={saving.lastfm}
          configured={isLfConfigured}
          showTest={canTestUserConnections}
        />
        <LastfmWriteBack />
      </ServiceCard>
    ),
    spotify: (
      <ServiceCard
        defaultOpen={selected === 'spotify'}
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
    ),
    deezer: (
      <ServiceCard
        defaultOpen={selected === 'deezer'}
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
    ),
    'tidal-user': (
      <ServiceCard
        defaultOpen={selected === 'tidal-user'}
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
    ),
    plex: (
      <ServiceCard
        defaultOpen={selected === 'plex'}
        onRemove={isSaved('plex') ? () => removeConnection('plex') : undefined}
        removing={saving.plex}
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
              placeholder={secretPlaceholder(settings.plexToken, t('settings.plexToken'))}
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
        <ServiceFormFooter
          onTest={testPlex}
          testing={tests.plex === 'testing'}
          onSave={savePlex}
          saving={saving.plex}
          configured={isPlexConfigured}
        />
      </ServiceCard>
    ),
    jellyfin: (
      <MediaServerCard
        id="jellyfin"
        name="Jellyfin"
        icon={<JellyfinIcon />}
        description={t('settings.jellyfinDescription')}
        defaultOpen={selected === 'jellyfin'}
        status={serviceStatus('jellyfin')}
        onEdit={() => markEdited('jellyfin')}
        onRemove={isSaved('jellyfin') ? () => removeConnection('jellyfin') : undefined}
        removing={saving.jellyfin}
        userIdLabel={t('settings.fieldUsernameOrUserId')}
        userIdHelp={t('settings.jellyfinUserIdHelp')}
        savedApiKey={settings.jellyfinApiKey}
        url={jellyfinUrl}
        onUrlChange={setJellyfinUrl}
        apiKey={jellyfinApiKey}
        onApiKeyChange={setJellyfinApiKey}
        userId={jellyfinUserId}
        onUserIdChange={setJellyfinUserId}
        libraryId={jellyfinLibraryId}
        onLibraryIdChange={setJellyfinLibraryId}
        libraries={jellyfinLibraries}
        footer={
          <ServiceFormFooter
            onTest={testJellyfin}
            testing={tests.jellyfin === 'testing'}
            onSave={saveJellyfin}
            saving={saving.jellyfin}
            configured={isJellyfinConfigured}
            showTest={canTestUserConnections}
          />
        }
      />
    ),
    emby: (
      <MediaServerCard
        id="emby"
        name="Emby"
        icon={<EmbyIcon />}
        description={t('settings.embyDescription')}
        defaultOpen={selected === 'emby'}
        status={serviceStatus('emby')}
        onEdit={() => markEdited('emby')}
        onRemove={isSaved('emby') ? () => removeConnection('emby') : undefined}
        removing={saving.emby}
        userIdLabel={t('settings.fieldUserId')}
        userIdHelp={t('settings.embyUserIdHelp')}
        savedApiKey={settings.embyApiKey}
        url={embyUrl}
        onUrlChange={setEmbyUrl}
        apiKey={embyApiKey}
        onApiKeyChange={setEmbyApiKey}
        userId={embyUserId}
        onUserIdChange={setEmbyUserId}
        libraryId={embyLibraryId}
        onLibraryIdChange={setEmbyLibraryId}
        libraries={embyLibraries}
        footer={
          <ServiceFormFooter
            onTest={testEmby}
            testing={tests.emby === 'testing'}
            onSave={saveEmby}
            saving={saving.emby}
            configured={isEmbyConfigured}
            showTest={canTestUserConnections}
          />
        }
      />
    ),
    subsonic: (
      <ServiceCard
        defaultOpen={selected === 'subsonic'}
        onRemove={isSaved('subsonic') ? () => removeConnection('subsonic') : undefined}
        removing={saving.subsonic}
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
            placeholder={secretPlaceholder(settings.subsonicPassword, t('settings.fieldPassword'))}
            value={subsonicPassword}
            onChange={(e) => setSubsonicPassword(e.target.value)}
          />
        </Field>
        <ServiceFormFooter
          onTest={testSubsonic}
          testing={tests.subsonic === 'testing'}
          onSave={saveSubsonic}
          saving={saving.subsonic}
          configured={isSubsonicConfigured}
          showTest={canTestUserConnections}
        />
      </ServiceCard>
    ),
    discogs: (
      <ServiceCard
        defaultOpen={selected === 'discogs'}
        onRemove={isSaved('discogs') ? () => removeConnection('discogs') : undefined}
        removing={saving.discogs}
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
              placeholder={secretPlaceholder(
                settings.discogsToken,
                t('settings.fieldPersonalAccessToken'),
              )}
              value={discogsToken}
              onChange={(e) => setDiscogsToken(e.target.value)}
            />
          </Field>
        </div>
        <ServiceFormFooter
          onTest={testDiscogs}
          testing={tests.discogs === 'testing'}
          onSave={saveDiscogs}
          saving={saving.discogs}
          configured={isDiscogsConfigured}
          showTest={canTestUserConnections}
        />
      </ServiceCard>
    ),
    notifications: (
      <NotificationChannelsCard settings={settings} isAdmin={isAdmin} onSaved={onSaved} />
    ),
  }
  const serverIds = ['lidarr', 'ai', 'notifications', 'tidal', 'audiomuse']
  const personalIds = [
    'listenbrainz',
    'lastfm',
    'spotify',
    'deezer',
    'tidal-user',
    'plex',
    'jellyfin',
    'emby',
    'subsonic',
    'discogs',
  ]

  return (
    <div className="space-y-4">
      <section aria-labelledby="server-connections-heading" className="space-y-3">
        <h2 id="server-connections-heading" className="text-lead font-semibold text-text">
          {t('settings.globalSettings')}
        </h2>
        {!isAdmin && <p className="text-xs text-muted">{t('settings.adminOnly')}</p>}
        {isAdmin ? (
          serverIds
            .filter((id) => isSaved(id) && visible(id))
            .map((id) => (
              <div key={id} data-connection={id}>
                {forms[id]}
              </div>
            ))
        ) : (
          <div className="space-y-2">
            {settings.lidarrUrl && (
              <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <img src="/icons/lidarr.png" alt="" className="w-5 h-5" />
                  <div>
                    <span className="text-sm font-medium text-text">Lidarr</span>
                    <p className="text-xs text-muted">{settings.lidarrUrl as string}</p>
                  </div>
                </div>
                <LidarrPreferencesSection />
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
        )}
        {!isAdmin && settings._notificationsConfigured && (
          <ServiceCard name={t('settings.channels.title')} status="saved">
            <p className="text-sm text-muted">{t('settings.adminOnly')}</p>
          </ServiceCard>
        )}
        {!isAdmin && experimental && tidalAppConfigured && (
          <ServiceCard
            name={t('settings.tidalAppName')}
            status="saved"
            badge={<Badge variant="warning">{t('search.experimental')}</Badge>}
            icon={<TidalIcon />}
          >
            <p className="text-sm text-muted">{t('settings.adminOnly')}</p>
          </ServiceCard>
        )}
        <ArtistImagesCard settings={settings} isAdmin={isAdmin} onSaved={onSaved} />
      </section>
      <section aria-labelledby="personal-connections-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="personal-connections-heading" className="text-lead font-semibold text-text">
              {t('settings.yourConnections')}
            </h2>
            <p className="text-xs text-muted mt-1">{t('settings.yourConnectionsDescription')}</p>
          </div>
          <DashboardCardToggle cardId="listening" />
        </div>
        <Hint id="settings-connections-tip" type="inline">
          {t('settings.connectionsTip')}
        </Hint>
        {genreCoverage && genreCoverage.totalArtists > 0 && (
          <div className="rounded-lg border border-border bg-surface px-4 py-3">
            <GenreCoverageSummary coverage={genreCoverage} />
          </div>
        )}
        {personalIds
          .filter((id) => isSaved(id) && visible(id))
          .map((id) => (
            <div key={id} data-connection={id}>
              {forms[id]}
            </div>
          ))}
      </section>
      <Button
        ref={addButton}
        variant="outline"
        aria-expanded={pickerOpen}
        aria-controls="connection-picker"
        className="w-full border-dashed"
        onClick={() => {
          if (pickerOpen) closePicker()
          else {
            setSelected(null)
            setPickerOpen(true)
          }
        }}
      >
        <Plus aria-hidden="true" size={18} />
        {t('settings.addConnection')}
      </Button>
      {pickerOpen && (
        <ConnectionPicker
          choices={choices.filter((choice) => !isSaved(choice.id) && visible(choice.id))}
          onPick={(id) => {
            setSelected(id)
            setPickerOpen(false)
          }}
          onClose={closePicker}
          experimental={experimental}
          onExperimentalChange={isAdmin ? toggleExperimental : undefined}
          saving={saving.experimental ?? false}
        />
      )}
      {selected && visible(selected) && (
        <fieldset
          key={selected}
          ref={formRef}
          aria-label={t('settings.addConnection')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              closePicker()
            }
          }}
        >
          {forms[selected]}
          <Button variant="ghost" onClick={closePicker}>
            {t('common.cancel')}
          </Button>
        </fieldset>
      )}
      <Disclosure title={t('settings.integrationCapabilities')}>
        <IntegrationCapabilities />
      </Disclosure>
    </div>
  )
}
