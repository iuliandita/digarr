// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LibrarySourcesPanel } from '@/web/components/library-sources-panel'
import { I18nProvider } from '@/web/lib/i18n'
import { createTestQueryClient } from '../helpers/query'

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
          unreconciledAmbiguous: 2,
          unreconciledNoCandidate: 3,
          unreconciledLookupFailed: 4,
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
    const queryClient = createTestQueryClient()

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
    const queryClient = createTestQueryClient()

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

  it('counts failed lookups in the unreconciled summary', async () => {
    const queryClient = createTestQueryClient()

    render(
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <LibrarySourcesPanel />
        </QueryClientProvider>
      </I18nProvider>,
    )

    expect(await screen.findByText(/9 unreconciled/i)).toBeInTheDocument()
  })

  it('shows a running source as syncing and disables the sync buttons', async () => {
    const { getLibrarySources } = await import('@/web/lib/api')
    vi.mocked(getLibrarySources).mockResolvedValueOnce({
      sources: [
        {
          id: 1,
          userId: 1,
          source: 'lidarr',
          lastSyncStartedAt: new Date().toISOString(),
          lastSyncCompletedAt: null,
          lastSyncStatus: 'running',
          lastSyncError: null,
          lastSyncCounts: null,
        },
      ],
    })

    render(
      <I18nProvider>
        <QueryClientProvider client={createTestQueryClient()}>
          <LibrarySourcesPanel />
        </QueryClientProvider>
      </I18nProvider>,
    )

    expect(await screen.findByRole('button', { name: /syncing/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /sync all/i })).toBeDisabled()
  })
})
