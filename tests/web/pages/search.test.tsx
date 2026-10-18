// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { getSearchSources, searchArtists } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { SearchPage } from '@/web/pages/search'

vi.mock('@/web/lib/api', () => ({
  getSearchSources: vi.fn(),
  searchArtists: vi.fn(),
}))

describe('SearchPage', () => {
  it('keeps sources collapsed and counts the ones narrowing the search', async () => {
    vi.mocked(getSearchSources).mockResolvedValue({
      sources: [
        { id: 'deezer', label: 'Deezer', available: true },
        { id: 'musicbrainz', label: 'MusicBrainz', available: true },
      ],
    } as Awaited<ReturnType<typeof getSearchSources>>)
    vi.mocked(searchArtists).mockResolvedValue({ results: [] })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider>
          <MemoryRouter>
            <SearchPage />
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    )

    const sources = screen.getByRole('button', { name: 'Sources' })
    expect(sources).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(sources)
    fireEvent.click(await screen.findByRole('button', { name: 'Deezer' }))
    expect(screen.queryByRole('button', { name: /Bandcamp|TIDAL/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sources (1)' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'boards' } })
    await waitFor(() => expect(searchArtists).toHaveBeenLastCalledWith('boards', ['deezer']))
  })
  it('shows experimental sources with badges when the source catalog includes them', async () => {
    vi.mocked(getSearchSources).mockResolvedValue({
      sources: [
        { id: 'tidal', label: 'TIDAL', available: true, stability: 'experimental' },
        { id: 'bandcamp', label: 'Bandcamp', available: true, stability: 'experimental' },
      ],
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider>
          <SearchPage />
        </I18nProvider>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    expect(await screen.findByRole('button', { name: /TIDAL.*Experimental/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bandcamp.*Experimental/ })).toBeInTheDocument()
  })
})
