// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PlaylistCard } from '@/web/components/playlist-card'
import type { PlaylistRow } from '@/web/lib/api'
import { deletePlaylistApi } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/web/lib/api', () => ({
  deletePlaylistApi: vi.fn().mockResolvedValue(undefined),
  generatePlaylistApi: vi.fn(),
  updatePlaylistApi: vi.fn(),
}))

const playlist = {
  id: 7,
  userId: 1,
  name: 'Mix',
  strategy: 'mood',
  targetIds: [],
  schedule: null,
  config: null,
  lastGeneratedAt: null,
  trackCount: 0,
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
} as PlaylistRow

function renderCard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <I18nProvider>
        <Routes>
          <Route
            path="/"
            element={<PlaylistCard playlist={playlist} onEdit={vi.fn()} onRefetch={vi.fn()} />}
          />
          <Route path="/playlists/:id" element={<div>detail page</div>} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>,
  )
}

describe('PlaylistCard delete dialog', () => {
  it('does not navigate when cancelling or confirming', async () => {
    renderCard()
    fireEvent.click(screen.getByLabelText('Delete'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('detail page')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Delete'))
    const confirm = screen
      .getAllByRole('button', { name: 'Delete' })
      .find((b) => !b.hasAttribute('aria-label'))
    expect(confirm).toBeDefined()
    if (confirm) fireEvent.click(confirm)
    await waitFor(() => expect(deletePlaylistApi).toHaveBeenCalledWith(7))
    expect(screen.queryByText('detail page')).not.toBeInTheDocument()
  })
})
