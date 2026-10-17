// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaylistSchedulingToggle } from '@/web/components/playlist-scheduling-toggle'
import { getAuthStatus, updateSettings } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/web/lib/api', () => ({ getAuthStatus: vi.fn(), updateSettings: vi.fn() }))

function renderToggle(enabled: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <PlaylistSchedulingToggle enabled={enabled} />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('PlaylistSchedulingToggle (#921)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lets an admin turn scheduling on and explains the paused state', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ isAdmin: true } as never)
    vi.mocked(updateSettings).mockResolvedValue({})
    renderToggle(false)

    const toggle = await screen.findByRole('switch', { name: 'Scheduled generation' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/Paused: playlists with a schedule/)).toBeInTheDocument()
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ preferences: { playlistEnabled: true } }),
    )
  })

  it('is hidden from members', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ isAdmin: false } as never)
    renderToggle(false)
    await waitFor(() => expect(getAuthStatus).toHaveBeenCalled())
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
