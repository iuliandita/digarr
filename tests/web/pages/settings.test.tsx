// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

vi.mock('@/web/lib/api', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  testService: vi.fn(),
  getLidarrProfiles: vi.fn(),
  getLidarrMetadataProfiles: vi.fn(),
  getLidarrRootFolders: vi.fn(),
  triggerPipeline: vi.fn(),
  getStoredToken: vi.fn(() => null),
  listTargets: vi.fn().mockResolvedValue([]),
  deleteTargetApi: vi.fn().mockResolvedValue(undefined),
  testTargetApi: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  exportRecommendations: vi.fn().mockResolvedValue(undefined),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 1, username: 'admin', isAdmin: true }),
  getOAuthStatus: vi.fn().mockResolvedValue({ connected: false, scopes: null }),
  importSpotifyLikedSongs: vi.fn().mockResolvedValue({
    message: 'started',
    subscriptionId: 1,
    created: true,
  }),
  initiateOAuth: vi.fn().mockResolvedValue({ authUrl: '' }),
  disconnectOAuth: vi.fn().mockResolvedValue(undefined),
  changePassword: vi.fn().mockResolvedValue({ ok: true }),
  logoutUser: vi.fn().mockResolvedValue({ ok: true }),
  clearStoredToken: vi.fn(),
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
  updateUserPreferences: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    promise: vi.fn(),
  },
}))

import {
  getLidarrMetadataProfiles,
  getLidarrProfiles,
  getLidarrRootFolders,
  getOAuthStatus,
  getSettings,
  importSpotifyLikedSongs,
  testService,
  updateSettings,
} from '@/web/lib/api'
import { SettingsPage } from '@/web/pages/settings'

const mockGetSettings = getSettings as ReturnType<typeof vi.fn>
const mockUpdateSettings = updateSettings as ReturnType<typeof vi.fn>
const mockTestService = testService as ReturnType<typeof vi.fn>
const mockGetLidarrProfiles = getLidarrProfiles as ReturnType<typeof vi.fn>
const mockGetLidarrMetadataProfiles = getLidarrMetadataProfiles as ReturnType<typeof vi.fn>
const mockGetLidarrRootFolders = getLidarrRootFolders as ReturnType<typeof vi.fn>
const mockGetOAuthStatus = getOAuthStatus as ReturnType<typeof vi.fn>
const mockImportSpotifyLikedSongs = importSpotifyLikedSongs as ReturnType<typeof vi.fn>

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
      expect(screen.getByText('Lidarr')).toBeInTheDocument()
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
      expect(screen.getByText('Lidarr')).toBeInTheDocument()
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
      expect(screen.getByText('Lidarr')).toBeInTheDocument()
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
})
