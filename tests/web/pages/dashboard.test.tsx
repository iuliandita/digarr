// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
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
  listTargets: vi.fn().mockResolvedValue([]),
  getRecentListens: vi.fn(),
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

import {
  getDashboardActivity,
  getDashboardTaste,
  getPipelineStatus,
  getRecentListens,
  getRecommendations,
  getSchedulerInfo,
  getSubscriptions,
} from '@/web/lib/api'
import { Dashboard } from '@/web/pages/dashboard'

const mockGetRecommendations = vi.mocked(getRecommendations)
const mockGetRecentListens = vi.mocked(getRecentListens)
const mockGetSubscriptions = vi.mocked(getSubscriptions)
const mockGetSchedulerInfo = vi.mocked(getSchedulerInfo)
const mockGetDashboardTaste = vi.mocked(getDashboardTaste)
const mockGetDashboardActivity = vi.mocked(getDashboardActivity)
const mockGetPipelineStatus = vi.mocked(getPipelineStatus)

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

  mockGetRecentListens.mockResolvedValue({
    tracks: [{ artist: 'Bon Iver', track: 'Holocene', source: 'listenbrainz' }],
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders today's pick with artist name and score", async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Sigur Ros')).toBeInTheDocument()
      expect(screen.getByText('85')).toBeInTheDocument()
    })
  })

  it('renders listening activity', async () => {
    setupMocks()
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Bon Iver')).toBeInTheDocument()
      expect(screen.getByText('Holocene')).toBeInTheDocument()
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
})
