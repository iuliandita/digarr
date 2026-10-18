// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DASHBOARD_LAYOUT } from '@/core/dashboard-layout'
import { DashboardCardToggle } from '@/web/components/dashboard-card-toggle'
import { I18nProvider } from '@/web/lib/i18n'

function renderWithQuery(ui: ReactElement) {
  const client = createTestQueryClient()
  return {
    ...render(
      <I18nProvider>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </I18nProvider>,
    ),
    client,
  }
}

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())

vi.mock('@/web/components/pipeline-progress', () => ({
  PipelineProgress: ({ onComplete }: { onComplete?: () => void }) => (
    <button type="button" data-testid="complete-pipeline" onClick={onComplete}>
      Complete pipeline
    </button>
  ),
}))

vi.mock('@/web/lib/api', () => ({
  getRecommendations: vi.fn(),
  updateRecommendation: vi.fn(),
  approveRecommendation: vi.fn().mockResolvedValue({}),
  approveToTarget: vi.fn().mockResolvedValue({}),
  getPopularAlbums: vi.fn(),
  getPopularAlbumsAvailability: vi
    .fn()
    .mockResolvedValue({ available: true, spotify: true, lastfm: false }),
  deletePlaylistApi: vi.fn(),
  generatePlaylistApi: vi.fn(),
  listTargets: vi.fn().mockResolvedValue([]),
  getTopArtists: vi.fn(),
  getRecentTracks: vi.fn(),
  getSubscriptions: vi.fn(),
  getSchedulerInfo: vi.fn(),
  getDashboardTaste: vi.fn(),
  getDashboardGenreCoverage: vi.fn(),
  triggerPipeline: vi.fn(),
  rescanArtists: vi.fn().mockResolvedValue({ updated: 0, total: 0 }),
  moodDiscover: vi.fn(),
  quickDiscover: vi.fn(),
  getPipelineStatus: vi.fn(),
  getUserPreferences: vi.fn().mockResolvedValue({ dismissedHints: [] }),
  getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true, isAdmin: false }),
  updatePlaylistApi: vi.fn(),
  updateUserPreferences: vi.fn().mockResolvedValue({}),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 1, username: 'admin', isAdmin: false }),
  getJobHealth: vi.fn().mockResolvedValue({
    pipeline: { status: 'ok', lastRun: null, nextRun: null },
    subscriptions: { status: 'ok', healthy: 0, total: 0 },
    playlists: { status: 'ok', lastRun: null },
    sources: {},
  }),
}))

// Mock useSSE to avoid EventSource in jsdom
vi.mock('@/web/lib/hooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/web/lib/hooks')>()
  return {
    ...original,
    useSSE: vi.fn(() => ({ data: null, connected: false })),
  }
})

import { PlaylistCard } from '@/web/components/playlist-card'
import {
  approveRecommendation,
  approveToTarget,
  getAuthStatus,
  getDashboardGenreCoverage,
  getDashboardTaste,
  getPipelineStatus,
  getRecentTracks,
  getRecommendations,
  getSchedulerInfo,
  getSubscriptions,
  getTopArtists,
  getUserPreferences,
  listTargets,
  rescanArtists,
  updateUserPreferences,
} from '@/web/lib/api'
import { Dashboard } from '@/web/pages/dashboard'
import { createTestQueryClient } from '../helpers/query'
import { installMemoryLocalStorage } from '../helpers/storage'

const mockApproveToTarget = vi.mocked(approveToTarget)
const mockApproveRecommendation = vi.mocked(approveRecommendation)
const mockGetRecommendations = vi.mocked(getRecommendations)
const mockGetTopArtists = vi.mocked(getTopArtists)
const mockGetRecentTracks = vi.mocked(getRecentTracks)
const mockGetSubscriptions = vi.mocked(getSubscriptions)
const mockGetSchedulerInfo = vi.mocked(getSchedulerInfo)
const mockGetDashboardTaste = vi.mocked(getDashboardTaste)
const mockGetDashboardGenreCoverage = vi.mocked(getDashboardGenreCoverage)
const mockGetPipelineStatus = vi.mocked(getPipelineStatus)
const mockListTargets = vi.mocked(listTargets)

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const pendingRec = {
  id: 1,
  score: 0.85,
  status: 'pending',
  aiReasoning: 'Great post-rock vibes',
  artist: {
    id: 10,
    name: 'Sigur Ros',
    genres: ['post-rock', 'ambient'],
    imageUrl: null,
    streamingUrls: null,
  },
}

