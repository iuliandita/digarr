// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRecentTracks, getTopArtists } from '@/web/lib/api'
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
    ...render(
      <QueryClientProvider client={client}>
        <I18nProvider>{ui}</I18nProvider>
      </QueryClientProvider>,
    ),
    client,
  }
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    promise: vi.fn(),
  },
}))

vi.mock('@/web/lib/api', () => ({
  getRecommendations: vi.fn(async () => ({ items: [], total: 0 })),
  updateRecommendation: vi.fn(),
  approveRecommendation: vi.fn().mockResolvedValue({}),
  approveToTarget: vi.fn().mockResolvedValue({}),
  getPopularAlbumsAvailability: vi
    .fn()
    .mockResolvedValue({ available: true, spotify: true, lastfm: false }),
  listTargets: vi.fn().mockResolvedValue([]),
  getTopArtists: vi.fn(async () => ({
    tracks: [],
    total: 0,
    offset: 0,
    limit: 5,
    source: null,
  })),
  getRecentTracks: vi.fn(async () => ({ tracks: [], hasSource: false, source: null })),
  getSubscriptions: vi.fn(async () => []),
  getSchedulerInfo: vi.fn(async () => ({ jobs: [] })),
  getDashboardTaste: vi.fn(async () => []),
  getDashboardGenreCoverage: vi.fn(async () => null),
  getDashboardActivity: vi.fn(async () => []),
  triggerPipeline: vi.fn(),
  rescanArtists: vi.fn().mockResolvedValue({ updated: 0, total: 0 }),
  moodDiscover: vi.fn(),
  quickDiscover: vi.fn(),
  getPipelineStatus: vi.fn(async () => ({ running: false })),
  getUserPreferences: vi.fn().mockResolvedValue({ dismissedHints: [] }),
  getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true, isAdmin: false }),
  updateUserPreferences: vi.fn().mockResolvedValue({}),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 1, username: 'user', isAdmin: false }),
  getJobHealth: vi.fn().mockResolvedValue({
    pipeline: { status: 'ok', lastRun: null, nextRun: null },
    subscriptions: { status: 'ok', healthy: 0, total: 0 },
    playlists: { status: 'ok', lastRun: null },
    sources: {},
  }),
}))

vi.mock('@/web/lib/hooks', () => ({
  useSSE: vi.fn(() => ({ data: null, connected: false })),
}))

import { Dashboard } from '@/web/pages/dashboard'

describe('Dashboard listening empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTopArtists).mockResolvedValue({
      tracks: [],
      total: 0,
      offset: 0,
      limit: 5,
      source: null,
      status: 'not_configured',
    })
    vi.mocked(getRecentTracks).mockResolvedValue({
      tracks: [],
      hasSource: false,
      source: null,
      status: 'not_configured',
    })
  })

  it('mentions only the listening sources used by the card', async () => {
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Connect your Last\.fm or ListenBrainz account/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Spotify/i)).not.toBeInTheDocument()
  })
  it('shows empty-period guidance for a connected account', async () => {
    vi.mocked(getTopArtists).mockResolvedValue({
      tracks: [],
      total: 0,
      offset: 0,
      limit: 5,
      source: 'listenbrainz',
      status: 'empty',
    })
    renderWithQuery(<Dashboard />)
    expect(
      await screen.findByText('No listening history for this period. Try another period.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Connect an account')).not.toBeInTheDocument()
  })

  it('reports a source failure without a connect prompt', async () => {
    vi.mocked(getTopArtists).mockResolvedValue({
      tracks: [],
      total: 0,
      offset: 0,
      limit: 5,
      source: null,
      status: 'error',
    })
    renderWithQuery(<Dashboard />)
    expect(
      await screen.findByText(
        'Listening history could not be loaded. Check your connections or try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Connect an account')).not.toBeInTheDocument()
    vi.mocked(getTopArtists).mockResolvedValue({
      tracks: [],
      total: 0,
      offset: 0,
      limit: 5,
      source: 'listenbrainz',
      status: 'empty',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByText('No listening history for this period. Try another period.'),
    ).toBeInTheDocument()
  })

  it('reports a request failure instead of asking to connect', async () => {
    vi.mocked(getTopArtists).mockRejectedValue(new Error('Network unavailable'))
    renderWithQuery(<Dashboard />)
    expect(
      await screen.findByText(
        'Listening history could not be loaded. Check your connections or try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Connect an account')).not.toBeInTheDocument()
  })

  it('does not ask to connect while history is loading', () => {
    vi.mocked(getTopArtists).mockReturnValue(new Promise(() => {}))
    renderWithQuery(<Dashboard />)
    expect(screen.queryByText('Connect an account')).not.toBeInTheDocument()
  })

  it('shows a recent-history failure instead of an empty history', async () => {
    vi.mocked(getRecentTracks).mockResolvedValue({
      tracks: [],
      hasSource: true,
      source: null,
      status: 'error',
    })
    renderWithQuery(<Dashboard />)
    expect(
      await screen.findByText(
        'Listening history could not be loaded. Check your connections or try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('No recent plays')).not.toBeInTheDocument()
  })
  it('keeps cached listening rows visible when refresh fails', async () => {
    vi.mocked(getTopArtists).mockResolvedValue({
      tracks: [{ artist: 'Cached artist', track: '12 plays', source: 'listenbrainz' }],
      total: 1,
      offset: 0,
      limit: 5,
      source: 'listenbrainz',
      status: 'ok',
    })
    vi.mocked(getRecentTracks).mockResolvedValue({
      tracks: [{ artist: 'Recent artist', track: 'Cached track', source: 'listenbrainz' }],
      hasSource: true,
      source: 'listenbrainz',
      status: 'ok',
    })
    const { client } = renderWithQuery(<Dashboard />)
    await screen.findByText('Cached artist')
    await screen.findByText('Cached track')
    vi.mocked(getTopArtists).mockRejectedValue(new Error('Refresh failed'))
    vi.mocked(getRecentTracks).mockRejectedValue(new Error('Refresh failed'))
    await act(async () => {
      await Promise.all([
        client.refetchQueries({ queryKey: ['dashboard-top-artists'] }),
        client.refetchQueries({ queryKey: ['dashboard-recent-tracks'] }),
      ])
    })
    expect(
      await screen.findAllByText(
        'Listening history could not be loaded. Check your connections or try again.',
      ),
    ).toHaveLength(2)
    expect(screen.getByText('Cached artist')).toBeInTheDocument()
    expect(screen.getByText('Cached track')).toBeInTheDocument()
  })
})
