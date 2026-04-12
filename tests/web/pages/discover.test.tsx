// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'
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
    <I18nProvider>
      <QueryClientProvider client={client}>
        <PreviewContext.Provider value={noopPreview}>{ui}</PreviewContext.Provider>
      </QueryClientProvider>
    </I18nProvider>,
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
  getDiscoveryModes: vi.fn().mockResolvedValue({ modes: [] }),
  runDiscoveryMode: vi.fn(),
  getLidarrProfiles: vi.fn().mockResolvedValue([{ id: 1, name: 'Any' }]),
  getLidarrMetadataProfiles: vi.fn().mockResolvedValue([{ id: 1, name: 'Standard' }]),
  getLidarrRootFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/music', freeSpace: 0 }]),
}))

import {
  approveRecommendation,
  approveToTarget,
  bulkAction,
  getRecommendations,
  getWarmStatuses,
  listTargets,
  updateRecommendation,
} from '@/web/lib/api'

const mockApproveToTarget = vi.mocked(approveToTarget)
const mockGetRecommendations = vi.mocked(getRecommendations)
const mockUpdateRecommendation = vi.mocked(updateRecommendation)
const mockApproveRecommendation = vi.mocked(approveRecommendation)
const mockBulkAction = vi.mocked(bulkAction)
const mockListTargets = vi.mocked(listTargets)

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
  mockListTargets.mockResolvedValue([])
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

  it('keyboard approve sends a selected recommendation to a standalone slskd target', async () => {
    mockApproveToTarget.mockResolvedValue(undefined as unknown as never)
    setupMockApi()
    mockListTargets.mockResolvedValue([
      { id: 7, type: 'slskd', name: 'slskd', config: {}, enabled: true, owned: true },
    ])

    renderWithQuery(<DiscoverPage />)

    const artist = await screen.findByText('Test Artist')
    fireEvent.click(artist)
    fireEvent.keyDown(window, { key: 'a' })

    await waitFor(() => {
      expect(mockApproveToTarget).toHaveBeenCalledWith(1, 'slskd-7', {
        approvalMode: 'single_target',
      })
    })
    expect(mockUpdateRecommendation).not.toHaveBeenCalled()
  })

  it('keyboard approve keeps using the generic approve path when no standalone slskd target exists', async () => {
    mockUpdateRecommendation.mockResolvedValue(undefined as unknown as never)
    setupMockApi()

    renderWithQuery(<DiscoverPage />)

    const artist = await screen.findByText('Test Artist')
    fireEvent.click(artist)
    fireEvent.keyDown(window, { key: 'a' })

    await waitFor(() => {
      expect(mockUpdateRecommendation).toHaveBeenCalledWith(1, { status: 'approved' })
    })
    expect(mockApproveToTarget).not.toHaveBeenCalled()
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

  it('uses translated feedback insights copy in French', async () => {
    localStorage.setItem('digarr-locale', 'fr')
    setupMockApi()
    renderWithQuery(<DiscoverPage />)

    expect(await screen.findByRole('button', { name: 'Afficher les retours' })).toBeInTheDocument()
  })

  it('uses translated view switcher labels in French', async () => {
    localStorage.setItem('digarr-locale', 'fr')
    setupMockApi()
    renderWithQuery(<DiscoverPage />)

    expect(await screen.findByRole('button', { name: 'Vue en grille' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vue en liste' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vue empilée' })).toBeInTheDocument()
  })

  it('uses translated scan action copy in French', async () => {
    localStorage.setItem('digarr-locale', 'fr')
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })
    renderWithQuery(
      <MemoryRouter>
        <DiscoverPage />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Tout' }))

    expect(await screen.findByText('Exécuter une analyse')).toBeInTheDocument()
  })

  it('requests combined approval mode when sending a discovery result to slskd with Lidarr present', async () => {
    setupMockApi()
    mockListTargets.mockResolvedValue([
      { id: 1, type: 'lidarr', name: 'Main Lidarr', config: {}, enabled: true, owned: true },
      { id: 7, type: 'slskd', name: 'slskd', config: {}, enabled: true, owned: true },
    ])

    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '' }))
    fireEvent.click(screen.getByText('Add to slskd'))

    await waitFor(() => {
      expect(mockApproveToTarget).toHaveBeenCalledWith(1, 'slskd-7', {
        approvalMode: 'combined_lidarr_slskd',
        lidarrTargetId: 'lidarr-1',
      })
    })
  })

  it('sends the linked Lidarr target when slskd is paired to one of multiple Lidarr targets', async () => {
    setupMockApi()
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

    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '' }))
    fireEvent.click(screen.getByText('Add to slskd'))

    await waitFor(() => {
      expect(mockApproveToTarget).toHaveBeenCalledWith(1, 'slskd-7', {
        approvalMode: 'combined_lidarr_slskd',
        lidarrTargetId: 'lidarr-2',
      })
    })
  })

  it('sends a discovery result directly to a standalone slskd target', async () => {
    setupMockApi()
    mockListTargets.mockResolvedValue([
      { id: 7, type: 'slskd', name: 'slskd', config: {}, enabled: true, owned: true },
    ])

    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    const approveButtons = screen.getAllByText('Approve')
    expect(approveButtons.length).toBeGreaterThanOrEqual(1)
    const approveButton = approveButtons[0]
    if (!approveButton) {
      throw new Error('Missing approve button')
    }
    fireEvent.click(approveButton)

    await waitFor(() => {
      expect(mockApproveToTarget).toHaveBeenCalledWith(1, 'slskd-7', {
        approvalMode: 'single_target',
      })
    })
  })
})
