// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LibrarySourcesPanel } from '@/web/components/library-sources-panel'

vi.mock('@/web/lib/api', () => ({
  getLibrarySources: vi.fn(async () => ({
    sources: [
      {
        id: 1,
        userId: 1,
        source: 'plex',
        lastSyncStartedAt: null,
        lastSyncCompletedAt: new Date().toISOString(),
        lastSyncStatus: 'completed',
        lastSyncError: null,
        lastSyncCounts: {
          total: 4,
          matchedMbid: 2,
          matchedNameExact: 1,
          matchedNameAnchored: 1,
          matchedDisambiguated: 0,
          unreconciledAmbiguous: 0,
          unreconciledNoCandidate: 0,
          cacheHits: 0,
          mbApiCalls: 0,
          albumsSynced: 12,
        },
      },
    ],
  })),
  triggerLibrarySync: vi.fn(),
}))

describe('LibrarySourcesPanel', () => {
  it('renders the album count when albumsSynced is present', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <LibrarySourcesPanel />
      </QueryClientProvider>,
    )

    expect(await screen.findByText(/4 artists/i)).toBeInTheDocument()
    expect(screen.getByText(/12 albums/i)).toBeInTheDocument()
  })
})
