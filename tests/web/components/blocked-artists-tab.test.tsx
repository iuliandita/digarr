// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BlockedArtistsTab } from '@/web/components/blocked-artists-tab'
import { listArtistBlocks } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/web/lib/api', () => ({
  listArtistBlocks: vi.fn(),
  deleteArtistBlock: vi.fn(),
  createArtistBlock: vi.fn(),
}))

type Page = Awaited<ReturnType<typeof listArtistBlocks>>

const row = (artistId: number) => ({
  artistId,
  name: `Artist ${artistId}`,
  mbid: null,
  reason: null,
  reasonText: null,
  blockedAt: '2026-01-01T00:00:00Z',
})

function deferred() {
  let resolve: (v: Page) => void = () => {}
  const promise = new Promise<Page>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function renderTab() {
  return render(
    <I18nProvider>
      <BlockedArtistsTab />
    </I18nProvider>,
  )
}

describe('BlockedArtistsTab load more', () => {
  it('is single-flight and does not append duplicates', async () => {
    const page2 = deferred()
    vi.mocked(listArtistBlocks).mockReset()
    vi.mocked(listArtistBlocks)
      .mockResolvedValueOnce({ items: [row(1), row(2)], nextCursor: 'c1' })
      .mockReturnValueOnce(page2.promise)
    renderTab()
    const button = await screen.findByText('Load more', {}, { timeout: 2000 })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(listArtistBlocks).toHaveBeenCalledTimes(2)
    await act(async () => page2.resolve({ items: [row(2), row(3)], nextCursor: null }))
    await waitFor(() => expect(screen.getByText('Artist 3')).toBeInTheDocument())
    expect(screen.getAllByText('Artist 2')).toHaveLength(1)
  })

  it('discards a page that lands after the search changed', async () => {
    const page2 = deferred()
    vi.mocked(listArtistBlocks).mockReset()
    vi.mocked(listArtistBlocks)
      .mockResolvedValueOnce({ items: [row(1)], nextCursor: 'c1' })
      .mockReturnValueOnce(page2.promise)
      .mockResolvedValue({ items: [row(9)], nextCursor: null })
    renderTab()
    fireEvent.click(await screen.findByText('Load more', {}, { timeout: 2000 }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zz' } })
    await act(async () => page2.resolve({ items: [row(5)], nextCursor: null }))
    await screen.findByText('Artist 9', {}, { timeout: 2000 })
    expect(screen.queryByText('Artist 5')).not.toBeInTheDocument()
  })
})
