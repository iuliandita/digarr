// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nProvider>
      <MemoryRouter>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </MemoryRouter>
    </I18nProvider>,
  )
}

vi.mock('@/web/lib/api', () => ({
  getLibraryUnreconciled: vi.fn(),
  getLibraryUnreconciledAlbums: vi.fn(),
  saveLibraryOverride: vi.fn(),
  saveLibraryAlbumOverride: vi.fn(),
  rerunLibraryReconciler: vi.fn(),
}))

import {
  getLibraryUnreconciled,
  getLibraryUnreconciledAlbums,
  rerunLibraryReconciler,
  saveLibraryOverride,
} from '@/web/lib/api'
import { LibraryReconciliationPage } from '@/web/pages/library-reconciliation'

const mockGetLibraryUnreconciled = vi.mocked(getLibraryUnreconciled)
const mockGetLibraryUnreconciledAlbums = vi.mocked(getLibraryUnreconciledAlbums)
const mockRerunLibraryReconciler = vi.mocked(rerunLibraryReconciler)
const mockSaveLibraryOverride = vi.mocked(saveLibraryOverride)

const makeRow = (
  overrides: Partial<{
    id: number
    source: string
    sourceArtistId: string
    name: string
    nameNormalized: string
  }> = {},
) => ({
  id: 1,
  userId: 1,
  source: 'plex',
  sourceArtistId: 'plex-1',
  name: 'Bush',
  nameNormalized: 'bush',
  mbid: null,
  matchMethod: null,
  matchConfidence: null,
  genres: ['rock'],
  syncedAt: '2026-04-07T12:00:00.000Z',
  ...overrides,
})

const makeAlbumRow = (
  overrides: Partial<{
    id: number
    source: string
    sourceAlbumId: string
    sourceArtistId: string
    title: string
    titleNormalized: string
    artistMbid: string | null
    releaseYear: number | null
    primaryType: string | null
  }> = {},
) => ({
  id: 11,
  userId: 1,
  source: 'plex',
  sourceAlbumId: 'alb-1',
  sourceArtistId: 'artist-1',
  title: 'Unknown Album',
  titleNormalized: 'unknown album',
  albumMbid: null,
  artistMbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
  releaseYear: 1999,
  primaryType: 'Album',
  syncedAt: '2026-04-07T12:00:00.000Z',
  ...overrides,
})

describe('LibraryReconciliationPage', () => {
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
    mockGetLibraryUnreconciledAlbums.mockResolvedValue({ items: [] })
    mockRerunLibraryReconciler.mockResolvedValue(undefined)
  })

  it('groups unreconciled rows by source', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({
      items: [
        makeRow(),
        makeRow({
          id: 2,
          sourceArtistId: 'plex-2',
          name: 'Failure',
          nameNormalized: 'failure',
        }),
        makeRow({
          id: 3,
          source: 'jellyfin',
          sourceArtistId: 'jf-1',
          name: 'Lolita',
          nameNormalized: 'lolita',
        }),
      ],
    })

    renderWithQuery(<LibraryReconciliationPage />)

    await waitFor(() => {
      expect(screen.getByText('plex (2)')).toBeInTheDocument()
    })

    expect(
      screen.getByText('3 artists could not be automatically matched to MusicBrainz.'),
    ).toBeInTheDocument()
    expect(screen.getByText('jellyfin (1)')).toBeInTheDocument()
    expect(screen.getByText('Bush')).toBeInTheDocument()
    expect(screen.getByText('Failure')).toBeInTheDocument()
    expect(screen.getByText('Lolita')).toBeInTheDocument()
  })

  it('renders a second section for unreconciled albums', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({ items: [] })
    mockGetLibraryUnreconciledAlbums.mockResolvedValue({ items: [makeAlbumRow()] })

    renderWithQuery(<LibraryReconciliationPage />)

    expect(await screen.findByText('Unreconciled Albums')).toBeInTheDocument()
    expect(await screen.findByText('Unknown Album')).toBeInTheDocument()
    expect(screen.getByText('plex - Album - 1999')).toBeInTheDocument()
  })

  it('shows a validation error for an invalid MBID', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({ items: [makeRow()] })

    renderWithQuery(<LibraryReconciliationPage />)

    const input = await screen.findByPlaceholderText('Paste MBID (UUID)')
    fireEvent.change(input, { target: { value: 'not-a-uuid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))

    expect(await screen.findByText('Not a valid MBID (UUID expected)')).toBeInTheDocument()
    expect(mockSaveLibraryOverride).not.toHaveBeenCalled()
  })

  it('shows a fetch error instead of the empty state when loading fails', async () => {
    mockGetLibraryUnreconciled.mockRejectedValue(new Error('network down'))

    renderWithQuery(<LibraryReconciliationPage />)

    expect(await screen.findByText('Could not load unreconciled artists.')).toBeInTheDocument()
    expect(screen.getByText('network down')).toBeInTheDocument()
    expect(
      screen.queryByText('No unreconciled artists. Your library is fully matched.'),
    ).not.toBeInTheDocument()
  })

  it('pins an MBID override and refreshes the page data', async () => {
    const row = makeRow()
    mockGetLibraryUnreconciled
      .mockResolvedValueOnce({ items: [row] })
      .mockResolvedValueOnce({ items: [] })
    mockSaveLibraryOverride.mockResolvedValue(undefined)

    renderWithQuery(<LibraryReconciliationPage />)

    const input = await screen.findByPlaceholderText('Paste MBID (UUID)')
    fireEvent.change(input, { target: { value: '123e4567-e89b-12d3-a456-426614174000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))

    await waitFor(() => {
      expect(mockSaveLibraryOverride).toHaveBeenCalledWith({
        source: 'plex',
        sourceArtistId: 'plex-1',
        correctMbid: '123e4567-e89b-12d3-a456-426614174000',
      })
    })
    expect(mockRerunLibraryReconciler).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(
        screen.getByText('No unreconciled artists. Your library is fully matched.'),
      ).toBeInTheDocument()
    })
  })

  it('ignores a row forever and refreshes the page data', async () => {
    const row = makeRow()
    mockGetLibraryUnreconciled
      .mockResolvedValueOnce({ items: [row] })
      .mockResolvedValueOnce({ items: [] })
    mockSaveLibraryOverride.mockResolvedValue(undefined)

    renderWithQuery(<LibraryReconciliationPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ignore forever' }))

    await waitFor(() => {
      expect(mockSaveLibraryOverride).toHaveBeenCalledWith({
        source: 'plex',
        sourceArtistId: 'plex-1',
        correctMbid: null,
      })
    })
    expect(mockRerunLibraryReconciler).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(
        screen.getByText('No unreconciled artists. Your library is fully matched.'),
      ).toBeInTheDocument()
    })
  })

  it('uses translated empty-state pagination copy in French', async () => {
    localStorage.setItem('digarr-locale', 'fr')
    mockGetLibraryUnreconciled.mockResolvedValue({ items: [] })

    renderWithQuery(<LibraryReconciliationPage />)

    expect(
      await screen.findByText(
        'Aucun artiste non rapproché. Votre bibliothèque est entièrement associée.',
      ),
    ).toBeInTheDocument()
  })
})
