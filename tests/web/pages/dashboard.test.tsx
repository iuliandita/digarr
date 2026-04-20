// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </I18nProvider>,
  )
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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    promise: vi.fn(),
  },
}))

vi.mock('@/web/lib/api', () => ({
  getRecommendations: vi.fn(),
  updateRecommendation: vi.fn(),
  approveRecommendation: vi.fn().mockResolvedValue({}),
  approveToTarget: vi.fn().mockResolvedValue({}),
  deletePlaylistApi: vi.fn(),
  generatePlaylistApi: vi.fn(),
  listTargets: vi.fn().mockResolvedValue([]),
  getTopArtists: vi.fn(),
  getRecentTracks: vi.fn(),
  getSubscriptions: vi.fn(),
  getSchedulerInfo: vi.fn(),
  getDashboardTaste: vi.fn(),
  getDashboardActivity: vi.fn(),
  triggerPipeline: vi.fn(),
  rescanArtists: vi.fn().mockResolvedValue({ updated: 0, total: 0 }),
  moodDiscover: vi.fn(),
  quickDiscover: vi.fn(),
  getPipelineStatus: vi.fn(),
  getStoredToken: vi.fn(() => null),
  getUserPreferences: vi.fn().mockResolvedValue({ dismissedHints: [] }),
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
  approveToTarget,
  getDashboardActivity,
  getDashboardTaste,
  getPipelineStatus,
  getRecentTracks,
  getRecommendations,
  getSchedulerInfo,
  getSubscriptions,
  getTopArtists,
  listTargets,
} from '@/web/lib/api'
import { Dashboard } from '@/web/pages/dashboard'

const mockApproveToTarget = vi.mocked(approveToTarget)
const mockGetRecommendations = vi.mocked(getRecommendations)
const mockGetTopArtists = vi.mocked(getTopArtists)
const mockGetRecentTracks = vi.mocked(getRecentTracks)
const mockGetSubscriptions = vi.mocked(getSubscriptions)
const mockGetSchedulerInfo = vi.mocked(getSchedulerInfo)
const mockGetDashboardTaste = vi.mocked(getDashboardTaste)
const mockGetDashboardActivity = vi.mocked(getDashboardActivity)
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
  })

  mockGetRecentTracks.mockResolvedValue({
    tracks: [{ artist: 'Bon Iver', track: 'Holocene', source: 'listenbrainz' }],
    hasSource: true,
    source: 'listenbrainz',
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

  mockGetDashboardActivity.mockResolvedValue([
    {
      type: 'approved',
      timestamp: new Date().toISOString(),
      data: { artistName: 'Mogwai' },
    },
  ])

  mockGetPipelineStatus.mockResolvedValue({ running: false })
  mockListTargets.mockResolvedValue([])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard', () => {
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
  })

  it("renders today's pick with artist name and score", async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Sigur Ros')).toBeInTheDocument()
      expect(screen.getByText('85')).toBeInTheDocument()
    })
  })

  it("uses translated today's pick copy in French", async () => {
    localStorage.setItem('digarr-locale', 'fr')
    setupMocks()
    renderWithQuery(<Dashboard />)

    expect(await screen.findByText('Le choix du jour')).toBeInTheDocument()
  })

  it('renders listening history and recent plays', async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('42 plays this month')).toBeInTheDocument()
      expect(screen.getByText('Holocene')).toBeInTheDocument()
      expect(screen.getAllByText('Bon Iver').length).toBeGreaterThan(0)
    })
  })

  it('renders taste profile genres', async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('40%')).toBeInTheDocument()
      expect(screen.getByText('20%')).toBeInTheDocument()
    })
  })

  it('renders activity feed entries', async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Approved Mogwai/)).toBeInTheDocument()
    })
  })

  it('renders subscription pulse', async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Rock Discovery')).toBeInTheDocument()
      expect(screen.getByText(/5 found last run/)).toBeInTheDocument()
    })
  })

  it('shows empty state when no pending recommendations', async () => {
    setupMocks()
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })
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

  it('uses translated dashboard section copy in French', async () => {
    localStorage.setItem('digarr-locale', 'fr')
    setupMocks()
    mockGetSubscriptions.mockResolvedValue([] as never)

    renderWithQuery(<Dashboard />)

    expect(await screen.findByText('Abonnements')).toBeInTheDocument()
    expect(screen.getByText('Commencer')).toBeInTheDocument()
  })

  it('localizes playlist card metadata labels in French', () => {
    localStorage.setItem('digarr-locale', 'fr')

    renderWithQuery(
      <PlaylistCard
        playlist={{
          id: 8,
          userId: 1,
          name: 'Night Shift',
          strategy: 'weekly_digest',
          schedule: '0 0 * * *',
          enabled: false,
          targetIds: [],
          trackCount: 12,
          lastGeneratedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          config: { size: 25, trackSourcePriority: ['local', 'spotify', 'deezer'] },
        }}
        onEdit={vi.fn()}
        onRefetch={vi.fn()}
      />,
    )

    expect(screen.getByText('Planification:')).toBeInTheDocument()
    expect(screen.getByText('Quotidien')).toBeInTheDocument()
    expect(screen.getByText('Jamais')).toBeInTheDocument()
    expect(screen.getByText('Désactivé')).toBeInTheDocument()
  })

  it('shows add_failed recommendations in Recently Approved', async () => {
    setupMocks()
    mockGetRecommendations.mockImplementation((params) => {
      const p = params as Record<string, string> | undefined
      if (p?.status === 'pending') {
        return Promise.resolve({ items: [pendingRec], total: 1 })
      }
      if (p?.status === 'added_to_lidarr,add_failed,approved') {
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
      { id: 1, type: 'lidarr', name: 'Main Lidarr', config: {}, enabled: true, owned: true },
      { id: 7, type: 'slskd', name: 'slskd', config: {}, enabled: true, owned: true },
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

  it('sends the linked Lidarr target when slskd is paired to one of multiple Lidarr targets', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([
      { id: 1, type: 'lidarr', name: 'Main Lidarr', config: {}, enabled: true, owned: true },
      { id: 2, type: 'lidarr', name: 'Alt Lidarr', config: {}, enabled: true, owned: true },
      {
        id: 7,
        type: 'slskd',
        name: 'slskd',
        config: { lidarrTargetId: 2 },
        enabled: true,
        owned: true,
      },
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
        lidarrTargetId: 'lidarr-2',
      })
    })
  })

  it('sends todays pick directly to a standalone slskd target', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([
      { id: 7, type: 'slskd', name: 'slskd', config: {}, enabled: true, owned: true },
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

  it('ignores disabled Lidarr targets when choosing slskd approval mode', async () => {
    setupMocks()
    mockListTargets.mockResolvedValue([
      { id: 1, type: 'lidarr', name: 'Main Lidarr', config: {}, enabled: false, owned: true },
      { id: 7, type: 'slskd', name: 'slskd', config: {}, enabled: true, owned: true },
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
})