const approvedRec = {
  id: 2,
  score: 0.78,
  status: 'approved',
  artist: {
    id: 11,
    name: 'Slowdive',
    genres: ['shoegaze'],
    imageUrl: 'https://example.com/slowdive.jpg',
    streamingUrls: null,
  },
}

const addFailedRec = {
  id: 3,
  score: 0.72,
  status: 'add_failed',
  artist: {
    id: 12,
    name: 'Alcest',
    genres: ['blackgaze'],
    imageUrl: 'https://example.com/alcest.jpg',
    streamingUrls: null,
  },
}

function setupMocks() {
  mockGetRecommendations.mockImplementation((params) => {
    const p = params as Record<string, string> | undefined
    if (p?.status === 'pending') {
      return Promise.resolve({ items: [pendingRec], total: 1 })
    }
    if (p?.status?.includes('approved')) {
      return Promise.resolve({ items: [approvedRec], total: 1 })
    }
    return Promise.resolve({ items: [], total: 0 })
  })

  mockGetTopArtists.mockResolvedValue({
    tracks: [
      {
        artist: 'Bon Iver',
        track: '42 plays this month',
        source: 'listenbrainz',
        mbid: 'mbid-bon-iver',
      },
    ],
    total: 1,
    offset: 0,
    limit: 5,
    source: 'listenbrainz',
    status: 'ok',
  })

  mockGetRecentTracks.mockResolvedValue({
    tracks: [{ artist: 'Bon Iver', track: 'Holocene', source: 'listenbrainz' }],
    hasSource: true,
    source: 'listenbrainz',
    status: 'ok',
  })

  mockGetSubscriptions.mockResolvedValue([
    {
      id: 1,
      name: 'Rock Discovery',
      enabled: true,
      lastResultCount: 5,
    },
  ] as never)

  mockGetSchedulerInfo.mockResolvedValue({
    jobs: [{ name: 'subscription-1', expression: '0 9 * * *', nextRun: null }],
  })

  mockGetDashboardTaste.mockResolvedValue([
    { genre: 'post-rock', count: 10, percentage: 40 },
    { genre: 'shoegaze', count: 5, percentage: 20 },
  ])
  mockGetDashboardGenreCoverage.mockResolvedValue({
    coveredArtists: 18,
    pendingArtists: 4,
    totalArtists: 25,
  })

  mockGetPipelineStatus.mockResolvedValue({ running: false })
  mockListTargets.mockResolvedValue([])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getUserPreferences).mockResolvedValue({ dismissedHints: [] })
    vi.mocked(updateUserPreferences).mockResolvedValue(undefined)
    installMemoryLocalStorage()
  })

  it("approves today's pick with popular albums from the approve menu", async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)

    await screen.findByText('Sigur Ros')

    fireEvent.click(screen.getByLabelText('Monitoring options'))
    fireEvent.click(screen.getByText('Popular albums'))

    await waitFor(() => {
      expect(mockApproveRecommendation).toHaveBeenCalledWith(1, { monitorOption: 'popular' })
    })
  })

  it('switches between top artists and recent plays', async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('42 plays this month')).toBeInTheDocument()
      expect(screen.getAllByText('Bon Iver').length).toBeGreaterThan(0)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Recently Played' }))
    expect(await screen.findByText('Holocene')).toBeInTheDocument()
    expect(screen.queryByText('42 plays this month')).not.toBeInTheDocument()
  })

  it('renders listening genre coverage and pending enrichment', async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)

    expect(await screen.findByText('Genre data available: 18/25')).toBeInTheDocument()
    expect(screen.getByText('Pending genre data updates: 4')).toBeInTheDocument()
  })

  it('refreshes genre coverage when the pipeline completes', async () => {
    setupMocks()
    const { client } = renderWithQuery(<Dashboard />)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fireEvent.click(screen.getByTestId('complete-pipeline'))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard-genre-coverage'] })
  })

  it('shows your approved and rejected decisions through the All toggle', async () => {
    setupMocks()
    mockGetRecommendations.mockImplementation((params) => {
      if (params?.status === 'pending') return Promise.resolve({ items: [pendingRec], total: 1 })
      if (params?.status === 'added_to_lidarr,add_failed,approved,rejected')
        return Promise.resolve({
          items: [
            {
              ...approvedRec,
              actedOnAt: '2026-01-01T00:00:00Z',
              artist: { ...approvedRec.artist, name: 'Mogwai' },
            },
            {
              ...approvedRec,
              id: 99,
              status: 'rejected',
              actedOnAt: '2026-01-02T00:00:00Z',
              artist: { ...approvedRec.artist, name: 'Rejected artist' },
            },
          ],
          total: 2,
        })
      return Promise.resolve({ items: [approvedRec], total: 1 })
    })
    renderWithQuery(<Dashboard />)
    const card = await screen.findByRole('region', { name: 'Your decisions' })
    fireEvent.click(within(card).getByRole('button', { name: 'All' }))
    expect(await screen.findByText('Approved Mogwai')).toBeInTheDocument()
    expect(screen.getByText('Rejected Rejected artist')).toBeInTheDocument()
  })

  it('shows the pick empty state when Show empty cards is enabled', async () => {
    setupMocks()
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })
    vi.mocked(getUserPreferences).mockResolvedValue({
      dashboardLayout: { ...DEFAULT_DASHBOARD_LAYOUT, showEmpty: true },
    })
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText(/No pending recommendations/i)).toBeInTheDocument()
    })
  })

  it('shows Run Scan button in empty state', async () => {
    setupMocks()
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Run Scan')).toBeInTheDocument()
    })
  })

  it('formats playlist dates with the active locale helper', () => {
    localStorage.setItem('digarr-locale', 'de')

    renderWithQuery(
      <PlaylistCard
        playlist={{
          id: 7,
          userId: 1,
          name: 'Weekend Mix',
          strategy: 'weekly_digest',
          schedule: '0 8 * * 1',
          enabled: true,
          targetIds: [],
          trackCount: 18,
          lastGeneratedAt: '2026-02-11T10:30:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          config: { size: 25, trackSourcePriority: ['local', 'spotify', 'deezer'] },
        }}
        onEdit={vi.fn()}
        onRefetch={vi.fn()}
      />,
    )

    expect(screen.getByText(/11\./)).toBeInTheDocument()
  })

  it('does not fire an image rescan when an admin opens the dashboard', async () => {
    setupMocks()
    vi.mocked(getAuthStatus).mockResolvedValue({
      required: true,
      hasUsers: true,
      authenticated: true,
      isAdmin: true,
    })
    renderWithQuery(<Dashboard />)

    await screen.findByText('Sigur Ros')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rescanArtists).not.toHaveBeenCalled()
  })

  it('explains an empty approved view when rejected decisions exist instead of drawing placeholder tiles', async () => {
    setupMocks()
    mockGetRecommendations.mockImplementation((params) => {
      const p = params as Record<string, string> | undefined
      if (p?.status === 'added_to_lidarr,add_failed,approved,rejected')
        return Promise.resolve({
          items: [{ ...approvedRec, status: 'rejected', actedOnAt: '2026-01-01T00:00:00Z' }],
          total: 1,
        })
      if (p?.status === 'pending') return Promise.resolve({ items: [pendingRec], total: 1 })
      return Promise.resolve({ items: [], total: 0 })
    })

    renderWithQuery(<Dashboard />)

    expect(
      await screen.findByText('Nothing approved yet. Artists you approve show up here.'),
    ).toBeInTheDocument()
  })

  it('shows add_failed recommendations in Recently Approved', async () => {
    setupMocks()
    mockGetRecommendations.mockImplementation((params) => {
      const p = params as Record<string, string> | undefined
      if (p?.status === 'pending') {
        return Promise.resolve({ items: [pendingRec], total: 1 })
      }
      if (p?.status === 'added_to_lidarr,add_failed,approved,waiting') {
        return Promise.resolve({ items: [addFailedRec], total: 1 })
      }
      return Promise.resolve({ items: [], total: 0 })
    })

    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Alcest')).toBeInTheDocument()
    })
  })

  it('requests combined approval mode when sending todays pick to slskd with Lidarr present', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([
      {
        id: 1,
        type: 'lidarr',
        name: 'Main Lidarr',
        config: {},
        enabled: true,
        userId: 1,
        owned: true,
      },
      { id: 7, type: 'slskd', name: 'slskd', config: {}, enabled: true, userId: 1, owned: true },
    ])

    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Sigur Ros')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Approve to specific target' }))
    fireEvent.click(screen.getByText('Add to slskd'))

    await waitFor(() => {
      expect(mockApproveToTarget).toHaveBeenCalledWith(1, 'slskd-7', {
        approvalMode: 'combined_lidarr_slskd',
        lidarrTargetId: 'lidarr-1',
      })
    })
  })

  it('sends todays pick directly to a standalone slskd target', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([
      { id: 7, type: 'slskd', name: 'slskd', config: {}, enabled: true, userId: 1, owned: true },
    ])

    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Sigur Ros')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(mockApproveToTarget).toHaveBeenCalledWith(1, 'slskd-7', {
        approvalMode: 'single_target',
      })
    })
  })

  it('persists visibility, keyboard order, size and reset while preserving other preferences', async () => {
    setupMocks()
    const { client } = renderWithQuery(<Dashboard />)
    await screen.findByText('Sigur Ros')
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    const panel = screen.getByRole('region', { name: 'Customize' })
    const pick = within(panel).getByRole('checkbox', { name: "Today's Pick" })
    await waitFor(() => expect(pick).toBeEnabled())
    fireEvent.click(pick)
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: "Today's Pick" })).not.toBeInTheDocument(),
    )
    fireEvent.click(pick)
    await screen.findByRole('region', { name: "Today's Pick" })
    const handle = within(panel).getByRole('button', { name: "Reorder Today's Pick" })
    await waitFor(() => expect(handle).not.toHaveAttribute('aria-disabled', 'true'))
    handle.focus()
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    await waitFor(() =>
      expect(panel.querySelector('li')).toHaveAttribute('data-dashboard-editor-card', 'decisions'),
    )
    expect(handle).toHaveFocus()
    expect(within(panel).getByText("Today's Pick moved to position 2 of 5.")).toHaveAttribute(
      'aria-live',
      'polite',
    )
    const size = within(panel).getByRole('combobox', { name: "Size of Today's Pick" })
    await waitFor(() => expect(size).toBeEnabled())
    fireEvent.change(size, { target: { value: 'small' } })
    await waitFor(() =>
      expect(screen.getByRole('region', { name: "Today's Pick" })).toHaveClass('md:col-span-1'),
    )
    const reset = within(panel).getByRole('button', { name: 'Reset to default' })
    await waitFor(() => expect(reset).toBeEnabled())
    fireEvent.click(reset)
    await waitFor(() =>
      expect(client.getQueryData(['user-preferences'])).toMatchObject({
        dismissedHints: [],
        dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
      }),
    )
    expect(screen.getByRole('region', { name: "Today's Pick" })).toHaveClass('md:col-span-3')
    expect(updateUserPreferences).toHaveBeenLastCalledWith({
      dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
    })
  })

  it('saves the Your decisions grid and fetches columns times rows', async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)
    await screen.findByText('Sigur Ros')
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    const panel = screen.getByRole('region', { name: 'Customize' })
    const columns = within(panel).getByRole('combobox', { name: 'Columns in Your decisions' })
    await waitFor(() => expect(columns).toBeEnabled())
    fireEvent.change(columns, { target: { value: '5' } })
    await waitFor(() =>
      expect(updateUserPreferences).toHaveBeenLastCalledWith({
        dashboardLayout: { ...DEFAULT_DASHBOARD_LAYOUT, decisionsGrid: { columns: 5, rows: 3 } },
      }),
    )
    await waitFor(() =>
      expect(mockGetRecommendations).toHaveBeenCalledWith(expect.objectContaining({ limit: '15' })),
    )
  })

  it('hides empty cards until Show empty cards is enabled and preserves explicit hiding', async () => {
    setupMocks()
    mockGetSubscriptions.mockResolvedValue([])
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })
    mockGetDashboardTaste.mockResolvedValue([])
    mockGetDashboardGenreCoverage.mockResolvedValue(null)
    mockGetTopArtists.mockResolvedValue({
      tracks: [],
      total: 0,
      offset: 0,
      limit: 5,
      source: null,
      status: 'not_configured',
    })
    mockGetRecentTracks.mockResolvedValue({
      tracks: [],
      hasSource: false,
      source: null,
      status: 'not_configured',
    })
    renderWithQuery(<Dashboard />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    const panel = screen.getByRole('region', { name: 'Customize' })
    const showEmpty = within(panel).getByRole('checkbox', { name: 'Show empty cards' })
    await waitFor(() => expect(showEmpty).toBeEnabled())
    await waitFor(() => expect(document.querySelectorAll('[data-dashboard-card]')).toHaveLength(0))
    fireEvent.click(showEmpty)
    await waitFor(() => expect(document.querySelectorAll('[data-dashboard-card]')).toHaveLength(5))
    const subscriptions = within(panel).getByRole('checkbox', { name: 'Discovery Modes' })
    await waitFor(() => expect(subscriptions).toBeEnabled())
    fireEvent.click(subscriptions)
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Discovery Modes' })).not.toBeInTheDocument(),
    )
  })

  it.each(['genres', 'subscriptions', 'listening', 'decisions'] as const)(
    'uses the same saved preference for the %s source toggle',
    async (cardId) => {
      renderWithQuery(<DashboardCardToggle cardId={cardId} />)
      const toggle = screen.getByRole('checkbox', { name: 'Show on dashboard' })
      await waitFor(() => expect(toggle).toBeEnabled())
      fireEvent.click(toggle)
      await waitFor(() => expect(toggle).not.toBeChecked())
      expect(updateUserPreferences).toHaveBeenLastCalledWith({
        dashboardLayout: {
          ...DEFAULT_DASHBOARD_LAYOUT,
          cards: DEFAULT_DASHBOARD_LAYOUT.cards.map((card) =>
            card.id === cardId ? { ...card, visible: false } : card,
          ),
        },
      })
    },
  )

  it('normalizes saved layouts on the client and retains the layout after a failed save', async () => {
    setupMocks()
    vi.mocked(getUserPreferences).mockResolvedValue({
      dashboardLayout: {
        version: 1,
        showEmpty: false,
        cards: [
          { id: 'removed', visible: true, size: 'small' },
          { id: 'pick', visible: false, size: 'medium' },
        ],
      },
    })
    vi.mocked(updateUserPreferences).mockRejectedValue(new Error('offline'))
    renderWithQuery(<Dashboard />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    const toggle = screen.getByRole('checkbox', { name: "Today's Pick" })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).not.toBeChecked()
    expect(screen.getAllByRole('combobox')).toHaveLength(7)
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not save your dashboard. Try again.'),
    )
    expect(toggle).not.toBeChecked()
  })
})
