// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Recommendation, RecommendationCard } from '@/web/components/recommendation-card'
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
}

function withPreview(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PreviewContext.Provider value={noopPreview}>{ui}</PreviewContext.Provider>
    </QueryClientProvider>,
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

  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(screen.getByText('Unknown Artist')).toBeInTheDocument()
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
})
