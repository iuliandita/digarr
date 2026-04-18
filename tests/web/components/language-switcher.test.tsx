// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/web/App'
import { AuthGate } from '@/web/components/auth-gate'
import { LanguageSwitcher } from '@/web/components/language-switcher'
import { I18nProvider } from '@/web/lib/i18n'
import { queryClient } from '@/web/lib/query-client'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getRequestLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

vi.mock('@/web/lib/api', () => ({
  AUTH_EXPIRED_EVENT: 'digarr:auth-expired',
  clearStoredToken: vi.fn(),
  changePassword: vi.fn().mockResolvedValue({ ok: true }),
  createTargetApi: vi.fn(),
  deleteTargetApi: vi.fn().mockResolvedValue(undefined),
  disconnectOAuth: vi.fn().mockResolvedValue(undefined),
  getAuthStatus: vi.fn(),
  getCurrentUser: vi.fn(),
  getLidarrMetadataProfiles: vi.fn().mockResolvedValue([]),
  getLidarrProfiles: vi.fn().mockResolvedValue([]),
  getLidarrRootFolders: vi.fn().mockResolvedValue([]),
  getOAuthStatus: vi.fn().mockResolvedValue({ connected: false, scopes: null }),
  getPipelineStatus: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({
    lidarrUrl: 'http://localhost:8686',
    lidarrApiKey: '***',
    preferences: { scoreThreshold: 0.5 },
    setupComplete: true,
  }),
  getSetupStatus: vi.fn(),
  getStoredToken: vi.fn(),
  getUserPreferences: vi.fn().mockResolvedValue({
    scoreThreshold: 0.5,
    scoringWeights: {
      consensus: 0.3,
      similarity: 0.25,
      genreOverlap: 0.2,
      aiConfidence: 0.15,
      feedbackBoost: 0.1,
      popularity: 0,
    },
    rejectionCooldownDays: 90,
    topArtistsLimit: 30,
    librarySeedRatio: 0.3,
  }),
  importSpotifyLikedSongs: vi.fn().mockResolvedValue({
    message: 'started',
    subscriptionId: 1,
    created: true,
  }),
  importSpotifyPlaylist: vi.fn(),
  initiateOAuth: vi.fn().mockResolvedValue({ authUrl: '' }),
  listTargets: vi.fn().mockResolvedValue([]),
  loginUser: vi.fn(),
  logoutUser: vi.fn(),
  registerUser: vi.fn(),
  setStoredToken: vi.fn(),
  testService: vi.fn(),
  testTargetApi: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  testWebhook: vi.fn(),
  triggerPipeline: vi.fn(),
  updatePreferredLocale: vi.fn(),
  updateSettings: vi.fn(),
  updateUserPreferences: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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

vi.mock('@/web/hooks/use-click-outside', () => ({
  useClickOutside: vi.fn(),
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

vi.mock('@/web/pages/analytics', () => ({ AnalyticsPage: () => <div>analytics</div> }))
vi.mock('@/web/pages/dashboard', () => ({ Dashboard: () => <div>dashboard</div> }))
vi.mock('@/web/pages/discover', () => ({ DiscoverPage: () => <div>discover</div> }))
vi.mock('@/web/pages/genre-detail', () => ({ GenreDetailPage: () => <div>genre detail</div> }))
vi.mock('@/web/pages/genres', () => ({ GenresPage: () => <div>genres</div> }))
vi.mock('@/web/pages/job-history', () => ({ default: () => <div>jobs</div> }))
vi.mock('@/web/pages/library-health', () => ({
  LibraryHealthPage: () => <div>library health</div>,
}))
vi.mock('@/web/pages/library-reconciliation', () => ({
  LibraryReconciliationPage: () => <div>library reconciliation</div>,
}))
vi.mock('@/web/pages/playlist-detail', () => ({
  PlaylistDetailPage: () => <div>playlist detail</div>,
}))
vi.mock('@/web/pages/playlists', () => ({ PlaylistsPage: () => <div>playlists</div> }))
vi.mock('@/web/pages/search', () => ({ SearchPage: () => <div>search</div> }))
vi.mock('@/web/pages/settings', async () => {
  const actual =
    await vi.importActual<typeof import('@/web/pages/settings')>('@/web/pages/settings')
  return actual
})
vi.mock('@/web/pages/setup', () => ({ SetupWizard: () => <div>setup</div> }))
vi.mock('@/web/pages/subscriptions', () => ({ default: () => <div>subscriptions</div> }))
vi.mock('@/web/pages/user-management', () => ({
  UserManagementPage: () => <div>users</div>,
}))

import {
  getAuthStatus,
  getCurrentUser,
  getPipelineStatus,
  getSetupStatus,
  getStoredToken,
  updatePreferredLocale,
} from '@/web/lib/api'
import { getStoredLocale, setStoredLocale } from '@/web/lib/locale-storage'

const mockGetAuthStatus = getAuthStatus as ReturnType<typeof vi.fn>
const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>
const mockGetPipelineStatus = getPipelineStatus as ReturnType<typeof vi.fn>
const mockGetSetupStatus = getSetupStatus as ReturnType<typeof vi.fn>
const mockGetStoredToken = getStoredToken as ReturnType<typeof vi.fn>
const mockGetStoredLocale = getStoredLocale as ReturnType<typeof vi.fn>
const mockUpdatePreferredLocale = updatePreferredLocale as ReturnType<typeof vi.fn>
const mockSetStoredLocale = setStoredLocale as ReturnType<typeof vi.fn>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return {
    client,
    ...render(
      <I18nProvider>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </I18nProvider>,
    ),
  }
}

function renderWithAppShell() {
  return renderWithProviders(<App />)
}

describe('language switcher surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
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
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
      }),
    })
    mockGetStoredToken.mockReturnValue(null)
    mockGetStoredLocale.mockReturnValue('en')
    mockGetAuthStatus.mockResolvedValue({
      required: true,
      hasUsers: true,
      oidcEnabled: false,
    })
    mockGetCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'en',
    })
    mockGetPipelineStatus.mockResolvedValue({ running: false })
    mockGetSetupStatus.mockResolvedValue({ setupComplete: true })
    mockUpdatePreferredLocale.mockResolvedValue({ success: true, preferredLocale: 'en' })
  })

  it('renders a language switcher under the login form', async () => {
    renderWithProviders(
      <AuthGate>
        <div>app</div>
      </AuthGate>,
    )

    expect(await screen.findByLabelText('Language')).toBeInTheDocument()
  })

  it('uses translated registration copy in French', async () => {
    mockGetAuthStatus.mockResolvedValue({
      required: true,
      hasUsers: false,
      oidcEnabled: false,
    })
    mockGetStoredToken.mockReturnValue(null)
    mockGetStoredLocale.mockReturnValue('fr')

    renderWithProviders(
      <AuthGate>
        <div>app</div>
      </AuthGate>,
    )

    expect(await screen.findByRole('button', { name: 'Créer un compte' })).toBeInTheDocument()
    expect(screen.getByText('Vous avez déjà un compte ? Se connecter')).toBeInTheDocument()
  })

  it('uses translated SSO copy in French', async () => {
    mockGetAuthStatus.mockResolvedValue({
      required: true,
      hasUsers: true,
      oidcEnabled: true,
    })
    mockGetStoredToken.mockReturnValue(null)
    mockGetStoredLocale.mockReturnValue('fr')

    renderWithProviders(
      <AuthGate>
        <div>app</div>
      </AuthGate>,
    )

    expect(await screen.findByRole('link', { name: 'Connectez-vous avec SSO' })).toBeInTheDocument()
  })

  it('renders a language switcher in the top bar for authenticated users', async () => {
    mockGetStoredToken.mockReturnValue('token')
    renderWithAppShell()

    expect(await screen.findByLabelText('Language')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Run Scan|Scan/i })).toBeInTheDocument()
  })

  it('keeps unauthenticated locale changes local and updates stored locale', async () => {
    renderWithProviders(
      <AuthGate>
        <div>app</div>
      </AuthGate>,
    )

    const switcher = await screen.findByLabelText('Language')
    fireEvent.change(switcher, { target: { value: 'de' } })

    expect(switcher).toHaveValue('de')
    expect(mockSetStoredLocale).toHaveBeenCalledWith('de')
    expect(mockUpdatePreferredLocale).not.toHaveBeenCalled()
  })

  it('translates the language switcher label for the active locale', () => {
    mockGetStoredLocale.mockReturnValue('fr')

    renderWithProviders(<LanguageSwitcher value="fr" onChange={vi.fn()} />)

    expect(screen.getByText('Langue')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Langue' })).toBeInTheDocument()
  })

  it('persists authenticated locale changes without snapping back to stale account data', async () => {
    mockGetStoredToken.mockReturnValue('token')
    const userRequest = deferred<{
      id: number
      username: string
      isAdmin: boolean
      preferredLocale: string | null
    }>()
    const localeRequest = deferred<{ success: true; preferredLocale: string | null }>()
    mockGetCurrentUser.mockReturnValue(userRequest.promise)
    mockUpdatePreferredLocale.mockReturnValue(localeRequest.promise)

    renderWithAppShell()

    const switcher = await screen.findByLabelText('Language')
    fireEvent.change(switcher, { target: { value: 'de' } })
    await waitFor(() => {
      expect(switcher).toHaveValue('de')
    })

    userRequest.resolve({
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'en',
    })

    await waitFor(() => {
      expect(switcher).toHaveValue('de')
    })

    localeRequest.resolve({ success: true, preferredLocale: 'de' })

    await waitFor(() => {
      expect(mockUpdatePreferredLocale.mock.calls[0]?.[0]).toBe('de')
    })
    await waitFor(() => {
      expect(switcher).toHaveValue('de')
    })
  })
})
