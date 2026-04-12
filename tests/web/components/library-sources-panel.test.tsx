// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LibrarySourcesPanel } from '@/web/components/library-sources-panel'
import { I18nProvider } from '@/web/lib/i18n'

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
  beforeEach(() => {
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
      },
    })
  })

  it('renders the album count when albumsSynced is present', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <LibrarySourcesPanel />
        </QueryClientProvider>
      </I18nProvider>,
    )

    expect(await screen.findByText(/4 artists/i)).toBeInTheDocument()
    expect(screen.getByText(/12 albums/i)).toBeInTheDocument()
  })

  it('renders a compact album progress bar when album counts exist', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <LibrarySourcesPanel />
        </QueryClientProvider>
      </I18nProvider>,
    )

    expect(await screen.findByText(/albums synced/i)).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByTestId('albums-bar-plex')).toBeInTheDocument()
  })
})
