// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return {
    client,
    ...render(
      <I18nProvider>
        <MemoryRouter>
          <QueryClientProvider client={client}>{ui}</QueryClientProvider>
        </MemoryRouter>
      </I18nProvider>,
    ),
  }
}

vi.mock('@/web/lib/api', () => ({
  getLibraryUnreconciled: vi.fn(),
  getLibraryUnreconciledAlbums: vi.fn(),
  saveLibraryOverride: vi.fn(),
  saveLibraryAlbumOverride: vi.fn(),
  rerunLibraryReconciler: vi.fn(),
  bulkIgnoreLibraryArtists: vi.fn(),
  bulkIgnoreLibraryAlbums: vi.fn(),
}))

import {
  bulkIgnoreLibraryAlbums,
  bulkIgnoreLibraryArtists,
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
const mockBulkIgnoreLibraryArtists = vi.mocked(bulkIgnoreLibraryArtists)
const mockBulkIgnoreLibraryAlbums = vi.mocked(bulkIgnoreLibraryAlbums)

const makeRow = (
  overrides: Partial<{
    id: number
    source: string
    sourceArtistId: string
    name: string
    nameNormalized: string
    unreconciledReason: 'ambiguous' | 'no_candidate' | 'lookup_failed' | null
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
  unreconciledReason: null,
  genres: ['rock'],
  syncedAt: '2026-04-07T12:00:00.000Z',
  lastGapCheckAt: null,
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
    unreconciledReason: 'ambiguous' | 'no_candidate' | 'lookup_failed' | null
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
  matchMethod: null,
  matchConfidence: null,
  unreconciledReason: null,
  syncedAt: '2026-04-07T12:00:00.000Z',
  ...overrides,
})

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

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
    mockBulkIgnoreLibraryArtists.mockResolvedValue(undefined)
    mockBulkIgnoreLibraryAlbums.mockResolvedValue(undefined)
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
    mockGetLibraryUnreconciledAlbums.mockResolvedValue({
      items: [makeAlbumRow({ unreconciledReason: 'no_candidate' })],
    })

    renderWithQuery(<LibraryReconciliationPage />)

    expect(await screen.findByText('Unreconciled Albums')).toBeInTheDocument()
    expect(await screen.findByText('Unknown Album')).toBeInTheDocument()
    expect(screen.getByText('plex - Album - 1999')).toBeInTheDocument()
    expect(screen.getByText('No match found')).toBeInTheDocument()
  })

  it('shows reasons and keeps row actions available when lookup failed', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({
      items: [
        makeRow({ id: 1, unreconciledReason: 'ambiguous' }),
        makeRow({
          id: 2,
          sourceArtistId: 'plex-2',
          name: 'Retry later',
          unreconciledReason: 'lookup_failed',
        }),
        makeRow({ id: 3, sourceArtistId: 'plex-3', name: 'Legacy row', unreconciledReason: null }),
      ],
    })

    renderWithQuery(<LibraryReconciliationPage />)

    expect(await screen.findByText('Ambiguous match')).toBeInTheDocument()
    expect(screen.getByText('Lookup failed')).toBeInTheDocument()
    expect(screen.getByText('Needs review')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select artist Retry later' })).toBeDisabled()
    const lookupFailedRow = screen.getByRole('group', { name: 'Retry later' })
    expect(within(lookupFailedRow).getByRole('button', { name: 'Pin' })).toBeEnabled()
    expect(within(lookupFailedRow).getByRole('button', { name: 'Ignore forever' })).toBeEnabled()
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

  it('uses French reason and bulk confirmation copy', async () => {
    localStorage.setItem('digarr-locale', 'fr')
    mockGetLibraryUnreconciled.mockResolvedValue({
      items: [makeRow({ unreconciledReason: 'ambiguous' })],
    })

    renderWithQuery(<LibraryReconciliationPage />)

    expect(await screen.findByText('Correspondance ambiguë')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sélectionner l’artiste Bush' }))
    expect(screen.getByText('Sélection : 1')).toBeInTheDocument()

    const artists = screen.getByRole('region', { name: 'Artistes non rapprochés' })
    fireEvent.click(within(artists).getByRole('button', { name: 'Ignorer la sélection' }))
    expect(
      screen.getByRole('dialog', { name: 'Ignorer les artistes sélectionnés ?' }),
    ).toHaveTextContent(
      'Sélection : 1. Cette sélection restera ignorée jusqu’à la suppression de ses corrections enregistrées.',
    )
  })

  it('uses count-neutral English confirmation copy for one selected artist', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({ items: [makeRow()] })

    renderWithQuery(<LibraryReconciliationPage />)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select artist Bush' }))
    const artists = screen.getByRole('region', { name: 'Unreconciled Artists' })
    fireEvent.click(within(artists).getByRole('button', { name: 'Ignore selected' }))

    expect(screen.getByRole('dialog', { name: 'Ignore selected artists?' })).toHaveTextContent(
      'Selected: 1. This selection will stay ignored until its saved overrides are removed.',
    )
  })

  it('bulk ignores selected artists without rerunning reconciliation', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({
      items: [
        makeRow(),
        makeRow({ id: 2, source: 'jellyfin', sourceArtistId: 'jf-2', name: 'Failure' }),
      ],
    })
    mockGetLibraryUnreconciledAlbums.mockResolvedValue({ items: [makeAlbumRow()] })
    let resolvePending: () => void = () => undefined
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve
    })
    mockBulkIgnoreLibraryArtists.mockReturnValueOnce(pending)
    const { client } = renderWithQuery(<LibraryReconciliationPage />)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select artist Bush' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select artist Failure' }))

    const albums = await screen.findByRole('region', { name: 'Unreconciled Albums' })
    fireEvent.click(
      await within(albums).findByRole('checkbox', { name: 'Select album Unknown Album' }),
    )

    const artists = screen.getByRole('region', { name: 'Unreconciled Artists' })
    expect(within(artists).getByText('Selected: 2')).toBeInTheDocument()
    fireEvent.click(within(artists).getByRole('button', { name: 'Ignore selected' }))
    expect(screen.getByRole('dialog', { name: 'Ignore selected artists?' })).toHaveTextContent(
      'Selected: 2. This selection will stay ignored until its saved overrides are removed.',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockBulkIgnoreLibraryArtists).toHaveBeenCalledWith([
      { source: 'plex', sourceArtistId: 'plex-1' },
      { source: 'jellyfin', sourceArtistId: 'jf-2' },
    ])
    expect(mockRerunLibraryReconciler).not.toHaveBeenCalled()

    resolvePending()
    await waitFor(() => {
      expect(within(artists).getByText('Selected: 0')).toBeInTheDocument()
    })
    expect(within(albums).getByText('Selected: 1')).toBeInTheDocument()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['library', 'unreconciled'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['library', 'unreconciled-albums'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['library', 'sources'] })
  })

  it('selects one album page at a time and retains selection after a failed bulk ignore', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({ items: [makeRow()] })
    mockGetLibraryUnreconciledAlbums.mockResolvedValue({
      items: Array.from({ length: 21 }, (_, index) =>
        makeAlbumRow({
          id: index + 1,
          sourceAlbumId: `album-${index + 1}`,
          title: `Album ${index + 1}`,
        }),
      ),
    })
    mockBulkIgnoreLibraryAlbums.mockRejectedValueOnce(new Error('network down'))

    renderWithQuery(<LibraryReconciliationPage />)
    const artists = await screen.findByRole('region', { name: 'Unreconciled Artists' })
    fireEvent.click(await within(artists).findByRole('checkbox', { name: 'Select artist Bush' }))
    const albums = await screen.findByRole('region', { name: 'Unreconciled Albums' })
    fireEvent.click(await within(albums).findByRole('button', { name: 'Select visible' }))
    expect(within(albums).getByText('Selected: 20')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select album Album 1' })).toBeChecked()
    expect(
      screen.queryByRole('checkbox', { name: 'Select album Album 21' }),
    ).not.toBeInTheDocument()

    fireEvent.click(within(albums).getByRole('button', { name: 'Next' }))
    expect(await within(albums).findByText('Selected: 0')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select album Album 21' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select artist Bush' })).toBeChecked()
    expect(within(artists).getByText('Selected: 1')).toBeInTheDocument()

    fireEvent.click(within(albums).getByRole('checkbox', { name: 'Select album Album 21' }))
    fireEvent.click(within(albums).getByRole('button', { name: 'Ignore selected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => {
      expect(mockBulkIgnoreLibraryAlbums).toHaveBeenCalledWith([
        { source: 'plex', sourceAlbumId: 'album-21' },
      ])
    })
    expect(within(albums).getByText('Selected: 1')).toBeInTheDocument()
    expect(within(albums).getByRole('alert')).toHaveTextContent(
      'Could not ignore the selected items.',
    )
    expect(within(artists).getByText('Selected: 1')).toBeInTheDocument()

    fireEvent.click(within(albums).getByRole('button', { name: 'Ignore selected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => {
      expect(mockBulkIgnoreLibraryAlbums).toHaveBeenLastCalledWith([
        { source: 'plex', sourceAlbumId: 'album-21' },
      ])
      expect(within(albums).getByText('Selected: 0')).toBeInTheDocument()
    })
    expect(within(artists).getByText('Selected: 1')).toBeInTheDocument()
  })

  it('caps artist selection at 200 eligible rows and excludes lookup failures', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({
      items: Array.from({ length: 202 }, (_, index) =>
        makeRow({
          id: index + 1,
          sourceArtistId: `artist-${index + 1}`,
          name: `Artist ${index + 1}`,
          unreconciledReason: index === 201 ? 'lookup_failed' : null,
        }),
      ),
    })

    renderWithQuery(<LibraryReconciliationPage />)
    const artists = (await screen.findByText('Artist 202')).closest<HTMLElement>(
      'section[aria-label="Unreconciled Artists"]',
    )
    if (!artists) throw new Error('Missing unreconciled artists section')
    const checkbox = (artist: number) => {
      const element = artists.querySelector<HTMLInputElement>(
        `input[aria-label="Select artist Artist ${artist}"]`,
      )
      if (!element) throw new Error(`Missing artist ${artist} checkbox`)
      return element
    }
    const status = artists.querySelector<HTMLElement>('[role="status"]')
    if (!status) throw new Error('Missing artist selection status')
    const artist1 = checkbox(1)
    const artist201 = checkbox(201)
    const artist202 = checkbox(202)

    fireEvent.click(within(artists).getByText('Select visible', { selector: 'button' }))
    expect(status).toHaveTextContent('Selected: 200')
    expect(status).toHaveTextContent('At most 200 items can be selected at once.')
    expect(artist201).toBeDisabled()
    expect(artist202).toBeDisabled()

    fireEvent.click(artist1)
    expect(within(artists).getByText('Selected: 199')).toBeInTheDocument()
    expect(artist201).toBeEnabled()
    fireEvent.click(artist201)
    expect(status).toHaveTextContent('Selected: 200')

    fireEvent.click(within(artists).getByText('Ignore selected', { selector: 'button' }))
    fireEvent.click(screen.getByText('Confirm', { selector: 'button' }))
    await waitFor(() => {
      expect(mockBulkIgnoreLibraryArtists).toHaveBeenCalledTimes(1)
    })
    const payload = mockBulkIgnoreLibraryArtists.mock.calls[0]?.[0] ?? []
    expect(payload).toHaveLength(200)
    expect(payload).not.toContainEqual({ source: 'plex', sourceArtistId: 'artist-202' })
    expect(payload).toContainEqual({ source: 'plex', sourceArtistId: 'artist-201' })
  })

  it('keeps artist and album bulk requests independently busy', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({
      items: [makeRow(), makeRow({ id: 2, sourceArtistId: 'plex-2', name: 'Failure' })],
    })
    mockGetLibraryUnreconciledAlbums.mockResolvedValue({
      items: [
        makeAlbumRow(),
        makeAlbumRow({ id: 12, sourceAlbumId: 'album-2', title: 'Second Album' }),
      ],
    })
    const artistRequest = deferred<void>()
    const albumRequest = deferred<void>()
    mockBulkIgnoreLibraryArtists.mockReturnValueOnce(artistRequest.promise)
    mockBulkIgnoreLibraryAlbums.mockReturnValueOnce(albumRequest.promise)

    renderWithQuery(<LibraryReconciliationPage />)
    const artists = await screen.findByRole('region', { name: 'Unreconciled Artists' })
    const albums = await screen.findByRole('region', { name: 'Unreconciled Albums' })
    const artistCheckbox = await within(artists).findByRole('checkbox', {
      name: 'Select artist Bush',
    })
    const albumCheckbox = await within(albums).findByRole('checkbox', {
      name: 'Select album Unknown Album',
    })
    fireEvent.click(artistCheckbox)
    fireEvent.click(albumCheckbox)

    fireEvent.click(within(artists).getByRole('button', { name: 'Ignore selected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mockBulkIgnoreLibraryArtists).toHaveBeenCalledTimes(1))

    expect(artistCheckbox).toBeDisabled()
    expect(within(artists).getByRole('button', { name: 'Select visible' })).toBeDisabled()
    expect(within(artists).getByRole('button', { name: 'Clear visible' })).toBeDisabled()
    expect(within(artists).getByRole('button', { name: 'Ignore selected' })).toBeDisabled()
    const artistRow = within(artists).getByRole('group', { name: 'Bush' })
    expect(within(artistRow).getByRole('button', { name: 'Pin' })).toBeDisabled()
    expect(within(artistRow).getByRole('button', { name: 'Ignore forever' })).toBeDisabled()
    fireEvent.click(within(artists).getByRole('button', { name: 'Ignore selected' }))
    expect(mockBulkIgnoreLibraryArtists).toHaveBeenCalledTimes(1)

    expect(albumCheckbox).toBeEnabled()
    expect(within(albums).getByRole('button', { name: 'Select visible' })).toBeEnabled()
    expect(within(albums).getByRole('button', { name: 'Clear visible' })).toBeEnabled()
    expect(within(albums).getByRole('button', { name: 'Ignore selected' })).toBeEnabled()
    const albumRow = within(albums).getByRole('group', { name: 'Unknown Album' })
    expect(within(albumRow).getByRole('button', { name: 'Pin' })).toBeEnabled()
    expect(within(albumRow).getByRole('button', { name: 'Ignore forever' })).toBeEnabled()

    fireEvent.click(within(albums).getByRole('button', { name: 'Ignore selected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mockBulkIgnoreLibraryAlbums).toHaveBeenCalledTimes(1))

    expect(artistCheckbox).toBeDisabled()
    expect(albumCheckbox).toBeDisabled()
    expect(within(albums).getByRole('button', { name: 'Ignore selected' })).toBeDisabled()
    expect(within(albumRow).getByRole('button', { name: 'Pin' })).toBeDisabled()
    expect(within(albumRow).getByRole('button', { name: 'Ignore forever' })).toBeDisabled()

    artistRequest.resolve()
    await waitFor(() => {
      expect(within(artists).getByText('Selected: 0')).toBeInTheDocument()
    })
    expect(albumCheckbox).toBeDisabled()
    expect(within(albums).getByText('Selected: 1')).toBeInTheDocument()

    albumRequest.reject(new Error('network down'))
    await waitFor(() => {
      expect(within(albums).getByRole('alert')).toHaveTextContent(
        'Could not ignore the selected items.',
      )
    })
    expect(albumCheckbox).toBeEnabled()
    expect(within(albums).getByText('Selected: 1')).toBeInTheDocument()
  })

  it('keeps artist controls busy until bulk invalidations settle', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({ items: [makeRow()] })
    const request = deferred<void>()
    const firstInvalidation = deferred<void>()
    const secondInvalidation = deferred<void>()
    const thirdInvalidation = deferred<void>()
    const invalidations = [firstInvalidation, secondInvalidation, thirdInvalidation]
    mockBulkIgnoreLibraryArtists.mockReturnValueOnce(request.promise)
    const { client } = renderWithQuery(<LibraryReconciliationPage />)
    vi.spyOn(client, 'invalidateQueries')
      .mockReturnValueOnce(firstInvalidation.promise)
      .mockReturnValueOnce(secondInvalidation.promise)
      .mockReturnValueOnce(thirdInvalidation.promise)

    const artists = await screen.findByRole('region', { name: 'Unreconciled Artists' })
    const checkbox = await within(artists).findByRole('checkbox', { name: 'Select artist Bush' })
    fireEvent.click(checkbox)
    fireEvent.click(within(artists).getByRole('button', { name: 'Ignore selected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mockBulkIgnoreLibraryArtists).toHaveBeenCalledTimes(1))

    request.resolve()
    await waitFor(() => expect(client.invalidateQueries).toHaveBeenCalledTimes(3))
    expect(checkbox).toBeDisabled()
    expect(within(artists).getByRole('button', { name: 'Ignore selected' })).toBeDisabled()

    for (const invalidation of invalidations) invalidation.resolve()
    await waitFor(() => expect(within(artists).getByText('Selected: 0')).toBeInTheDocument())
    expect(checkbox).toBeEnabled()
  })

  it('clamps a stale album page immediately when refetched data shrinks', async () => {
    const albums = Array.from({ length: 21 }, (_, index) =>
      makeAlbumRow({
        id: index + 1,
        sourceAlbumId: `album-${index + 1}`,
        title: `Album ${index + 1}`,
      }),
    )
    mockGetLibraryUnreconciled.mockResolvedValue({ items: [] })
    mockGetLibraryUnreconciledAlbums.mockResolvedValue({ items: albums })

    const { client } = renderWithQuery(<LibraryReconciliationPage />)
    const albumsRegion = await screen.findByRole('region', { name: 'Unreconciled Albums' })
    fireEvent.click(await within(albumsRegion).findByRole('button', { name: 'Next' }))
    fireEvent.click(within(albumsRegion).getByRole('checkbox', { name: 'Select album Album 21' }))
    expect(within(albumsRegion).getByText('Selected: 1')).toBeInTheDocument()

    client.setQueryData(['library', 'unreconciled-albums'], { items: albums.slice(0, 20) })

    expect(
      await within(albumsRegion).findByRole('checkbox', { name: 'Select album Album 1' }),
    ).toBeInTheDocument()
    expect(within(albumsRegion).queryByText('Showing 21-20 of 20')).not.toBeInTheDocument()
    await waitFor(() => expect(within(albumsRegion).getByText('Selected: 0')).toBeInTheDocument())
  })

  it('closes a stale artist confirmation without submitting after query pruning', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({ items: [makeRow()] })
    const { client } = renderWithQuery(<LibraryReconciliationPage />)
    const artists = await screen.findByRole('region', { name: 'Unreconciled Artists' })
    fireEvent.click(await within(artists).findByRole('checkbox', { name: 'Select artist Bush' }))
    fireEvent.click(within(artists).getByRole('button', { name: 'Ignore selected' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    client.setQueryData(['library', 'unreconciled'], {
      items: [makeRow({ unreconciledReason: 'lookup_failed' })],
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockBulkIgnoreLibraryArtists).not.toHaveBeenCalled()
    expect(within(artists).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('moves focus to the artist section when a confirmed bulk request removes its dialog', async () => {
    mockGetLibraryUnreconciled.mockResolvedValue({ items: [makeRow()] })
    const request = deferred<void>()
    const firstInvalidation = deferred<void>()
    const secondInvalidation = deferred<void>()
    const thirdInvalidation = deferred<void>()
    mockBulkIgnoreLibraryArtists.mockReturnValueOnce(request.promise)
    const { client } = renderWithQuery(<LibraryReconciliationPage />)
    vi.spyOn(client, 'invalidateQueries')
      .mockReturnValueOnce(firstInvalidation.promise)
      .mockReturnValueOnce(secondInvalidation.promise)
      .mockReturnValueOnce(thirdInvalidation.promise)

    const artists = await screen.findByRole('region', { name: 'Unreconciled Artists' })
    fireEvent.click(await within(artists).findByRole('checkbox', { name: 'Select artist Bush' }))
    const ignore = within(artists).getByRole('button', { name: 'Ignore selected' })
    ignore.focus()
    fireEvent.click(ignore)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mockBulkIgnoreLibraryArtists).toHaveBeenCalledTimes(1))
    expect(ignore).toBeDisabled()
    expect(artists).toHaveFocus()
    expect(document.body).not.toHaveFocus()

    request.resolve()
    firstInvalidation.resolve()
    secondInvalidation.resolve()
    thirdInvalidation.resolve()
    await waitFor(() => expect(within(artists).getByText('Selected: 0')).toBeInTheDocument())
  })
})
