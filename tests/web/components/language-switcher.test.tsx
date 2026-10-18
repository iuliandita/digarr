// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/web/App'
import { AuthGate } from '@/web/components/auth-gate'
import { I18nProvider } from '@/web/lib/i18n'
import { queryClient } from '@/web/lib/query-client'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

const legacyAuthMocks = vi.hoisted(() => ({
  getLegacyStoredToken: vi.fn(),
}))

vi.mock('@/web/lib/api', () => ({
  getPersonalNotificationChannels: vi.fn().mockResolvedValue({ channels: [] }),
  updatePersonalNotificationChannels: vi.fn(),
  AUTH_EXPIRED_EVENT: 'digarr:auth-expired',
  clearStoredToken: vi.fn(),
  changePassword: vi.fn().mockResolvedValue({ ok: true }),
  createTargetApi: vi.fn(),
  deleteTargetApi: vi.fn().mockResolvedValue(undefined),
  disconnectOAuth: vi.fn().mockResolvedValue(undefined),
  getAuthStatus: vi.fn(),
  getCurrentUser: vi.fn(),
  getOAuthStatus: vi.fn().mockResolvedValue({ connected: false, scopes: null }),
  getPipelineStatus: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({
    lidarrUrl: 'http://localhost:8686',
    lidarrApiKey: '***',
    preferences: { scoreThreshold: 0.5 },
    setupComplete: true,
  }),
  getSetupStatus: vi.fn(),
  getLegacyStoredToken: legacyAuthMocks.getLegacyStoredToken,
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
  migrateLegacySession: vi.fn(),
  registerUser: vi.fn(),
  testService: vi.fn(),
  testTargetApi: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  testNotificationChannel: vi.fn(),
  triggerPipeline: vi.fn(),
  updatePreferredLocale: vi.fn(),
  updateSettings: vi.fn(),
  updateUserPreferences: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())

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
  updatePreferredLocale,
} from '@/web/lib/api'
import { getStoredLocale, setStoredLocale } from '@/web/lib/locale-storage'
import { createTestQueryClient } from '../helpers/query'

const mockGetAuthStatus = getAuthStatus as ReturnType<typeof vi.fn>
const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>
const mockGetPipelineStatus = getPipelineStatus as ReturnType<typeof vi.fn>
const mockGetSetupStatus = getSetupStatus as ReturnType<typeof vi.fn>
const mockGetLegacyStoredToken = legacyAuthMocks.getLegacyStoredToken
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
  const client = createTestQueryClient()

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

function chooseLanguage(switcher: HTMLElement, name: string) {
  fireEvent.click(switcher)
  fireEvent.click(screen.getByRole('menuitemradio', { name }))
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
    mockGetLegacyStoredToken.mockReturnValue(null)
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

  it('keeps unauthenticated locale changes local and updates stored locale', async () => {
    renderWithProviders(
      <AuthGate>
        <div>app</div>
      </AuthGate>,
    )

    const switcher = await screen.findByLabelText('Language')
    chooseLanguage(switcher, 'Deutsch')

    await waitFor(() => {
      expect(switcher).toHaveAttribute('title', 'Deutsch')
    })
    expect(mockSetStoredLocale).toHaveBeenCalledWith('de')
    expect(mockUpdatePreferredLocale).not.toHaveBeenCalled()
  })

  it('persists authenticated locale changes without snapping back to stale account data', async () => {
    mockGetAuthStatus.mockResolvedValue({
      required: true,
      hasUsers: true,
      authenticated: true,
      oidcEnabled: false,
    })
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
    chooseLanguage(switcher, 'Deutsch')
    await waitFor(() => {
      expect(switcher).toHaveAttribute('title', 'Deutsch')
    })

    userRequest.resolve({
      id: 1,
      username: 'admin',
      isAdmin: true,
      preferredLocale: 'en',
    })

    await waitFor(() => {
      expect(switcher).toHaveAttribute('title', 'Deutsch')
    })

    localeRequest.resolve({ success: true, preferredLocale: 'de' })

    await waitFor(() => {
      expect(mockUpdatePreferredLocale.mock.calls[0]?.[0]).toBe('de')
    })
    await waitFor(() => {
      expect(switcher).toHaveAttribute('title', 'Deutsch')
    })
  })
})
