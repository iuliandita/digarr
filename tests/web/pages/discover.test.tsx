// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditionQueue } from '@/web/hooks/use-audition-queue'
import type { PreviewSource } from '@/web/hooks/use-preview'
import { I18nProvider } from '@/web/lib/i18n'
import { PreviewContext } from '@/web/lib/preview-context'

const noopPreview = {
  play: vi.fn(),
  stop: vi.fn(),
  hasPreview: () => false,
  currentMbid: null as string | null,
  currentTrack: undefined as PreviewSource['track'],
  playing: false,
  globalPlayId: 0,
  volume: 1,
  setVolume: vi.fn(),
  audition: {
    unavailable: [] as AuditionQueue['unavailable'],
    selectedCount: 0,
    dismissSummary: vi.fn(),
    active: false,
    index: 0,
    count: 0,
    current: null,
    start: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    stop: vi.fn(),
  },
}

function renderWithQuery(ui: ReactElement, initialEntries: string[] = ['/']) {
  const client = createTestQueryClient()
  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>
          <PreviewContext.Provider value={noopPreview}>{ui}</PreviewContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
}

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

vi.mock('@/web/lib/api', () => ({
  getRecommendations: vi.fn(),
  listOwnApprovalRequests: vi.fn().mockResolvedValue([]),
  resolveApprovalRequest: vi.fn(),
  listApprovalRequests: vi.fn().mockResolvedValue([]),
  updateRecommendation: vi.fn(),
  approveRecommendation: vi.fn(),
  approveToTarget: vi.fn(),
  bulkAction: vi.fn(),
  deleteAlbumBlock: vi.fn(),
  deleteArtistBlock: vi.fn(),
  getWarmStatuses: vi.fn(),
  getPopularAlbums: vi.fn(),
  getPendingPlayability: vi.fn().mockResolvedValue({
    pendingArtists: 0,
    withTrack: 0,
    withoutTrack: 0,
    reasons: { missingSource: 0, noMatch: 0, upstreamFailure: 0 },
    unknown: 0,
    checkedAt: null,
  }),
  getPopularAlbumsAvailability: vi
    .fn()
    .mockResolvedValue({ available: true, spotify: true, lastfm: false }),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public data: unknown,
    ) {
      super('ApiError')
    }
  },
  rescanArtists: vi.fn(),
  triggerPipeline: vi.fn(),
  listTargets: vi.fn().mockResolvedValue([]),
  exportRecommendations: vi.fn(),
  getUserPreferences: vi.fn().mockResolvedValue({}),
  getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true, isAdmin: true }),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 1, username: 'admin', isAdmin: true }),
}))

import {
  approveRecommendation,
  approveToTarget,
  bulkAction,
  deleteAlbumBlock,
  deleteArtistBlock,
  getAuthStatus,
  getCurrentUser,
  getPendingPlayability,
  getRecommendations,
  getUserPreferences,
  getWarmStatuses,
  listTargets,
  rescanArtists,
  updateRecommendation,
} from '@/web/lib/api'

const mockApproveToTarget = approveToTarget as ReturnType<typeof vi.fn>
const mockGetRecommendations = getRecommendations as ReturnType<typeof vi.fn>
const mockUpdateRecommendation = updateRecommendation as ReturnType<typeof vi.fn>
const mockApproveRecommendation = approveRecommendation as ReturnType<typeof vi.fn>
const mockBulkAction = bulkAction as ReturnType<typeof vi.fn>
const mockGetAuthStatus = getAuthStatus as ReturnType<typeof vi.fn>
const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>
const mockListTargets = listTargets as ReturnType<typeof vi.fn>
const mockRescanArtists = rescanArtists as ReturnType<typeof vi.fn>

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
    kind: 'artist' | 'album'
    recommendedReleaseGroupId: string | null
    recommendedReleaseGroupTitle: string | null
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
  ;(getWarmStatuses as ReturnType<typeof vi.fn>).mockResolvedValue({ statuses: {} })
  mockListTargets.mockResolvedValue([])
}

// ---------------------------------------------------------------------------
// Import component after mocks are registered
// ---------------------------------------------------------------------------

