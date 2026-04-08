// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/web/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/web/lib/api')>()
  return {
    ...actual,
    getLibraryAlbumCoverage: vi.fn(),
  }
})

import { LibraryAlbumCoverageBadge } from '@/web/components/library-album-coverage-badge'
import { getLibraryAlbumCoverage } from '@/web/lib/api'

const mockGetLibraryAlbumCoverage = vi.mocked(getLibraryAlbumCoverage)
const originalIntersectionObserver = globalThis.IntersectionObserver

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('LibraryAlbumCoverageBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLibraryAlbumCoverage.mockResolvedValue({
      artistMbid: 'artist-1',
      ownedCount: 3,
      totalCount: 8,
      owned: [{ albumMbid: 'owned-a', title: 'Owned A', releaseYear: 2001 }],
      missing: [{ albumMbid: 'missing-b', title: 'Missing B', releaseYear: 2004 }],
    })
  })

  afterEach(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver
  })

  it('renders compact coverage text when counts are available', async () => {
    renderWithQuery(<LibraryAlbumCoverageBadge artistMbid="artist-1" />)

    expect(
      await screen.findByRole('button', { name: 'You own 3/8 studio albums' }),
    ).toBeInTheDocument()
  })

  it('opens a popover with owned and missing albums', async () => {
    renderWithQuery(<LibraryAlbumCoverageBadge artistMbid="artist-1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'You own 3/8 studio albums' }))

    expect(screen.getByText('Owned')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.getByText('Owned A (2001)')).toBeInTheDocument()
    expect(screen.getByText('Missing B (2004)')).toBeInTheDocument()
  })

  it('waits to fetch until the badge is near the viewport when IntersectionObserver is available', async () => {
    let observerCallback: IntersectionObserverCallback | undefined

    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback
      }

      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return []
      }
      root = null
      rootMargin = '0px'
      scrollMargin = '0px'
      thresholds = []
    }

    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver

    renderWithQuery(<LibraryAlbumCoverageBadge artistMbid="artist-1" />)

    expect(mockGetLibraryAlbumCoverage).not.toHaveBeenCalled()
    expect(observerCallback).toBeDefined()
    if (!observerCallback) {
      throw new Error('Expected IntersectionObserver callback to be registered')
    }

    observerCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      new MockIntersectionObserver(() => {}) as unknown as IntersectionObserver,
    )

    await waitFor(() => {
      expect(mockGetLibraryAlbumCoverage).toHaveBeenCalledWith('artist-1')
    })
  })
})
