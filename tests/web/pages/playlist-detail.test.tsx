// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { getPlaylist, updateRecommendation } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { PlaylistDetailPage } from '@/web/pages/playlist-detail'

vi.mock('@/web/lib/api', () => ({
  getPlaylist: vi.fn(),
  getUserPreferences: vi.fn().mockResolvedValue({}),
  updateUserPreferences: vi.fn(),
  updateRecommendation: vi.fn(),
  exportPlaylistApi: vi.fn(),
  generatePlaylistApi: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

beforeEach(() => vi.clearAllMocks())

it.each([12, undefined])(
  'requires a matched pending recommendation before approving an Audition track: %s',
  async (recommendationId) => {
    vi.mocked(getPlaylist).mockResolvedValue({
      playlist: {
        id: 1,
        userId: 1,
        config: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        name: 'Audition',
        strategy: 'audition',
        targetIds: [],
        enabled: true,
        schedule: null,
        lastGeneratedAt: null,
        trackCount: 1,
      },
      tracks: [
        {
          id: 7,
          playlistId: 1,
          artistName: 'Radiohead',
          trackName: 'Creep',
          spotifyUri: 'spotify:track:abc',
          mbid: null,
          deezerId: null,
          localPath: null,
          position: 0,
          recommendationId,
        },
      ],
      generation: null,
    })
    vi.mocked(updateRecommendation).mockResolvedValue({ status: 'approved' })
    render(
      <I18nProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter initialEntries={['/playlists/1']}>
            <Routes>
              <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>,
    )
    await screen.findByText('Creep')
    if (recommendationId) {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
      await waitFor(() =>
        expect(updateRecommendation).toHaveBeenCalledWith(12, {
          status: 'approved',
          auditionTrackId: 7,
        }),
      )
    } else {
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
      expect(updateRecommendation).not.toHaveBeenCalled()
    }
  },
)
