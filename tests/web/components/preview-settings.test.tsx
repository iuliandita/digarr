// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewSettings } from '@/web/components/preview-settings'
import { getCurrentUser, getUserPreferences, updateUserPreferences } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { createTestQueryClient } from '../helpers/query'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/web/lib/api', () => ({
  getCurrentUser: vi.fn(),
  getUserPreferences: vi.fn(),
  updateUserPreferences: vi.fn(),
}))

function renderSettings() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <I18nProvider>
        <PreviewSettings />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const checkbox = () =>
  screen.getByRole('checkbox', { name: 'Play Apple Music clips instead of the Spotify player' })

describe('preview settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 1, username: 'u' } as never)
    vi.mocked(getUserPreferences).mockResolvedValue({})
    vi.mocked(updateUserPreferences).mockResolvedValue({})
  })

  it('is off by default and saves the opt-in', async () => {
    renderSettings()
    await waitFor(() => expect(checkbox()).toBeEnabled())
    expect(checkbox()).not.toBeChecked()

    fireEvent.click(checkbox())
    await waitFor(() =>
      expect(updateUserPreferences).toHaveBeenCalledExactlyOnceWith({ applePreviews: true }),
    )
    await waitFor(() => expect(checkbox()).toBeChecked())
  })

  it('shows a saved opt-in and reverts a failed change', async () => {
    vi.mocked(getUserPreferences).mockResolvedValue({ applePreviews: true })
    vi.mocked(updateUserPreferences).mockRejectedValue(new Error('nope'))
    renderSettings()
    await waitFor(() => expect(checkbox()).toBeChecked())

    fireEvent.click(checkbox())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nope'))
    await waitFor(() => expect(checkbox()).toBeChecked())
  })
})
