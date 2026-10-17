// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/web/App'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getRequestLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

async function expandService(name: string) {
  const card = await screen.findByRole('group', { name: new RegExp(name) })
  fireEvent.click(within(card).getAllByRole('button', { expanded: false })[0] as HTMLElement)
}

function renderWithQuery(ui: ReactElement, initialEntries: string[] = ['/']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return {
    client,
    ...render(
      <I18nProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <QueryClientProvider client={client}>{ui}</QueryClientProvider>
        </MemoryRouter>
      </I18nProvider>,
    ),
  }
}

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

vi.mock('@/web/lib/api', () => ({
  getSettings: vi.fn(),
  getPlexSections: vi.fn().mockResolvedValue({ sections: [] }),
  getAuthMeta: vi.fn().mockResolvedValue({ oidcEnabled: false, proxyAuthEnabled: false }),
  linkOidcAccount: vi.fn().mockResolvedValue({ url: '#oidc-link-test' }),
  listArtistBlocks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listAlbumBlocks: vi.fn().mockResolvedValue({ items: [] }),
  updateSettings: vi.fn(),
  testNotificationChannel: vi.fn(),
  getPopularAlbumsAvailability: vi
    .fn()
    .mockResolvedValue({ available: true, spotify: true, lastfm: false }),
  testService: vi.fn(),
  getAuthStatus: vi.fn().mockResolvedValue({
    required: true,
    hasUsers: true,
    oidcEnabled: false,
    isAdmin: true,
  }),
  getLidarrApproveOptions: vi.fn(),
  getPipelineStatus: vi.fn().mockResolvedValue({ running: false }),
  getDashboardGenreCoverage: vi.fn().mockResolvedValue({
    coveredArtists: 18,
    pendingArtists: 4,
    totalArtists: 25,
  }),
  triggerPipeline: vi.fn(),
  getSetupStatus: vi.fn().mockResolvedValue({ setupComplete: true }),
  listTargets: vi.fn().mockResolvedValue([]),
  listUsers: vi.fn().mockResolvedValue([
    { id: 1, username: 'admin', isAdmin: true },
    { id: 2, username: 'listener', isAdmin: false },
  ]),
  updateTargetApi: vi.fn().mockResolvedValue(undefined),
  deleteTargetApi: vi.fn().mockResolvedValue(undefined),
  testTargetApi: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  exportRecommendations: vi.fn().mockResolvedValue(undefined),
  getCurrentUser: vi.fn().mockResolvedValue({
    id: 1,
    username: 'admin',
    isAdmin: true,
    preferredLocale: 'en',
  }),
  getOAuthStatus: vi.fn().mockResolvedValue({ connected: false, scopes: null }),
  importSpotifyLikedSongs: vi.fn().mockResolvedValue({
    message: 'started',
    subscriptionId: 1,
    created: true,
  }),
  initiateOAuth: vi.fn().mockResolvedValue({ authUrl: '' }),
  disconnectOAuth: vi.fn().mockResolvedValue(undefined),
  changePassword: vi.fn().mockResolvedValue(undefined),
  clearStoredToken: vi.fn(),
  logoutUser: vi.fn().mockResolvedValue({ ok: true }),
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  createTargetApi: vi.fn().mockResolvedValue({ id: 99 }),
  updatePreferredLocale: vi.fn().mockResolvedValue({ success: true, preferredLocale: 'en' }),
  AUTH_EXPIRED_EVENT: 'digarr:auth-expired',
  getUserPreferences: vi.fn(),
  getRecommendations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  approveRecommendation: vi.fn().mockResolvedValue({}),
  approveToTarget: vi.fn().mockResolvedValue({}),
  updateRecommendation: vi.fn().mockResolvedValue({}),
  getRecentListens: vi.fn().mockResolvedValue({ tracks: [] }),
  getSubscriptions: vi.fn().mockResolvedValue([]),
  getSchedulerInfo: vi.fn().mockResolvedValue({ jobs: [] }),
  getDashboardTaste: vi.fn().mockResolvedValue([]),
  getDashboardActivity: vi.fn().mockResolvedValue([]),
  getJobHealth: vi.fn().mockResolvedValue({
    pipeline: { status: 'ok', lastRun: null, nextRun: null },
    subscriptions: { status: 'ok', healthy: 0, total: 0 },
    playlists: { status: 'ok', lastRun: null },
    librarySync: { status: 'ok', lastRun: null },
    sources: {},
  }),
  listJobs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  updateUserPreferences: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    promise: vi.fn(),
  },
}))

vi.mock('@/web/components/bottom-nav', () => ({
  BottomNav: () => null,
}))

vi.mock('@/web/components/auth-gate', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/web/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/web/components/keyboard-shortcuts', () => ({
  KeyboardShortcuts: () => null,
}))

vi.mock('@/web/components/preview-player', () => ({
  PreviewPlayer: () => null,
}))

vi.mock('@/web/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}))

vi.mock('@/web/hooks/use-preview', () => ({
  usePreview: () => ({
    play: vi.fn(),
    stop: vi.fn(),
    hasPreview: false,
    state: {
      artistMbid: null,
      playing: false,
      artistName: '',
      source: '',
      loading: false,
    },
    globalPlayId: null,
  }),
}))

vi.mock('@/web/lib/hooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/web/lib/hooks')>()
  return {
    ...original,
    useSSE: vi.fn(() => ({ data: null, connected: false })),
  }
})

