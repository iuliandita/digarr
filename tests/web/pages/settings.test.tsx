// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/web/App'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getRequestLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return {
    client,
    ...render(
      <I18nProvider>
        <MemoryRouter>
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
  updateSettings: vi.fn(),
  testService: vi.fn(),
  getAuthStatus: vi.fn(),
  getLidarrProfiles: vi.fn(),
  getLidarrMetadataProfiles: vi.fn(),
  getLidarrRootFolders: vi.fn(),
  getPipelineStatus: vi.fn().mockResolvedValue({ running: false }),
  triggerPipeline: vi.fn(),
  getStoredToken: vi.fn(() => null),
  getSetupStatus: vi.fn().mockResolvedValue({ setupComplete: true }),
  listTargets: vi.fn().mockResolvedValue([]),
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
  changePassword: vi.fn().mockResolvedValue({ ok: true }),
  clearStoredToken: vi.fn(),
  logoutUser: vi.fn().mockResolvedValue({ ok: true }),
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  setStoredToken: vi.fn(),
  updatePreferredLocale: vi.fn().mockResolvedValue({ success: true, preferredLocale: 'en' }),
  AUTH_EXPIRED_EVENT: 'digarr:auth-expired',
  getUserPreferences: vi.fn().mockResolvedValue({
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
  }),
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
    sources: {},
  }),
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
  getAuthStatus,
  getCurrentUser,
  getLidarrMetadataProfiles,
  getLidarrProfiles,
  getLidarrRootFolders,
  getOAuthStatus,
  getPipelineStatus,
  getSettings,
  getStoredToken,
  importSpotifyLikedSongs,
  testService,
  updatePreferredLocale,
  updateSettings,
} from '@/web/lib/api'
import { getStoredLocale } from '@/web/lib/locale-storage'
import { SettingsPage } from '@/web/pages/settings'

const mockGetSettings = getSettings as ReturnType<typeof vi.fn>
const mockGetAuthStatus = getAuthStatus as ReturnType<typeof vi.fn>
const mockGetPipelineStatus = getPipelineStatus as ReturnType<typeof vi.fn>
const mockUpdateSettings = updateSettings as ReturnType<typeof vi.fn>
const mockTestService = testService as ReturnType<typeof vi.fn>
const mockGetLidarrProfiles = getLidarrProfiles as ReturnType<typeof vi.fn>
const mockGetLidarrMetadataProfiles = getLidarrMetadataProfiles as ReturnType<typeof vi.fn>
const mockGetLidarrRootFolders = getLidarrRootFolders as ReturnType<typeof vi.fn>
const mockGetOAuthStatus = getOAuthStatus as ReturnType<typeof vi.fn>
const mockImportSpotifyLikedSongs = importSpotifyLikedSongs as ReturnType<typeof vi.fn>
const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>
const mockGetStoredToken = getStoredToken as ReturnType<typeof vi.fn>
const mockGetStoredLocale = getStoredLocale as ReturnType<typeof vi.fn>
const mockUpdatePreferredLocale = updatePreferredLocale as ReturnType<typeof vi.fn>

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
  setupComplete: true,
}

function setupMocks() {
  mockGetSettings.mockResolvedValue(mockSettings as Record<string, unknown>)
  mockGetLidarrProfiles.mockResolvedValue([{ id: 1, name: 'Any' }])
  mockGetLidarrMetadataProfiles.mockResolvedValue([{ id: 1, name: 'Standard' }])
  mockGetLidarrRootFolders.mockResolvedValue([{ id: 1, path: '/data/music' }])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mockGetAuthStatus.mockResolvedValue({
      required: true,
      hasUsers: true,
      oidcEnabled: false,
      version: '1.0.0',
    })
    mockGetCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'en',
    })
    mockGetPipelineStatus.mockResolvedValue({ running: false })
    mockGetStoredToken.mockReturnValue('token')
    mockUpdatePreferredLocale.mockResolvedValue({ success: true, preferredLocale: 'en' })
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

    expect(await screen.findByText('Tableau de bord')).toBeInTheDocument()
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

  it('renders tab bar with Connections, Recommendations, Schedule', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Connections')).toBeInTheDocument()
    })
    expect(screen.getByText('Recommendations')).toBeInTheDocument()
    expect(screen.getByText('Schedule')).toBeInTheDocument()
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

  it('tab switching shows Recommendations content', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Connections')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Recommendations'))

    await waitFor(() => {
      expect(screen.getByText('Score Threshold')).toBeInTheDocument()
      expect(screen.getByText('Scoring Weights')).toBeInTheDocument()
    })
  })

  it('tab switching shows Schedule content', async () => {
    setupMocks()
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Connections')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Schedule'))

    await waitFor(() => {
      expect(screen.getByText('Presets')).toBeInTheDocument()
      expect(screen.getByText('Daily')).toBeInTheDocument()
      expect(screen.getByText('Weekly')).toBeInTheDocument()
      expect(screen.getByText('Custom Cron')).toBeInTheDocument()
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

  it('shows error state when settings fail to load', async () => {
    mockGetSettings.mockRejectedValue(new Error('Network error'))
    renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText(/Failed to load settings/i)).toBeInTheDocument()
    })
    expect(screen.getByText('Retry')).toBeInTheDocument()
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
      expect(screen.getByText('Connections')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Account'))

    expect(await screen.findByLabelText('Language')).toBeInTheDocument()
  })

  it('keeps account locale changes local when rendered without the app shell owner', async () => {
    setupMocks()
    const { client } = renderWithQuery(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Connections')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Account'))

    const switcher = await screen.findByLabelText('Language')
    fireEvent.change(switcher, { target: { value: 'de' } })

    expect(screen.getByLabelText('Language')).toHaveValue('de')
    expect(mockUpdatePreferredLocale).not.toHaveBeenCalled()
    expect(client.getQueryData(['currentUser'])).toEqual({
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'en',
    })
  })
})
