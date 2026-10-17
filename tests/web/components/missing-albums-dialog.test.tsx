// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { MissingAlbumsDialog } from '@/web/components/missing-albums-dialog'
import { SwipeCard } from '@/web/components/swipe-card'
import {
  approveMissingAlbums,
  getLibraryAlbumCoverage,
  type LibraryAlbumCoverage,
} from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

vi.mock('@/web/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/web/lib/api')>()),
  getLibraryAlbumCoverage: vi.fn(),
  approveMissingAlbums: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

import { toast } from 'sonner'

it('loads preselected albums, excludes unchecked albums, and retries only mixed-result failures', async () => {
  let resolveCoverage!: (coverage: LibraryAlbumCoverage) => void
  vi.mocked(getLibraryAlbumCoverage).mockReturnValue(
    new Promise((resolve) => {
      resolveCoverage = resolve
    }),
  )
  vi.mocked(approveMissingAlbums)
    .mockResolvedValueOnce({
      results: [
        { albumMbid: 'a', success: true, targetActions: {} },
        { albumMbid: 'b', success: false, targetActions: { lidarr: { status: 'failed' } } },
      ],
      succeeded: 1,
      failed: 1,
    })
    .mockResolvedValueOnce({
      results: [{ albumMbid: 'b', success: true, targetActions: {} }],
      succeeded: 1,
      failed: 0,
    })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const swipe = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <SwipeCard onSwipeLeft={swipe} onSwipeRight={swipe}>
        <button type="button" onClick={() => setOpen(true)}>
          Get missing albums
        </button>
        <MissingAlbumsDialog
          open={open}
          onClose={() => setOpen(false)}
          artistId={42}
          artistMbid="artist-mbid"
          artistName="Test Artist"
        />
      </SwipeCard>
    )
  }
  render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    </I18nProvider>,
  )
  const opener = screen.getByRole('button', { name: 'Get missing albums' })
  opener.focus()
  fireEvent.click(opener)
  expect(screen.getByRole('dialog', { name: 'Missing studio albums' })).toBeInTheDocument()
  expect(screen.getByText('Loading...')).toBeInTheDocument()
  expect(getLibraryAlbumCoverage).toHaveBeenCalledWith('artist-mbid')
  resolveCoverage({
    artistMbid: 'artist-mbid',
    ownedCount: 0,
    totalCount: 3,
    owned: [],
    missing: [
      { albumMbid: 'a', title: 'Album A', releaseYear: 2001 },
      { albumMbid: 'b', title: 'Album B', releaseYear: 2002 },
      { albumMbid: 'c', title: 'Album C', releaseYear: null },
    ],
  })
  expect(await screen.findByText('3 of 3 selected')).toBeInTheDocument()
  const dialog = screen.getByRole('dialog')
  fireEvent.touchStart(dialog, { touches: [{ clientX: 0, clientY: 0 }] })
  fireEvent.touchMove(dialog, { touches: [{ clientX: 200, clientY: 0 }] })
  fireEvent.touchEnd(dialog)
  expect(swipe).not.toHaveBeenCalled()
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Album C' }))
  expect(screen.getByText('2 of 3 selected')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Get selected albums' }))
  expect(await screen.findByText('1 approved, 1 failed.')).toBeInTheDocument()
  expect(approveMissingAlbums).toHaveBeenNthCalledWith(1, 42, ['a', 'b'])
  expect(screen.getByRole('checkbox', { name: /Album A/ })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: /Album B/ })).toBeChecked()
  expect(screen.getByText('Failed - try again')).toBeInTheDocument()
  expect(screen.getByText('1 of 3 selected')).toBeInTheDocument()
  expect(toast.success).not.toHaveBeenCalled()
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['library-album-coverage', 'artist-mbid'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['recommendations'] })
  fireEvent.click(screen.getByRole('button', { name: 'Get selected albums' }))
  await waitFor(() => expect(approveMissingAlbums).toHaveBeenNthCalledWith(2, 42, ['b']))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(toast.success).toHaveBeenCalledWith('2 approved, 0 failed.')
  expect(opener).toHaveFocus()
  client.clear()
})
