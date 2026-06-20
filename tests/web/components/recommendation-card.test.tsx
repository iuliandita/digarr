// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

vi.mock('@/web/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/web/lib/api')>()
  return {
    ...actual,
    getArtistTopTracks: vi.fn().mockResolvedValue([]),
    getLibraryAlbumCoverage: vi.fn(),
  }
})

import { type Recommendation, RecommendationCard } from '@/web/components/recommendation-card'
import { getLibraryAlbumCoverage } from '@/web/lib/api'
import { PreviewContext } from '@/web/lib/preview-context'

// ---------------------------------------------------------------------------
// Preview context stub
// ---------------------------------------------------------------------------

const noopPreview = {
  play: vi.fn(),
  stop: vi.fn(),
  hasPreview: () => false,
  currentMbid: null,
  playing: false,
  globalPlayId: 0,
  volume: 1,
  setVolume: vi.fn(),
}

function withPreview(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <PreviewContext.Provider value={noopPreview}>{ui}</PreviewContext.Provider>
      </QueryClientProvider>
    </I18nProvider>,
  )
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const makeRec = (overrides: Partial<Recommendation> = {}): Recommendation => ({
  id: 1,
  score: 0.82,
  status: 'pending',
  aiReasoning: 'Great match for your indie taste.',
  sources: { listenbrainz: 0.9, lastfm: 0.7 },
  lidarrError: null,
  recommendedReleaseGroupId: null,
  recommendedReleaseGroupTitle: null,
  artist: {
    id: 10,
    name: 'Radiohead',
    mbid: 'mbid-001',
    disambiguation: null,
    genres: ['rock', 'alternative', 'art rock', 'electronic', 'experimental'],
    tags: null,
    imageUrl: null,
    streamingUrls: { spotify: 'https://open.spotify.com/artist/abc123' },
  },
  ...overrides,
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecommendationCard', () => {
  const onApprove = vi.fn()
  const onReject = vi.fn()
  const onClick = vi.fn()
  const mockGetLibraryAlbumCoverage = vi.mocked(getLibraryAlbumCoverage)

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLibraryAlbumCoverage.mockResolvedValue({
      artistMbid: 'mbid-001',
      ownedCount: 3,
      totalCount: 8,
      owned: [{ albumMbid: 'owned-a', title: 'Owned A', releaseYear: 2001 }],
      missing: [{ albumMbid: 'missing-b', title: 'Missing B', releaseYear: 2004 }],
    })
  })

  it('renders artist name and score badge', () => {
    withPreview(
      <RecommendationCard recommendation={makeRec()} onApprove={onApprove} onReject={onReject} />,
    )
    expect(screen.getByText('Radiohead')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
  })

  it('renders genre pills', () => {
    withPreview(
      <RecommendationCard recommendation={makeRec()} onApprove={onApprove} onReject={onReject} />,
    )
    // Default compact: max 3 genres shown
    expect(screen.getByText('rock')).toBeInTheDocument()
    expect(screen.getByText('alternative')).toBeInTheDocument()
    expect(screen.getByText('art rock')).toBeInTheDocument()
    // The remaining 2 are collapsed
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('approve button calls onApprove with correct id', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec({ id: 42 })}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    fireEvent.click(screen.getByText('Approve'))
    expect(onApprove).toHaveBeenCalledWith(42)
  })

  it('reject button calls onReject with correct id', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec({ id: 7 })}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    fireEvent.click(screen.getByText('Reject'))
    expect(onReject).toHaveBeenCalledWith(7)
  })

  it('click handler calls onClick with correct id', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec({ id: 5 })}
        onApprove={onApprove}
        onReject={onReject}
        onClick={onClick}
      />,
    )
    // Click on the card itself (the artist name text)
    fireEvent.click(screen.getByText('Radiohead'))
    expect(onClick).toHaveBeenCalledWith(5)
  })

  it('expanded state shows AI reasoning and source scores', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec()}
        onApprove={onApprove}
        onReject={onReject}
        expanded
      />,
    )
    expect(screen.getByText('Why this artist')).toBeInTheDocument()
    expect(screen.getByText('Great match for your indie taste.')).toBeInTheDocument()
    expect(screen.getByText('Source Scores')).toBeInTheDocument()
    expect(screen.getByText('LB')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
  })

  it('expanded state shows more genre pills', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec()}
        onApprove={onApprove}
        onReject={onReject}
        expanded
      />,
    )
    // Expanded: max 8, we have 5 genres so all should show
    expect(screen.getByText('electronic')).toBeInTheDocument()
    expect(screen.getByText('experimental')).toBeInTheDocument()
    expect(screen.queryByText('+2')).not.toBeInTheDocument()
  })

  it('selected state applies border highlight', () => {
    const { container } = withPreview(
      <RecommendationCard
        recommendation={makeRec()}
        onApprove={onApprove}
        onReject={onReject}
        isSelected
      />,
    )
    const wrapper = container.firstElementChild as HTMLElement
    const card = wrapper.querySelector('[data-testid="rec-card-button"]') as HTMLElement
    expect(card.className).toContain('border-accent')
  })

  it('handles missing optional fields gracefully', () => {
    const rec = makeRec({
      aiReasoning: null,
      sources: null,
      artist: {
        id: 10,
        name: 'Unknown Artist',
        mbid: 'mbid-002',
        disambiguation: null,
        genres: null,
        tags: null,
        imageUrl: null,
        streamingUrls: null,
      },
    })
    withPreview(
      <RecommendationCard
        recommendation={rec}
        onApprove={onApprove}
        onReject={onReject}
        expanded
      />,
    )
    expect(screen.getAllByText('Unknown Artist').length).toBeGreaterThan(0)
    // No AI reasoning section
    expect(screen.queryByText('Why this artist')).not.toBeInTheDocument()
    // No source scores section
    expect(screen.queryByText('Source Scores')).not.toBeInTheDocument()
  })

  it('shows Restore button for rejected recs instead of Approve/Reject', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec({ status: 'rejected' })}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('Restore')).toBeInTheDocument()
    expect(screen.queryByText('Approve')).not.toBeInTheDocument()
  })

  it('shows Add Failed status with error message', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec({ status: 'add_failed', lidarrError: 'Artist not found in MB' })}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    expect(screen.getByText('Add Failed')).toBeInTheDocument()
    expect(screen.getByText('Artist not found in MB')).toBeInTheDocument()
  })

  it('shows failed target action errors when Lidarr succeeded but another target failed', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec({
          status: 'added_to_lidarr',
          targetActions: {
            'lidarr-1': { status: 'added' },
            'slskd-7': { status: 'failed', error: 'slskd queue failed' },
          },
        })}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    expect(screen.getByText('Added to Lidarr')).toBeInTheDocument()
    expect(screen.getByText('slskd queue failed')).toBeInTheDocument()
  })

  it.each([
    ['queued', 'Queued in slskd'],
    ['downloading', 'Downloading in slskd'],
    ['import_pending', 'Waiting for Lidarr import'],
    ['needs_review', 'Needs review'],
  ])('renders the slskd %s state from target actions', (actionStatus, expectedLabel) => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec({
          status: 'approved',
          targetActions: {
            'slskd-7': { status: actionStatus },
          },
        })}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    expect(screen.getByText(expectedLabel)).toBeInTheDocument()
  })

  it('renders the slskd queue state alongside Lidarr success', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec({
          status: 'added_to_lidarr',
          targetActions: {
            'lidarr-1': { status: 'added' },
            'slskd-7': { status: 'queued' },
          },
        })}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    expect(screen.getByText('Added to Lidarr')).toBeInTheDocument()
    expect(screen.getByText('Queued in slskd')).toBeInTheDocument()
  })

  it('hides playlist-only targets from the approve dropdown', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec()}
        onApprove={onApprove}
        onReject={onReject}
        targets={[
          { id: 1, type: 'lidarr', name: 'Main Lidarr' },
          { id: 2, type: 'spotify-playlist', name: 'Spotify Mixes' },
        ]}
        onApproveToTarget={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '' })).not.toBeInTheDocument()
    expect(screen.getByText('Approve')).toBeInTheDocument()
    expect(screen.queryByText('Add to Spotify playlist')).not.toBeInTheDocument()
  })

  it('shows slskd as an approvable target in the dropdown', () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec()}
        onApprove={onApprove}
        onReject={onReject}
        targets={[
          { id: 1, type: 'lidarr', name: 'Main Lidarr' },
          { id: 7, type: 'slskd', name: 'slskd' },
        ]}
        onApproveToTarget={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '' }))

    expect(screen.getByText('Add to Main Lidarr')).toBeInTheDocument()
    expect(screen.getByText('Add to slskd')).toBeInTheDocument()
  })

  it('routes the primary approve button to slskd when it is the only target', () => {
    const onApproveToTarget = vi.fn()

    withPreview(
      <RecommendationCard
        recommendation={makeRec()}
        onApprove={onApprove}
        onReject={onReject}
        targets={[{ id: 7, type: 'slskd', name: 'slskd' }]}
        onApproveToTarget={onApproveToTarget}
      />,
    )

    fireEvent.click(screen.getByText('Approve'))

    expect(onApproveToTarget).toHaveBeenCalledWith(1, 'slskd-7')
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('renders album coverage when the artist has library data', async () => {
    withPreview(
      <RecommendationCard recommendation={makeRec()} onApprove={onApprove} onReject={onReject} />,
    )

    expect(
      await screen.findByRole('button', { name: 'You own 3/8 studio albums' }),
    ).toBeInTheDocument()
  })

  it('clicking the album coverage badge does not fire the parent card onClick', async () => {
    withPreview(
      <RecommendationCard
        recommendation={makeRec()}
        onApprove={onApprove}
        onReject={onReject}
        onClick={onClick}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'You own 3/8 studio albums' }))

    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByText('Owned')).toBeInTheDocument()
  })
})
