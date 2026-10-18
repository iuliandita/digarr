// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DASHBOARD_LAYOUT } from '@/core/dashboard-layout'
import { getRecentTracks, getTopArtists, getUserPreferences } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

function renderWithQuery(ui: ReactElement) {
  const client = createTestQueryClient()
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

vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())

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
import { createTestQueryClient } from '../helpers/query'

function mockCachedListeningRows() {
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
}

describe('Dashboard listening empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getUserPreferences).mockResolvedValue({
      dashboardLayout: { ...DEFAULT_DASHBOARD_LAYOUT, showEmpty: true },
    })
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
    fireEvent.click(screen.getByRole('button', { name: 'Recently Played' }))
    expect(
      await screen.findByText(
        'Listening history could not be loaded. Check your connections or try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('No recent plays')).not.toBeInTheDocument()
  })
  it.each(['request', 'source'])(
    'retains both views on %s failure and retries',
    async (failure) => {
      mockCachedListeningRows()
      const { client } = renderWithQuery(<Dashboard />)
      await screen.findByText('Cached artist')
      fireEvent.click(screen.getByRole('button', { name: 'Recently Played' }))
      await screen.findByText('Cached track')
      if (failure === 'request') {
        vi.mocked(getTopArtists).mockRejectedValue(new Error('Refresh failed'))
        vi.mocked(getRecentTracks).mockRejectedValue(new Error('Refresh failed'))
      } else {
        vi.mocked(getTopArtists).mockResolvedValue({
          tracks: [],
          total: 0,
          offset: 0,
          limit: 5,
          source: null,
          status: 'error',
        })
        vi.mocked(getRecentTracks).mockResolvedValue({
          tracks: [],
          hasSource: true,
          source: null,
          status: 'error',
        })
      }
      await act(async () => {
        await Promise.all([
          client.refetchQueries({ queryKey: ['dashboard-top-artists'] }),
          client.refetchQueries({ queryKey: ['dashboard-recent-tracks'] }),
        ])
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Listening history could not be loaded',
      )
      expect(screen.getByText('Cached track')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Top artists' }))
      expect(screen.getByText('Cached artist')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Listening history could not be loaded')
      vi.mocked(getTopArtists).mockResolvedValue({
        tracks: [{ artist: 'Updated artist', track: '15 plays', source: 'listenbrainz' }],
        total: 1,
        offset: 0,
        limit: 5,
        source: 'listenbrainz',
        status: 'ok',
      })
      vi.mocked(getRecentTracks).mockResolvedValue({
        tracks: [
          { artist: 'Updated recent artist', track: 'Updated track', source: 'listenbrainz' },
        ],
        hasSource: true,
        source: 'listenbrainz',
        status: 'ok',
      })
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await screen.findByText('Updated artist')
      fireEvent.click(screen.getByRole('button', { name: 'Recently Played' }))
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await screen.findByText('Updated track')
      expect(screen.queryAllByRole('alert')).toHaveLength(0)
    },
  )

  it.each(['empty', 'not_configured'] as const)(
    'replaces both cached views after a successful %s refresh',
    async (status) => {
      mockCachedListeningRows()
      const { client } = renderWithQuery(<Dashboard />)
      await screen.findByText('Cached artist')
      vi.mocked(getTopArtists).mockResolvedValue({
        tracks: [],
        total: 0,
        offset: 0,
        limit: 5,
        source: status === 'empty' ? 'listenbrainz' : null,
        status,
      })
      vi.mocked(getRecentTracks).mockResolvedValue({
        tracks: [],
        hasSource: status === 'empty',
        source: status === 'empty' ? 'listenbrainz' : null,
        status,
      })
      await act(async () => {
        await Promise.all([
          client.refetchQueries({ queryKey: ['dashboard-top-artists'] }),
          client.refetchQueries({ queryKey: ['dashboard-recent-tracks'] }),
        ])
      })
      await waitFor(() => expect(screen.queryByText('Cached artist')).not.toBeInTheDocument())
      expect(
        screen.getByText(
          status === 'empty'
            ? 'No listening history for this period. Try another period.'
            : 'Connect an account',
        ),
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Recently Played' }))
      expect(screen.getByText('No recent plays')).toBeInTheDocument()
      expect(screen.queryByText('Cached track')).not.toBeInTheDocument()
      expect(screen.queryAllByRole('alert')).toHaveLength(0)
    },
  )
})