import {
  changePassword,
  createTargetApi,
  getAuthMeta,
  getCurrentUser,
  getJobHealth,
  getLidarrApproveOptions,
  getOAuthStatus,
  getPipelineStatus,
  getPlexSections,
  getSettings,
  getUserPreferences,
  importSpotifyLikedSongs,
  linkOidcAccount,
  listAlbumBlocks,
  listArtistBlocks,
  listJobs,
  listTargets,
  listUsers,
  testNotificationChannel,
  testService,
  updatePreferredLocale,
  updateSettings,
  updateTargetApi,
  updateUserPreferences,
} from '@/web/lib/api'
import { getStoredLocale } from '@/web/lib/locale-storage'
import { SettingsPage } from '@/web/pages/settings'

const mockGetSettings = getSettings as ReturnType<typeof vi.fn>
const mockGetPipelineStatus = getPipelineStatus as ReturnType<typeof vi.fn>
const mockUpdateSettings = updateSettings as ReturnType<typeof vi.fn>
const mockTestService = testService as ReturnType<typeof vi.fn>
const mockTestNotificationChannel = testNotificationChannel as ReturnType<typeof vi.fn>
const mockGetLidarrApproveOptions = getLidarrApproveOptions as ReturnType<typeof vi.fn>
const mockGetOAuthStatus = getOAuthStatus as ReturnType<typeof vi.fn>
const mockImportSpotifyLikedSongs = importSpotifyLikedSongs as ReturnType<typeof vi.fn>
const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>
const mockGetStoredLocale = getStoredLocale as ReturnType<typeof vi.fn>
const mockUpdatePreferredLocale = updatePreferredLocale as ReturnType<typeof vi.fn>
const mockCreateTargetApi = createTargetApi as ReturnType<typeof vi.fn>
const mockListTargets = listTargets as ReturnType<typeof vi.fn>
const mockUpdateTargetApi = updateTargetApi as ReturnType<typeof vi.fn>
const mockUpdateUserPreferences = updateUserPreferences as ReturnType<typeof vi.fn>
const mockGetUserPreferences = getUserPreferences as ReturnType<typeof vi.fn>
const mockListJobs = listJobs as ReturnType<typeof vi.fn>
const mockGetJobHealth = getJobHealth as ReturnType<typeof vi.fn>
const mockChangePassword = changePassword as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockSettings = {
  lidarrUrl: 'http://localhost:8686',
  lidarrApiKey: '***',
  listenbrainzUsername: 'testuser',
  listenbrainzToken: '***',
  lastfmUsername: '',
  lastfmApiKey: '',
  aiProvider: 'anthropic',
  aiModel: 'claude-3-5-haiku-20241022',
  aiApiKey: '***',
  preferences: {
    qualityProfileId: 1,
    metadataProfileId: 1,
    rootFolderId: 1,
    scheduleCron: '0 0 * * *',
    scoreThreshold: 0.5,
  },
  librarySyncIntervalHours: 6,
  setupComplete: true,
}