import { DiscoverPage } from '@/web/pages/discover'
import { createTestQueryClient } from '../helpers/query'
import { installMemoryLocalStorage } from '../helpers/storage'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscoverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    noopPreview.currentMbid = null
    noopPreview.currentTrack = undefined
    noopPreview.audition.unavailable = []
    noopPreview.audition.selectedCount = 0
    mockGetAuthStatus.mockResolvedValue({ authenticated: true, isAdmin: true })
    mockGetCurrentUser.mockResolvedValue({ id: 1, username: 'admin', isAdmin: true })
    installMemoryLocalStorage()
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
  })

  it('defaults to score ordering and allows optional genre priority and secondary browsing', async () => {
    setupMockApi([makeRec()])
    vi.mocked(getUserPreferences).mockResolvedValueOnce({
      primaryGenres: ['metal', 'jazz', 'trip hop'],
      secondaryGenres: ['ambient'],
    })
    renderWithQuery(<DiscoverPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    const select = await screen.findByRole('combobox', { name: 'Discovery order' })
    expect(select).toHaveValue('score')
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'Genre priorities' })).toBeEnabled(),
    )
    fireEvent.change(select, { target: { value: 'priority' } })
    await waitFor(() =>
      expect(mockGetRecommendations).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'taste', offset: '0' }),
      ),
    )
    fireEvent.change(select, { target: { value: 'secondary' } })
    await waitFor(() =>
      expect(mockGetRecommendations).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'taste', tasteTier: 'secondary', offset: '0' }),
      ),
    )
    expect(mockApproveRecommendation).not.toHaveBeenCalled()
  })

  it('includes pending artists without preview links in Audition without approving them', async () => {
    const rec = makeRec()
    rec.artist.streamingUrls = { spotify: '' }
    setupMockApi([rec, makeRec({ id: 2, status: 'approved' })])
    renderWithQuery(<DiscoverPage />)
    await waitFor(() => expect(screen.getAllByText('Test Artist').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const item = await screen.findByRole('menuitem', { name: /Audition/ })
    expect(item).not.toHaveAttribute('aria-disabled')
    fireEvent.click(item)
    expect(noopPreview.audition.start).toHaveBeenCalledWith([
      {
        mbid: rec.artist.mbid,
        artistName: rec.artist.name,
        streamingUrls: rec.artist.streamingUrls,
      },
    ])
    expect(mockApproveRecommendation).not.toHaveBeenCalled()
    expect(mockBulkAction).not.toHaveBeenCalled()
  })

  it('shows a localized unavailable summary after the queue has ended', async () => {
    setupMockApi([])
    noopPreview.audition.selectedCount = 2
    noopPreview.audition.unavailable = [
      {
        item: { mbid: 'a', artistName: 'No-link artist', streamingUrls: null },
        reason: 'missing-links',
      },
    ]
    renderWithQuery(<DiscoverPage />)
    expect(await screen.findByText('1 of 2 selected previews unavailable')).toBeInTheDocument()
    expect(screen.getByText('No-link artist: No preview links')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(noopPreview.audition.dismissSummary).toHaveBeenCalled()
  })

  it('summarizes pending artists without a playable track by reason', async () => {
    setupMockApi()
    vi.mocked(getPendingPlayability).mockResolvedValueOnce({
      pendingArtists: 5,
      withTrack: 1,
      withoutTrack: 3,
      reasons: { missingSource: 1, noMatch: 2, upstreamFailure: 0 },
      unknown: 1,
      checkedAt: '2026-10-02T00:00:00.000Z',
    })
    renderWithQuery(<DiscoverPage />)

    expect(
      await screen.findByText(
        '3 of 5 pending artists had no playable track in your latest Audition playlist runs',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('No track source set up: 1')).toBeInTheDocument()
    expect(screen.getByText('No matching track: 2')).toBeInTheDocument()
    expect(screen.getByText('Not checked yet: 1')).toBeInTheDocument()
    expect(screen.queryByText(/Lookup failed/)).not.toBeInTheDocument()
  })

  it('keeps the recommendation workspace free of discovery mode cards', async () => {
    setupMockApi()
    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    expect(screen.queryByRole('heading', { name: 'Discovery Modes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run discovery' })).not.toBeInTheDocument()
  })

  it('shows empty state when no recommendations match filter', async () => {
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })
    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText(/No pending recommendations/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: 'Library Gap-Fill' })).not.toBeInTheDocument()
  })

  it('shows a load error with retry instead of an empty queue', async () => {
    mockGetRecommendations.mockRejectedValue(new Error('boom'))
    renderWithQuery(<DiscoverPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load recommendations.")
    expect(screen.queryByText(/No pending recommendations/i)).toBeNull()
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/No pending recommendations/i)).toBeInTheDocument()
  })

  it('tells a decade-filtered empty result apart and clears the filter', async () => {
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })
    renderWithQuery(<DiscoverPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: '70s' }))
    expect(
      await screen.findByText('No recommendations match the selected decades.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText(/No pending recommendations/i)).toBeInTheDocument()
  })

  it('explains album producers and links to each action when the Albums view is empty', async () => {
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })
    renderWithQuery(<DiscoverPage />, ['/discover?kind=album'])

    expect(await screen.findByText('No album recommendations in this view.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'A normal scan finds artists. Use one of the options below to generate album recommendations.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Library Gap-Fill' })).toHaveAttribute(
      'href',
      '/discovery-modes?mode=gap-fill',
    )
    expect(screen.getByRole('link', { name: 'Release Radar' })).toHaveAttribute(
      'href',
      '/discovery-modes?mode=release-radar',
    )
    expect(screen.getByRole('link', { name: 'Net-new album discovery' })).toHaveAttribute(
      'href',
      '/settings?tab=recommendations#net-new-album-discovery',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approved' }))
    expect(await screen.findByText('No album recommendations in this view.')).toBeInTheDocument()
  })

  it('shows the album guidance when the saved view is the card stack', async () => {
    localStorage.setItem('digarr:discover-view', 'stack')
    mockGetRecommendations.mockResolvedValue({ items: [], total: 0 })

    renderWithQuery(<DiscoverPage />, ['/discover?kind=album'])

    expect(await screen.findByText('No album recommendations in this view.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Library Gap-Fill' })).toHaveAttribute(
      'href',
      '/discovery-modes?mode=gap-fill',
    )
    expect(screen.queryByText('No more recommendations')).not.toBeInTheDocument()
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

  it('suspends approve and reject shortcuts while the More menu is open', async () => {
    setupMockApi([makeRec()])
    renderWithQuery(<DiscoverPage />)
    await screen.findByText('Test Artist')

    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await screen.findByRole('menu')
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.keyDown(window, { key: 'r' })

    expect(mockUpdateRecommendation).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Why are you rejecting?' })).toBeNull()
  })

  it('clicking a card expands it', async () => {
    setupMockApi()
    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    // Click the card - AI reasoning should appear in expanded view
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
        expect.objectContaining({ monitorOption: 'none' }),
      )
    })
  })

  it.each([
    { previewMbid: 'mbid-test-001', hasTrack: true, expected: true },
    { previewMbid: 'another-artist', hasTrack: true, expected: false },
    { previewMbid: 'mbid-test-001', hasTrack: false, expected: false },
  ])(
    'sends exact preview context only for the approved artist: $expected',
    async ({ previewMbid, hasTrack, expected }) => {
      setupMockApi()
      noopPreview.currentMbid = previewMbid
      noopPreview.currentTrack = hasTrack
        ? { artistName: 'Test Artist', trackName: 'The song' }
        : undefined
      mockApproveRecommendation.mockResolvedValue({ status: 'approved' })
      renderWithQuery(<DiscoverPage />)
      await screen.findByText('Test Artist')
      fireEvent.click(screen.getAllByText('Approve')[0] as HTMLElement)
      await waitFor(() => expect(mockApproveRecommendation).toHaveBeenCalled())
      expect(mockApproveRecommendation.mock.calls[0]?.[1]?.feedbackTrack).toEqual(
        expected ? noopPreview.currentTrack : undefined,
      )
    },
  )

  it('offers popular albums from the approve dropdown', async () => {
    setupMockApi()
    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByLabelText('Monitoring options'))

    expect(screen.getByText('Popular albums')).toBeInTheDocument()
  })

  it('bulk approve above threshold calls bulkAction', async () => {
    mockBulkAction.mockResolvedValue(undefined as unknown as never)
    // Two recs: one above 70%, one below
    setupMockApi([makeRec({ id: 1, score: 0.85 }), makeRec({ id: 2, score: 0.5 })])

    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Test Artist')).toHaveLength(2)
    })

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /approve all above/i }))

    expect(mockBulkAction).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog', { name: 'Approve all above 70%?' })
    expect(dialog).toHaveTextContent('Approve 1 pending recommendations at 70% or higher?')
    expect(dialog).toHaveTextContent('Lidarr')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve 1' }))

    await waitFor(() => {
      // Only rec id=1 qualifies (85% >= 70%)
      expect(mockBulkAction).toHaveBeenCalledWith([1], 'approve')
    })
  })

  it('cancelling the approve-above confirmation does nothing', async () => {
    setupMockApi([makeRec({ id: 1, score: 0.85 })])
    renderWithQuery(<DiscoverPage />)
    await waitFor(() => {
      expect(screen.getAllByText('Test Artist')).toHaveLength(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /approve all above/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve all above 70%?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Approve all above 70%?' })).toBeNull()
    })
    expect(mockBulkAction).not.toHaveBeenCalled()
  })

  it('bulk reject below threshold opens the picker and rejects only pending below-threshold items', async () => {
    mockBulkAction.mockResolvedValue(undefined as unknown as never)
    setupMockApi([
      makeRec({ id: 1, score: 0.85, status: 'pending' }),
      makeRec({ id: 2, score: 0.5, status: 'pending' }),
      makeRec({ id: 3, score: 0.69, status: 'approved' }),
      makeRec({ id: 4, score: 0.7, status: 'pending' }),
      makeRec({ id: 5, score: 0.2, status: 'rejected' }),
    ])

    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Test Artist')).toHaveLength(5)
    })

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /reject all below/i }))

    expect(mockBulkAction).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog', { name: 'Why are you rejecting?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wrong genre or style for me' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))

    await waitFor(() => {
      expect(mockBulkAction).toHaveBeenCalledWith([2], 'reject', {
        reason: 'wrong_style',
        permanent: false,
      })
    })
  })

  it('clears all pending recommendations in bounded batches', async () => {
    mockBulkAction.mockResolvedValue(undefined as unknown as never)
    const firstBatch = Array.from({ length: 200 }, (_, idx) => makeRec({ id: idx + 1 }))
    const secondBatch = Array.from({ length: 50 }, (_, idx) => makeRec({ id: idx + 201 }))
    const pendingBatches = [firstBatch, secondBatch, []]

    mockGetRecommendations.mockImplementation((params) => {
      const p = params as Record<string, string> | undefined
      if (p?.status === 'pending' && p.limit === '200') {
        return Promise.resolve(makeRes(pendingBatches.shift() ?? []))
      }
      if (p?.status === 'pending' && p.limit === '10000') {
        return Promise.resolve(makeRes([...firstBatch, ...secondBatch]))
      }
      return Promise.resolve(makeRes([makeRec()]))
    })
    ;(getWarmStatuses as ReturnType<typeof vi.fn>).mockResolvedValue({ statuses: {} })
    mockListTargets.mockResolvedValue([])

    renderWithQuery(<DiscoverPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clear All' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reject All' }))

    await waitFor(() => {
      expect(mockBulkAction).toHaveBeenCalledTimes(2)
    })
    expect(mockBulkAction).toHaveBeenNthCalledWith(
      1,
      firstBatch.map((r) => r.id),
      'reject',
    )
    expect(mockBulkAction).toHaveBeenNthCalledWith(
      2,
      secondBatch.map((r) => r.id),
      'reject',
    )
    expect(
      mockGetRecommendations.mock.calls.some(([params]) => {
        const p = params as Record<string, string> | undefined
        return p?.status === 'pending' && Number(p.limit) > 200
      }),
    ).toBe(false)
  })

  it('reports attempted, updated, and failed artist counts after a rescan', async () => {
    setupMockApi()
    mockRescanArtists.mockResolvedValue({ attempted: 3, updated: 2, failed: 1, total: 3 })
    const toastPromise = vi
      .spyOn(toast, 'promise')
      .mockImplementation(() => ({ unwrap: async () => undefined }))
    renderWithQuery(<DiscoverPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Refresh Data' }))

    expect(mockRescanArtists).toHaveBeenCalledTimes(1)
    const options = toastPromise.mock.calls[0]?.[1] as {
      success: (result: { attempted: number; updated: number; failed: number }) => string
    }
    expect(options.success({ attempted: 3, updated: 2, failed: 1 })).toBe(
      'Rescan complete: 2/3 updated; 1 failed.',
    )
  })

  it('hides shared metadata refresh from non-admin users', async () => {
    setupMockApi()
    mockGetAuthStatus.mockResolvedValue({ authenticated: true, isAdmin: false })
    mockGetCurrentUser.mockResolvedValue({ id: 2, username: 'user', isAdmin: false })
    renderWithQuery(<DiscoverPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))

    expect(screen.queryByRole('menuitem', { name: 'Refresh Data' })).not.toBeInTheDocument()
  })

  it('shows shared metadata refresh to cookie-authenticated admins', async () => {
    setupMockApi()
    mockGetCurrentUser.mockResolvedValue(null)
    mockGetAuthStatus.mockResolvedValue({ authenticated: true, isAdmin: true })
    renderWithQuery(<DiscoverPage />)

    await waitFor(() => expect(mockGetAuthStatus).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Refresh Data' })).toBeInTheDocument()
  })

  it('reject opens the reason picker, and rejecting without a reason sends no reason', async () => {
    mockUpdateRecommendation.mockResolvedValue(undefined as unknown as never)
    setupMockApi()

    renderWithQuery(<DiscoverPage />)

    await waitFor(() => {
      expect(screen.getByText('Test Artist')).toBeInTheDocument()
    })

    // "Reject" exact text (not "Rejected" tab)
    fireEvent.click(screen.getByText('Reject'))
    expect(mockUpdateRecommendation).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog', { name: /Why are you rejecting/ })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject without a reason' }))

    await waitFor(() => {
      expect(mockUpdateRecommendation).toHaveBeenCalledWith(1, { status: 'rejected' })
    })
  })

  it('the r shortcut opens the same picker and sends the chosen reason', async () => {
    mockUpdateRecommendation.mockResolvedValue(undefined as unknown as never)
    setupMockApi()

    renderWithQuery(<DiscoverPage />)
    await screen.findByText('Test Artist')

    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'r' })

    const dialog = await screen.findByRole('dialog', { name: /Why are you rejecting/ })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wrong genre or style for me' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))

    await waitFor(() => {
      expect(mockUpdateRecommendation).toHaveBeenCalledWith(1, {
        status: 'rejected',
        reason: 'wrong_style',
      })
    })
  })

  it('cancelling the picker leaves the recommendation untouched', async () => {
    setupMockApi()

    renderWithQuery(<DiscoverPage />)
    await screen.findByText('Test Artist')

    fireEvent.click(screen.getByText('Reject'))
    const dialog = await screen.findByRole('dialog', { name: /Why are you rejecting/ })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Why are you rejecting/ })).toBeNull()
    })
    expect(mockUpdateRecommendation).not.toHaveBeenCalled()
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

  it('keeps streaming links in the expanded card, off the decision face', async () => {
    setupMockApi()
    renderWithQuery(<DiscoverPage />)

    const card = await screen.findByTestId('rec-card-button')
    expect(screen.queryByTitle('Spotify')).toBeNull()
    fireEvent.click(card)
    expect(await screen.findByTitle('Spotify')).toBeInTheDocument()
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

  it.each([
    ['removes the artist block it created', makeRec(), 'Test Artist', 'artist', true],
    [
      'removes the album block it created',
      makeRec({
        kind: 'album',
        recommendedReleaseGroupId: 'rg-1',
        recommendedReleaseGroupTitle: 'Souvlaki',
      }),
      'Souvlaki by Test Artist',
      'album',
      true,
    ],
    ['keeps an artist block that already existed', makeRec(), 'Test Artist', 'artist', false],
  ])(
    'undo %s and names it in the toast',
    async (_label, rec, name, blockKind, blockCreated) => {
      localStorage.setItem('digarr:discover-view', 'stack')
      setupMockApi([rec])
      mockUpdateRecommendation.mockResolvedValue({ status: 'rejected', blockCreated })
      ;(deleteArtistBlock as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
      ;(deleteAlbumBlock as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      renderWithQuery(<DiscoverPage />)

      await screen.findAllByText('Test Artist')
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
      const dialog = await screen.findByRole('dialog', { name: /Why are you rejecting/ })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Wrong genre or style for me' }))
      fireEvent.click(within(dialog).getByLabelText(/show this artist again/i))
      fireEvent.click(within(dialog).getByRole('button', { name: 'Block forever' }))

      expect(await screen.findByText(`Rejected and blocked ${name}`)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      await waitFor(() => {
        expect(mockUpdateRecommendation).toHaveBeenLastCalledWith(1, { status: 'pending' })
      })
      if (!blockCreated) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(deleteArtistBlock).not.toHaveBeenCalled()
        expect(deleteAlbumBlock).not.toHaveBeenCalled()
      } else if (blockKind === 'album') {
        await waitFor(() => expect(deleteAlbumBlock).toHaveBeenCalledWith('rg-1'))
      } else {
        await waitFor(() => expect(deleteArtistBlock).toHaveBeenCalledWith(10))
      }
    },
    15_000,
  )
})
