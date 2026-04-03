// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewContext } from '@/web/lib/preview-context'

const noopPreview = {
  play: vi.fn(),
  stop: vi.fn(),
  hasPreview: () => false,
  currentMbid: null,
  playing: false,
  globalPlayId: 0,
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PreviewContext.Provider value={noopPreview}>{ui}</PreviewContext.Provider>
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

vi.mock('@/web/lib/api', () => ({
  getRecommendations: vi.fn(),
  updateRecommendation: vi.fn(),
  approveRecommendation: vi.fn(),
  approveToTarget: vi.fn(),
  bulkAction: vi.fn(),
  getWarmStatuses: vi.fn(),
  rescanArtists: vi.fn(),
  triggerPipeline: vi.fn(),
  listTargets: vi.fn().mockResolvedValue([]),
  exportRecommendations: vi.fn(),
  getUserPreferences: vi.fn().mockResolvedValue({}),
  getLidarrProfiles: vi.fn().mockResolvedValue([{ id: 1, name: 'Any' }]),
  getLidarrMetadataProfiles: vi.fn().mockResolvedValue([{ id: 1, name: 'Standard' }]),
  getLidarrRootFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/music', freeSpace: 0 }]),
}))

import {
  approveRecommendation,
  bulkAction,
  getRecommendations,
  getWarmStatuses,
  updateRecommendation,
} from '@/web/lib/api'

const mockGetRecommendations = vi.mocked(getRecommendations)
const mockUpdateRecommendation = vi.mocked(updateRecommendation)
const mockApproveRecommendation = vi.mocked(approveRecommendation)
const mockBulkAction = vi.mocked(bulkAction)

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const makeRec = (
  overrides: Partial<{
    id: number
    score: number
    status: string
    aiReasoning: string | null
    sources: Record<string, number> | null
    lidarrError: string | null
  }> = {},
) => ({
  id: 1,
  score: 0.78,
  status: 'pending',
  aiReasoning: 'Sounds like something you would enjoy.',
  sources: { listenbrainz: 0.8, lastfm: 0.7 },
  lidarrError: null,
  artist: {
    id: 10,
    name: 'Test Artist',
    mbid: 'mbid-test-001',
    genres: ['rock', 'indie', 'alternative'],
    tags: null,
    imageUrl: null,
    streamingUrls: { spotify: 'https://open.spotify.com/artist/example' },
  },
  ...overrides,
})

const makeRes = (recs: ReturnType<typeof makeRec>[]) => ({
  items: recs,
  total: recs.length,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// useQuery calls the queryFn on mount; we need all variants to resolve
function setupMockApi(recs: ReturnType<typeof makeRec>[] = [makeRec()]) {
  mockGetRecommendations.mockResolvedValue(
    makeRes(recs) as unknown as { items: unknown[]; total: number },
  )
  vi.mocked(getWarmStatuses).mockResolvedValue({ statuses: {} })
}

// ---------------------------------------------------------------------------
// Import component after mocks are registered
// ---------------------------------------------------------------------------

import { DiscoverPage } from '@/web/pages/discover'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscoverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // sonner toast -- not rendered in jsdom, silence it
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  it('renders recommendation cards from API data', async () => {
    setupMockApi()
    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    expect(screen.getByText('78%')).toBeInTheDocument()
  })

  it('shows skeleton cards while loading', () => {
    // Never resolves during this test
    mockGetRecommendations.mockReturnValue(new Promise(() => {}))
    renderWithQuery(<DiscoverPage />)
    // Skeleton elements are present (animate-pulse divs)
    const pulsingEls = document.querySelectorAll('.animate-pulse')
    expect(pulsingEls.length).toBeGreaterThan(0)
  })

  it('shows empty state when no recommendations match filter', async () => {
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })
    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText(/No pending recommendations/i)).toBeInTheDocument()
    })
  })

  it('filter tabs update the displayed list', async () => {
    // Default filter is "pending", show one rec. Switch to "approved" -> empty.
    mockGetRecommendations.mockImplementation((params) => {
      const p = params as Record<string, string> | undefined
      if (!p?.status || p.status === 'pending') {
        return Promise.resolve(
          makeRes([makeRec()]) as unknown as { items: unknown[]; total: number },
        )
      }
      return Promise.resolve({ items: [], total: 0 })
    })

    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Approved/i }))

    await waitFor(() => {
      expect(screen.queryByText('Test Artist')).not.toBeInTheDocument()
    })
  })

  it('clicking a card expands it', async () => {
    setupMockApi()
    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    // Click the card -- AI reasoning should appear in expanded view
    fireEvent.click(screen.getByText('Test Artist'))

    await waitFor(() => {
      expect(screen.getByText('Sounds like something you would enjoy.')).toBeInTheDocument()
    })
  })

  it('approve button calls approveRecommendation without dialog when no Lidarr targets', async () => {
    mockApproveRecommendation.mockResolvedValue(undefined as unknown as never)
    setupMockApi()

    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    // Find the card's Approve button (from MonitoringOptions split button)
    const approveButtons = screen.getAllByText('Approve')
    expect(approveButtons.length).toBeGreaterThanOrEqual(1)
    // biome-ignore lint/style/noNonNullAssertion: checked above
    fireEvent.click(approveButtons[0]!)

    // No Lidarr targets -> no dialog, calls approveRecommendation directly with monitorOption
    await waitFor(() => {
      expect(mockApproveRecommendation).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ monitorOption: 'all' }),
      )
    })
  })

  it('bulk approve above threshold calls bulkAction', async () => {
    mockBulkAction.mockResolvedValue(undefined as unknown as never)
    // Two recs: one above 70%, one below
    setupMockApi([makeRec({ id: 1, score: 0.85 }), makeRec({ id: 2, score: 0.5 })])

    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Test Artist')).toHaveLength(2)
    })

    fireEvent.click(screen.getByRole('button', { name: /approve all above/i }))

    await waitFor(() => {
      // Only rec id=1 qualifies (85% >= 70%)
      expect(mockBulkAction).toHaveBeenCalledWith([1], 'approve')
    })
  })

  it('reject button calls updateRecommendation', async () => {
    mockUpdateRecommendation.mockResolvedValue(undefined as unknown as never)
    setupMockApi()

    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    // "Reject" exact text (not "Rejected" tab)
    const rejectButton = screen.getByText('Reject')
    fireEvent.click(rejectButton)

    await waitFor(() => {
      expect(mockUpdateRecommendation).toHaveBeenCalledWith(1, { status: 'rejected' })
    })
  })

  it('renders genre tags', async () => {
    setupMockApi()
    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('rock')).toBeInTheDocument()
      expect(screen.getByText('indie')).toBeInTheDocument()
    })
  })

  it('renders streaming links', async () => {
    setupMockApi()
    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      // SP link for Spotify
      expect(screen.getByTitle('Spotify')).toBeInTheDocument()
    })
  })
})