function setupMocks(settings: Record<string, unknown> = mockSettings) {
  mockGetSettings.mockResolvedValue(settings)
  mockGetLidarrApproveOptions.mockResolvedValue({
    qualityProfiles: [{ id: 1, name: 'Any' }],
    metadataProfiles: [{ id: 1, name: 'Standard' }],
    rootFolders: [{ id: 1, path: '/data/music' }],
  })
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPlexSections).mockResolvedValue({ sections: [] })
    vi.mocked(getAuthMeta).mockResolvedValue({
      version: '1.16.0',
      oidcEnabled: false,
      proxyAuthEnabled: false,
    })
    vi.mocked(linkOidcAccount).mockResolvedValue({ url: '#oidc-link-test' })
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe = vi.fn()
        disconnect = vi.fn()
      },
    })
    const storage = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value)
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key)
        }),
        clear: vi.fn(() => {
          storage.clear()
        }),
      },
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    mockGetStoredLocale.mockReturnValue('en')
    mockGetCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'en',
    })
    mockGetPipelineStatus.mockResolvedValue({ running: false })
    mockUpdatePreferredLocale.mockResolvedValue({ success: true, preferredLocale: 'en' })
    mockChangePassword.mockResolvedValue(undefined)
    mockUpdateUserPreferences.mockReset().mockResolvedValue({ success: true })
    mockUpdateSettings.mockReset().mockResolvedValue(undefined)
    mockGetUserPreferences.mockReset().mockResolvedValue({
      scoreThreshold: 0.5,
      scoringWeights: {
        consensus: 0.3,
        similarity: 0.25,
        genreOverlap: 0.2,
        aiConfidence: 0.15,
        feedbackBoost: 0.1,
        popularity: 0.0,
      },
      rejectionCooldownDays: 90,
      topArtistsLimit: 30,
      librarySeedRatio: 0.3,
    })
  })

  it('shows listening genre coverage in Connections', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />)

    expect(await screen.findByText('Genre data available: 18/25')).toBeInTheDocument()
    expect(screen.getByText('Pending genre data updates: 4')).toBeInTheDocument()
  })

  it('replaces an admin-only tab in the URL when a non-admin opens it', async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: 2,
      username: 'listener',
      isAdmin: false,
      preferredLocale: 'en',
    })
    setupMocks()
    renderWithQuery(
      <>
        <SettingsPage />
        <LocationProbe />
      </>,
      ['/settings?tab=jobs'],
    )

    expect(await screen.findByText('Genre data available: 18/25')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('?tab=connections'),
    )
  })

  it('uses translated navigation labels', async () => {
    mockGetStoredLocale.mockReturnValue('fr')
    mockGetCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'fr',
    })

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    )

    expect(await screen.findByRole('link', { name: 'Tableau de bord' })).toBeInTheDocument()
  })

  it('uses translated theme menu labels', async () => {
    mockGetStoredLocale.mockReturnValue('fr')
    mockGetCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'fr',
    })

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    )

    fireEvent.click(await screen.findByLabelText('Paramètres du thème'))

    expect(screen.getByText('Éditeur')).toBeInTheDocument()
    expect(screen.getByText('Clair')).toBeInTheDocument()
  })

  it('shows loading skeleton while fetching settings', () => {
    mockGetSettings.mockReturnValue(new Promise(() => {}))
    renderWithQuery(<SettingsPage />)
    const pulsingEls = document.querySelectorAll('.animate-pulse')
    expect(pulsingEls.length).toBeGreaterThan(0)
  })

  it('groups settings sections in the side menu and the small-screen select', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />)

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    expect(within(nav).getByText('Personal')).toBeInTheDocument()
    expect(within(nav).getByText('Library & services')).toBeInTheDocument()
    expect(within(nav).getByText('Admin')).toBeInTheDocument()
    for (const name of ['Account', 'Connections', 'Schedule', 'Job History', 'System Health']) {
      expect(within(nav).getByRole('button', { name })).toBeInTheDocument()
    }

    const select = screen.getByTestId('settings-section-select')
    expect(select).toHaveValue('connections')
    fireEvent.change(select, { target: { value: 'account' } })
    expect(within(nav).getByRole('button', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('only reports a passing test for the saved values', async () => {
    setupMocks()
    mockTestService.mockResolvedValue({ success: true, message: 'OK' })
    renderWithQuery(<SettingsPage />)

    const card = await screen.findByRole('group', { name: /Lidarr/ })
    expect(within(card).getByText('Saved')).toBeInTheDocument()
    await expandService('Lidarr')
    fireEvent.click(within(card).getByRole('button', { name: 'Test Connection' }))
    expect(await within(card).findByText('Test passed')).toBeInTheDocument()

    fireEvent.change(within(card).getByLabelText('URL'), {
      target: { value: 'http://other:8686' },
    })
    expect(within(card).getByText('Saved')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Test Connection' }))
    expect(await within(card).findByText('Test passed - not saved yet')).toBeInTheDocument()
  })

  it('defaults to Connections tab showing Lidarr section', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Lidarr').length).toBeGreaterThan(0)
    })
    // Lidarr URL field should be present
    expect(screen.getByDisplayValue('http://localhost:8686')).toBeInTheDocument()
  })

  it('labels Ollama as local when it points at localhost', async () => {
    setupMocks({
      ...mockSettings,
      aiProvider: 'ollama',
      aiBaseUrl: 'http://localhost:11434',
    })
    renderWithQuery(<SettingsPage />)

    expect(await screen.findByText('Fully local')).toBeInTheDocument()
    expect(screen.getByText('Discovery prompts stay on your server.')).toBeInTheDocument()
  })

  it('warns when Ollama points at a remote host', async () => {
    setupMocks({
      ...mockSettings,
      aiProvider: 'ollama',
      aiBaseUrl: 'http://ollama.example.com:11434',
    })
    renderWithQuery(<SettingsPage />)

    expect(await screen.findByText('Data leaves your server')).toBeInTheDocument()
    expect(
      screen.getByText(/Discovery prompts are sent to your chosen provider/),
    ).toBeInTheDocument()
  })

  it('tab switching shows Recommendations content', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Recommendations' }))

    await waitFor(() => {
      expect(screen.getByText('Score threshold')).toBeInTheDocument()
      expect(screen.getByText('Scoring Weights')).toBeInTheDocument()
    })
  })

  it('saves optional genre lists without replacing scoring weights', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />, ['/settings?tab=recommendations'])
    const primary = await screen.findByLabelText('Priority genres (optional)')
    fireEvent.change(primary, { target: { value: 'metal, jazz, trip hop' } })
    fireEvent.change(screen.getByLabelText('Other preferred genres (optional)'), {
      target: { value: 'ambient,  ' },
    })
    const panel = primary.closest('section')?.parentElement
    if (!panel) throw new Error('recommendations panel missing')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockUpdateUserPreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryGenres: ['metal', 'jazz', 'trip hop'],
          secondaryGenres: ['ambient'],
          scoringWeights: expect.any(Object),
        }),
      ),
    )
  })

  it.each(['users', 'administration', 'jobs', 'system-health', 'nonsense'])(
    'falls back to Connections when a member opens ?tab=%s',
    async (tab) => {
      setupMocks()
      mockGetCurrentUser.mockResolvedValue({ id: 2, username: 'listener', isAdmin: false })
      renderWithQuery(<SettingsPage />, [`/settings?tab=${tab}`])
      expect(await screen.findByRole('button', { name: 'Connections' })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(listUsers).not.toHaveBeenCalled()
    },
  )

  it('saves member recommendation preferences without global controls or writes', async () => {
    setupMocks()
    mockGetCurrentUser.mockResolvedValue({ id: 2, username: 'listener', isAdmin: false })
    mockUpdateSettings.mockRejectedValue(new Error('Forbidden'))
    const { client } = renderWithQuery(<SettingsPage />, ['/settings?tab=recommendations'])
    const primary = await screen.findByLabelText('Priority genres (optional)')
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))

    expect(screen.queryByLabelText('TheAudioDB premium API key (optional)')).toBeNull()
    expect(screen.queryByLabelText(/Proxy images through Digarr/)).toBeNull()
    expect(
      screen.queryByLabelText('Show artist bio and external links on recommendation cards'),
    ).toBeNull()
    fireEvent.change(primary, { target: { value: 'metal' } })
    fireEvent.change(screen.getByLabelText('Fanart.tv API key (optional)'), {
      target: { value: 'personal-fanart-key' },
    })
    fireEvent.change(screen.getByLabelText('Metadata fallback URL (optional)'), {
      target: { value: 'https://metadata.example.com' },
    })
    const saved = {
      ...client.getQueryData<Record<string, unknown>>(['user-preferences']),
      primaryGenres: ['metal'],
    }
    mockGetUserPreferences.mockResolvedValueOnce(saved)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Recommendation settings saved'))
    expect(mockUpdateUserPreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryGenres: ['metal'],
        fanartApiKey: 'personal-fanart-key',
        metadataFallbackUrl: 'https://metadata.example.com',
      }),
    )
    expect(mockUpdateSettings).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user-preferences'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recommendations'] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['settings'] })
    await waitFor(() => expect(client.getQueryData(['user-preferences'])).toEqual(saved))
  })

  it('saves admin personal preferences before global metadata settings', async () => {
    setupMocks({ ...mockSettings, audiodbProxyImages: false, wikidataEnabled: true })
    const { client } = renderWithQuery(<SettingsPage />, ['/settings?tab=recommendations'])
    await screen.findByLabelText('Priority genres (optional)')
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.change(screen.getByLabelText('TheAudioDB premium API key (optional)'), {
      target: { value: 'global-audiodb-key' },
    })
    fireEvent.click(screen.getByLabelText(/Proxy images through Digarr/))
    fireEvent.click(
      screen.getByLabelText('Show artist bio and external links on recommendation cards'),
    )
    mockUpdateSettings.mockImplementationOnce(async () => {
      expect(mockUpdateUserPreferences).toHaveBeenCalledOnce()
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user-preferences'] })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recommendations'] })
      expect(localStorage.getItem('digarr:audiodbProxyImages')).toBe('0')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Recommendation settings saved'))
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      audiodbApiKey: 'global-audiodb-key',
      audiodbProxyImages: true,
      wikidataEnabled: false,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settings'] })
    expect(localStorage.getItem('digarr:audiodbProxyImages')).toBe('1')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports partial admin saves and refreshes personal preferences after global failure', async () => {
    setupMocks({ ...mockSettings, audiodbProxyImages: false })
    mockUpdateSettings.mockRejectedValueOnce(new Error('Global settings unavailable'))
    const { client } = renderWithQuery(<SettingsPage />, ['/settings?tab=recommendations'])
    const primary = await screen.findByLabelText('Priority genres (optional)')
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.change(primary, { target: { value: 'jazz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.click(screen.getByLabelText(/Proxy images through Digarr/))
    const saved = {
      ...client.getQueryData<Record<string, unknown>>(['user-preferences']),
      primaryGenres: ['jazz'],
    }
    mockGetUserPreferences.mockResolvedValueOnce(saved)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Personal preferences saved, but global metadata settings failed to save.',
      ),
    )
    expect(mockUpdateSettings).toHaveBeenCalledOnce()
    expect(toast.success).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recommendations'] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['settings'] })
    await waitFor(() => expect(client.getQueryData(['user-preferences'])).toEqual(saved))
    expect(localStorage.getItem('digarr:audiodbProxyImages')).toBe('0')
    expect(primary).toHaveValue('jazz')
    expect(screen.getByLabelText(/Proxy images through Digarr/)).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('aborts global settings when saving personal preferences fails', async () => {
    setupMocks()
    mockUpdateUserPreferences.mockRejectedValueOnce(new Error('Preferences unavailable'))
    const { client } = renderWithQuery(<SettingsPage />, ['/settings?tab=recommendations'])
    await screen.findByLabelText('Priority genres (optional)')
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save settings'))
    expect(mockUpdateSettings).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('opens and focuses net-new album discovery from its deep link', async () => {
    setupMocks()
    Element.prototype.scrollIntoView = vi.fn()

    renderWithQuery(<SettingsPage />, ['/settings?tab=recommendations#net-new-album-discovery'])

    const setting = await screen.findByText('Net-new album discovery')
    const settingLabel = setting.closest('label')
    expect(settingLabel).not.toBeNull()
    expect(settingLabel).toHaveAttribute('id', 'net-new-album-discovery')
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await waitFor(() => expect(settingLabel).toHaveFocus())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('tab switching shows Schedule content', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    await waitFor(() => {
      expect(screen.getByText('Presets')).toBeInTheDocument()
      expect(screen.getByText('Daily')).toBeInTheDocument()
      expect(screen.getByText('Weekly')).toBeInTheDocument()
      expect(screen.getByText('Custom Cron')).toBeInTheDocument()
    })
  })

  it('tab switching shows Job History content inside settings', async () => {
    setupMocks()
    mockListJobs.mockResolvedValue({
      items: [],
      total: 0,
    })
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Job History' }))

    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument()
      expect(screen.getByText('No jobs found.')).toBeInTheDocument()
    })
  })

  it('tab switching shows System Health content inside settings', async () => {
    setupMocks()
    mockGetJobHealth.mockResolvedValue({
      pipeline: { status: 'ok', lastRun: null, nextRun: null },
      subscriptions: { status: 'ok', healthy: 3, total: 4 },
      playlists: { status: 'degraded', lastRun: null },
      librarySync: { status: 'ok', lastRun: null },
      sources: { spotify: 'ok', lastfm: 'degraded' },
    })
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'System Health' }))

    await waitFor(() => {
      expect(screen.getAllByText('System Health').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Library Sync').length).toBeGreaterThan(0)
    })
  })

  it('Test Connection button calls testService for Lidarr', async () => {
    setupMocks()
    mockTestService.mockResolvedValue({ success: true, message: 'OK' })
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Lidarr').length).toBeGreaterThan(0)
    })

    // Find the Lidarr section's Test Connection button (first one)
    const testButtons = screen.getAllByText('Test Connection')
    // biome-ignore lint/style/noNonNullAssertion: checked above
    fireEvent.click(testButtons[0]!)

    await waitFor(() => {
      expect(mockTestService).toHaveBeenCalledWith(
        'lidarr',
        expect.objectContaining({
          url: 'http://localhost:8686',
        }),
      )
    })
  })

  it('Save button calls updateSettings for Lidarr', async () => {
    setupMocks()
    mockUpdateSettings.mockResolvedValue(undefined as unknown as Record<string, unknown>)
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Lidarr').length).toBeGreaterThan(0)
    })

    // Find the Lidarr section's Save button (first one)
    const saveButtons = screen.getAllByText('Save')
    // biome-ignore lint/style/noNonNullAssertion: checked above
    fireEvent.click(saveButtons[0]!)

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ lidarrUrl: 'http://localhost:8686' }),
      )
    })
  })

  it('adds a notification channel, then tests and saves it', async () => {
    setupMocks()
    mockUpdateSettings.mockResolvedValue(undefined as unknown as Record<string, unknown>)
    mockTestNotificationChannel.mockResolvedValue(undefined)
    renderWithQuery(<SettingsPage />)

    const addButton = await screen.findByText('Add channel')
    const card = screen.getByRole('group', { name: 'Notifications' })
    expect(card).toBeTruthy()

    // No type-specific fields until a channel is added.
    expect(within(card).queryByLabelText('Webhook URL')).toBeNull()

    fireEvent.click(addButton)

    // Default type is webhook, so its URL field appears.
    const urlInput = await within(card).findByLabelText('Webhook URL')
    fireEvent.change(urlInput, { target: { value: 'https://example.com/hook' } })

    // Enabled toggle round-trips.
    const enabledToggle = within(card).getByLabelText('Enabled') as HTMLInputElement
    expect(enabledToggle.checked).toBe(true)
    fireEvent.click(enabledToggle)
    expect(enabledToggle.checked).toBe(false)
    fireEvent.click(enabledToggle)

    // Test button hits the per-channel test endpoint with the edited channel.
    fireEvent.click(within(card).getByText('Test'))
    await waitFor(() => {
      expect(mockTestNotificationChannel).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'webhook', url: 'https://example.com/hook' }),
      )
    })

    // Save posts a channels array inside preferences.
    fireEvent.click(within(card).getByText('Save'))
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            channels: expect.arrayContaining([
              expect.objectContaining({ type: 'webhook', url: 'https://example.com/hook' }),
            ]),
          }),
        }),
      )
    })
  })

  it('round-trips an untouched channel secret as masked, sends plaintext when changed', async () => {
    setupMocks({
      ...mockSettings,
      preferences: {
        ...mockSettings.preferences,
        channels: [
          {
            id: 'tg1',
            type: 'telegram',
            enabled: true,
            events: ['batch_complete'],
            botToken: '***',
            chatId: '123',
          },
        ],
      },
    })
    mockUpdateSettings.mockResolvedValue(undefined as unknown as Record<string, unknown>)
    renderWithQuery(<SettingsPage />)

    await screen.findByText('Add channel')
    const card = screen.getByRole('group', { name: 'Notifications' })

    // The masked secret shows an empty input with a keep placeholder.
    const botInput = within(card).getByLabelText('Bot token') as HTMLInputElement
    expect(botInput.value).toBe('')
    expect(botInput.placeholder).toBe('Leave blank to keep the saved value')

    // Saving without touching it keeps the stored value ('***', restored server-side).
    fireEvent.click(within(card).getByText('Save'))
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            channels: expect.arrayContaining([
              expect.objectContaining({ id: 'tg1', botToken: '***' }),
            ]),
          }),
        }),
      )
    })

    // Typing a new secret sends the plaintext, never appended to '***'.
    mockUpdateSettings.mockClear()
    fireEvent.change(botInput, { target: { value: 'new-token' } })
    fireEvent.click(within(card).getByText('Save'))
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            channels: expect.arrayContaining([
              expect.objectContaining({ id: 'tg1', botToken: 'new-token' }),
            ]),
          }),
        }),
      )
    })
  })

  it('hides the notification channels card from non-admins', async () => {
    setupMocks()
    mockGetCurrentUser.mockResolvedValue({
      id: 2,
      username: 'viewer',
      isAdmin: false,
      preferredLocale: 'en',
    })
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })
    expect(screen.queryByText('Add channel')).toBeNull()
  })

  it('snaps stale per-user Lidarr preference ids before saving', async () => {
    setupMocks()
    mockGetLidarrApproveOptions.mockResolvedValue({
      qualityProfiles: [{ id: 3, name: 'Stefan' }],
      metadataProfiles: [{ id: 4, name: 'Standard' }],
      rootFolders: [{ id: 10, path: '/music' }],
    })

    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Stefan')).toBeInTheDocument()
      expect(screen.getByDisplayValue('/music')).toBeInTheDocument()
    })

    // The defaults live inside the Lidarr connection card now.
    fireEvent.click(screen.getByRole('button', { name: /^Lidarr/ }))
    const preferencesToggle = screen.getByRole('button', { name: 'Your Lidarr preferences' })
    fireEvent.click(preferencesToggle)
    const preferences = preferencesToggle.parentElement
    if (!preferences) throw new Error('preferences disclosure not found')
    fireEvent.click(within(preferences).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateUserPreferences).toHaveBeenCalledWith({
        qualityProfileId: 3,
        metadataProfileId: 4,
        rootFolderId: 10,
      })
    })
  })

  it('allows non-admin Plex testing while keeping other connection probes hidden', async () => {
    setupMocks()
    mockGetCurrentUser.mockResolvedValue({
      id: 2,
      username: 'user',
      isAdmin: false,
      preferredLocale: 'en',
    })
    mockUpdateSettings.mockResolvedValue(undefined as unknown as Record<string, unknown>)

    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('ListenBrainz')).toBeInTheDocument()
    })
    await expandService('ListenBrainz')
    await expandService('Plex')

    expect(screen.getAllByRole('button', { name: 'Test Connection' })).toHaveLength(1)

    const saveButtons = screen.getAllByRole('button', { name: 'Save' })
    const firstSaveButton = saveButtons[0]
    expect(firstSaveButton).toBeDefined()
    if (!firstSaveButton) return
    fireEvent.click(firstSaveButton)

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalled()
    })
  })

  it('restores the saved Plex library title without testing the connection', async () => {
    setupMocks({
      ...mockSettings,
      plexUrl: 'http://localhost:32400',
      plexToken: '***',
      plexSectionId: '2',
    })
    mockGetCurrentUser.mockResolvedValue({
      id: 2,
      username: 'listener',
      isAdmin: false,
      preferredLocale: 'en',
    })
    vi.mocked(getPlexSections).mockResolvedValue({ sections: [{ key: '2', title: 'Music' }] })
    renderWithQuery(<SettingsPage />)
    await expandService('Plex')
    expect(await screen.findByRole('option', { name: 'Music' })).toBeInTheDocument()
    expect(document.getElementById('plex-section')).toHaveValue('2')
    expect(mockTestService).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each(['plex-url', 'plex-token'])(
    'ignores saved Plex labels after editing %s while loading',
    async (field) => {
      setupMocks({
        ...mockSettings,
        plexUrl: 'http://localhost:32400',
        plexToken: '***',
        plexSectionId: '2',
      })
      let resolveSections!: (value: { sections: Array<{ key: string; title: string }> }) => void
      vi.mocked(getPlexSections).mockReturnValue(
        new Promise((resolve) => {
          resolveSections = resolve
        }),
      )
      renderWithQuery(<SettingsPage />)
      await waitFor(() => expect(getPlexSections).toHaveBeenCalled())
      const input = document.getElementById(field)
      if (!input) throw new Error('Plex input missing')
      fireEvent.change(input, {
        target: { value: field === 'plex-url' ? 'http://draft-plex:32400' : 'draft-token' },
      })
      await act(async () => {
        resolveSections({ sections: [{ key: '2', title: 'Music' }] })
      })
      await waitFor(() =>
        expect(screen.queryByRole('option', { name: 'Music' })).not.toBeInTheDocument(),
      )
      expect(document.getElementById('plex-section')).toHaveValue('2')
    },
  )

  it('loads Plex listeners and saves the selected account for a non-admin', async () => {
    setupMocks({ ...mockSettings, plexUrl: 'http://localhost:32400', plexToken: '***' })
    mockGetCurrentUser.mockResolvedValue({
      id: 2,
      username: 'user',
      isAdmin: false,
      preferredLocale: 'en',
    })
    mockTestService.mockResolvedValue({
      message: 'Connected',
      sections: [{ key: '2', title: 'Music' }],
      sectionId: '2',
      accounts: [{ id: 7, name: 'Listener' }],
      machineIdentifier: 'server',
    })
    mockUpdateSettings.mockResolvedValue(undefined)
    renderWithQuery(<SettingsPage />)
    await expandService('Plex')
    fireEvent.click(await screen.findByRole('button', { name: 'Test Connection' }))
    await screen.findByRole('option', { name: 'Listener' })
    expect(mockTestService).toHaveBeenCalledWith(
      'plex',
      expect.objectContaining({ url: 'http://localhost:32400', accountId: null }),
    )
    const selector = screen.getByLabelText('Plex listener')
    fireEvent.change(selector, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    await waitFor(() =>
      expect(mockTestService).toHaveBeenLastCalledWith(
        'plex',
        expect.objectContaining({ accountId: 7 }),
      ),
    )
    const content = selector.parentElement?.parentElement
    if (!content) throw new Error('Plex card content missing')
    fireEvent.click(within(content).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ plexAccountId: 7, plexSectionId: '2' }),
      ),
    )
  })

  it('shows error state when settings fail to load', async () => {
    mockGetSettings.mockRejectedValue(new Error('Network error'))
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Network error/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument()
  })

  it('shows Spotify import action when Spotify is connected', async () => {
    setupMocks()
    mockGetOAuthStatus.mockResolvedValue({ connected: true, scopes: 'user-library-read' })
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Import Liked Songs')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Import Liked Songs'))

    await waitFor(() => {
      expect(mockImportSpotifyLikedSongs).toHaveBeenCalled()
    })
  })

  it('renders a language switcher in account settings', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))

    expect(await screen.findByLabelText('Language')).toBeInTheDocument()
  })

  it('links a local account only after entering its current password', async () => {
    setupMocks()
    mockGetCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      authProvider: 'local',
      oidcSubject: null,
    })
    vi.mocked(getAuthMeta).mockResolvedValue({
      version: '1.16.0',
      oidcEnabled: true,
      proxyAuthEnabled: false,
    })
    renderWithQuery(<SettingsPage />, ['/settings?tab=account'])

    const button = await screen.findByRole('button', { name: 'Link SSO account' })
    expect(button).toBeDisabled()
    const form = button.closest('form')
    expect(form).not.toBeNull()
    fireEvent.change(within(form as HTMLFormElement).getByLabelText('Current password'), {
      target: { value: 'current-password' },
    })
    fireEvent.click(button)

    await waitFor(() => {
      expect(linkOidcAccount).toHaveBeenCalledWith('current-password')
      expect(window.location.hash).toBe('#oidc-link-test')
    })
    expect(localStorage.setItem).not.toHaveBeenCalled()
    window.history.replaceState(null, '', window.location.pathname)
  })

  it('refreshes link availability immediately after saving OIDC settings', async () => {
    setupMocks()
    mockGetCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      authProvider: 'local',
      oidcSubject: null,
    })
    const { client } = renderWithQuery(<SettingsPage />, ['/settings?tab=auth'])
    client.setQueryDefaults(['authMeta'], { staleTime: 30_000 })
    await screen.findByRole('button', { name: 'Save' })
    await waitFor(() => expect(getAuthMeta).toHaveBeenCalledTimes(1))
    vi.mocked(getAuthMeta).mockResolvedValue({
      version: '1.16.0',
      oidcEnabled: true,
      proxyAuthEnabled: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(getAuthMeta).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))

    expect(await screen.findByRole('button', { name: 'Link SSO account' })).toBeInTheDocument()
  })

  it('keeps email and password under one Security section and hides SSO when it is off', async () => {
    setupMocks()
    mockGetCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      authProvider: 'local',
      oidcSubject: null,
    })
    renderWithQuery(<SettingsPage />, ['/settings?tab=account'])

    expect(await screen.findByRole('heading', { name: 'Security' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /SSO/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Link SSO account' })).not.toBeInTheDocument()
  })

  it.each([['/settings?tab=blocked'], ['/settings?tab=recommendations']])(
    'shows Blocked as a count section of Recommendations (%s)',
    async (url) => {
      setupMocks()
      vi.mocked(listArtistBlocks).mockResolvedValue({
        items: [],
        nextCursor: null,
      })
      vi.mocked(listAlbumBlocks).mockResolvedValue({ items: [] })
      renderWithQuery(<SettingsPage />, [url])

      expect(await screen.findByText('Score threshold')).toBeInTheDocument()
      const toggle = await screen.findByRole('button', { name: 'Blocked - 0' })
      await waitFor(() =>
        expect(toggle).toHaveAttribute('aria-expanded', String(url.includes('blocked'))),
      )
    },
  )

  it('shows linked status without offering another link', async () => {
    setupMocks()
    mockGetCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      authProvider: 'local',
      oidcSubject: 'subject-1',
    })
    vi.mocked(getAuthMeta).mockResolvedValue({
      version: '1.16.0',
      oidcEnabled: true,
      proxyAuthEnabled: false,
    })
    renderWithQuery(<SettingsPage />, ['/settings?tab=account'])

    expect(await screen.findByText('SSO is linked to this account.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Link SSO account' })).not.toBeInTheDocument()
  })

  it.each([
    ['success', 'SSO account linked.'],
    ['identity_in_use', 'This SSO identity is already linked to another account.'],
    [
      'untrusted-value',
      'Could not link the SSO account. Sign in with your password and try again.',
    ],
  ])('shows a fixed notice for OIDC link outcome %s', async (outcome, message) => {
    setupMocks()
    renderWithQuery(<SettingsPage />, [`/settings?tab=account&oidc_link=${outcome}`])

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('untrusted-value')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })

  it('changes the password without persisting a response token', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Account' }))
    fireEvent.change(await screen.findByLabelText(/Current password/i), {
      target: { value: 'current-password' },
    })
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: 'new-password-123' },
    })
    fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
      target: { value: 'new-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith('current-password', 'new-password-123')
    })
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it('keeps account locale changes local when rendered without the app shell owner', async () => {
    setupMocks()
    const { client } = renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))

    const switcher = await screen.findByLabelText('Language')
    fireEvent.change(switcher, { target: { value: 'de' } })

    expect(switcher).toHaveValue('de')
    expect(mockUpdatePreferredLocale).not.toHaveBeenCalled()
    expect(client.getQueryData(['currentUser'])).toEqual({
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'en',
    })
  })

  it('creates an slskd target with an optional linked Lidarr target', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([
      {
        id: 11,
        userId: 1,
        type: 'lidarr',
        name: 'Primary Lidarr',
        enabled: true,
        owned: true,
        config: { url: 'http://lidarr:8686' },
      },
      {
        id: 12,
        userId: 1,
        type: 'lidarr',
        name: 'Disabled Lidarr',
        enabled: false,
        owned: true,
        config: { url: 'http://lidarr-disabled:8686' },
      },
    ])

    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Targets' }))
    fireEvent.click(await screen.findByText('Add Target'))

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'slskd' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Soulseek' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://slskd:5030' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'slskd-key' } })
    fireEvent.change(screen.getByLabelText('Lidarr Target'), { target: { value: '11' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add Target' }))

    await waitFor(() => {
      expect(mockCreateTargetApi).toHaveBeenCalledWith({
        type: 'slskd',
        userId: 1,
        name: 'Soulseek',
        config: {
          url: 'http://slskd:5030',
          apiKey: 'slskd-key',
          lidarrTargetId: 11,
        },
      })
    })
  })

  it('creates a Navidrome playlist target', async () => {
    setupMocks()

    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Targets' }))
    fireEvent.click(await screen.findByText('Add Target'))

    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'navidrome-playlist' },
    })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Navidrome' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://navidrome:4533' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add Target' }))

    await waitFor(() => {
      expect(mockCreateTargetApi).toHaveBeenCalledWith({
        type: 'navidrome-playlist',
        userId: 1,
        name: 'Navidrome',
        config: {
          url: 'http://navidrome:4533',
          username: 'admin',
          password: 'secret',
        },
      })
    })
  })

  it('shows slskd limitation help when adding a slskd target', async () => {
    setupMocks()

    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Targets' }))
    fireEvent.click(await screen.findByText('Add Target'))
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'slskd' } })

    expect(
      screen.getByText(
        'slskd can queue releases, but full automation requires a linked Lidarr target.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Release policy: standalone slskd queues releases directly.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Quality policy: linked Lidarr handles quality and imports.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Approval action: queue in slskd only.')).toBeInTheDocument()
  })

  it('uses the locale-specific slskd api key placeholder', async () => {
    mockGetStoredLocale.mockReturnValue('fr')
    mockGetCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'fr',
    })
    setupMocks()

    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connexions' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Destinations' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une destination' }))
    fireEvent.change(screen.getByLabelText('Catégorie'), { target: { value: 'slskd' } })

    expect(screen.getByPlaceholderText('Clé API (optionnelle)')).toBeInTheDocument()
  })

  it('allows editing an existing target from the targets tab', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([
      {
        id: 7,
        type: 'lidarr',
        name: 'Primary Lidarr',
        enabled: true,
        owned: true,
        config: { url: 'http://lidarr:8686', apiKey: '***' },
      },
    ])

    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Targets' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    const nameInput = await screen.findByDisplayValue('Primary Lidarr')
    fireEvent.change(nameInput, { target: { value: 'Updated Lidarr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(mockUpdateTargetApi).toHaveBeenCalledWith(7, {
        name: 'Updated Lidarr',
        userId: 1,
        enabled: true,
        config: {
          url: 'http://lidarr:8686',
          qualityProfileId: null,
          metadataProfileId: null,
          rootFolderId: null,
          useServerConnection: false,
        },
      })
    })
  })

  it('hides instance pickers and sends no stale IDs after the target URL changes', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([
      {
        id: 7,
        userId: 1,
        type: 'lidarr',
        name: 'Other Lidarr',
        enabled: true,
        owned: true,
        config: { url: 'http://lidarr:8686', apiKey: '***', qualityProfileId: 1 },
      },
    ])
    renderWithQuery(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Targets' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByLabelText('Quality Profile')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://new:8686' } })
    expect(screen.queryByLabelText('Quality Profile')).toBeNull()
    expect(screen.getByText(/The URL or API key changed/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(mockUpdateTargetApi).toHaveBeenCalledWith(7, {
        name: 'Other Lidarr',
        userId: 1,
        enabled: true,
        config: { url: 'http://new:8686', useServerConnection: false },
      }),
    )
  })

  it('lets an admin assign a Lidarr target to another user', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([])
    renderWithQuery(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Targets' }))
    fireEvent.click(await screen.findByText('Add Target'))
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'lidarr' } })
    await screen.findByRole('option', { name: 'listener' })
    fireEvent.change(screen.getByLabelText('Assigned user'), { target: { value: '2' } })
    // New Lidarr targets reference the server connection: no URL or key to fill in.
    expect(screen.queryByLabelText('URL')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add Target' }))
    await waitFor(() =>
      expect(mockCreateTargetApi).toHaveBeenCalledWith({
        type: 'lidarr',
        userId: 2,
        name: 'Lidarr',
        config: { useServerConnection: true },
      }),
    )
  })

  it('creates a Lidarr target for a different instance with its own URL and key', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([])
    renderWithQuery(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Targets' }))
    fireEvent.click(await screen.findByText('Add Target'))
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'lidarr' } })
    fireEvent.click(screen.getByLabelText('Use a different Lidarr instance'))
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://other:8686' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Target' }))
    await waitFor(() =>
      expect(mockCreateTargetApi).toHaveBeenCalledWith({
        type: 'lidarr',
        userId: 1,
        name: 'Lidarr',
        config: { url: 'http://other:8686', apiKey: 'key', useServerConnection: false },
      }),
    )
  })

  it('labels a server-connection Lidarr target and hides its connection fields', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([
      {
        id: 7,
        userId: 1,
        type: 'lidarr',
        name: 'Lidarr',
        enabled: true,
        owned: true,
        config: { useServerConnection: true },
      },
    ])
    renderWithQuery(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Targets' }))
    expect(await screen.findByText('(Lidarr (server connection))')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByLabelText('Use a different Lidarr instance')).not.toBeChecked()
    expect(screen.queryByLabelText('API Key')).toBeNull()
  })

  it('lets an admin edit an assigned target without exposing its saved key', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([
      {
        id: 7,
        userId: 2,
        type: 'lidarr',
        name: 'Listener Lidarr',
        enabled: true,
        owned: false,
        config: { url: 'http://lidarr:8686', apiKey: '***' },
      },
    ])
    renderWithQuery(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Targets' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByRole('option', { name: 'listener' })
    expect(screen.getByLabelText('Assigned user')).toHaveValue('2')
    expect(screen.getByLabelText('API Key')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(mockUpdateTargetApi).toHaveBeenCalledWith(7, {
        name: 'Listener Lidarr',
        userId: 2,
        enabled: true,
        config: {
          url: 'http://lidarr:8686',
          qualityProfileId: null,
          metadataProfileId: null,
          rootFolderId: null,
          useServerConnection: false,
        },
      }),
    )
  })

  it('shows ordinary users a test action without target management controls', async () => {
    setupMocks()
    mockGetCurrentUser.mockResolvedValue({
      id: 2,
      username: 'listener',
      isAdmin: false,
      preferredLocale: 'en',
    })
    mockListTargets.mockResolvedValue([
      {
        id: 7,
        userId: 2,
        type: 'lidarr',
        name: 'Listener Lidarr',
        enabled: true,
        owned: true,
        config: { url: 'http://lidarr:8686', apiKey: '***' },
      },
    ])
    renderWithQuery(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Targets' }))
    expect(await screen.findByRole('button', { name: 'Test' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Target' })).not.toBeInTheDocument()
  })
})
