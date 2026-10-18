// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

function renderWithQuery(ui: ReactElement) {
  const client = createTestQueryClient()

  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
}

vi.mock('@/web/lib/api', () => ({
  getCurrentUser: vi.fn(),
  getGenres: vi.fn(),
  getUserPreferences: vi.fn().mockResolvedValue({ dismissedHints: [] }),
  searchGenres: vi.fn(),
  seedGenres: vi.fn(),
}))

vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())

import { toast } from 'sonner'
import { getCurrentUser, getGenres, seedGenres } from '@/web/lib/api'
import { GenresPage } from '@/web/pages/genres'
import { createTestQueryClient } from '../helpers/query'
import { installMemoryLocalStorage } from '../helpers/storage'

const mockGetCurrentUser = vi.mocked(getCurrentUser)
const mockGetGenres = vi.mocked(getGenres)
const mockSeedGenres = vi.mocked(seedGenres)
const mockToastSuccess = vi.mocked(toast.success)
const mockToastError = vi.mocked(toast.error)

const adminUser = { id: 1, username: 'admin', isAdmin: true } as never
const regularUser = { id: 2, username: 'user', isAdmin: false } as never

describe('GenresPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installMemoryLocalStorage({ 'digarr-locale': 'en' })
    mockGetGenres.mockResolvedValue([])
    mockGetCurrentUser.mockResolvedValue(adminUser)
  })

  it.each([
    [
      'success',
      () => mockSeedGenres.mockResolvedValue({} as never),
      mockToastSuccess,
      'Genre seed started',
    ],
    [
      'failure',
      () => mockSeedGenres.mockRejectedValue(new Error('nope')),
      mockToastError,
      'Failed to seed genres',
    ],
  ])('toasts the seed %s outcome', async (_name, arrange, toastFn, message) => {
    arrange()

    renderWithQuery(<GenresPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Seed genres from your library' }))

    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(message))
  })

  it('shows the seed button to an admin', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)

    renderWithQuery(<GenresPage />)

    expect(
      await screen.findByRole('button', {
        name: 'Seed genres from your library',
      }),
    ).toBeTruthy()
  })

  it('hides the seed button from a non-admin', async () => {
    mockGetCurrentUser.mockResolvedValue(regularUser)

    renderWithQuery(<GenresPage />)

    // Wait for the empty-state message to confirm the page rendered, then assert
    // neither the empty-state seed button nor the mobile FAB is present.
    await screen.findByText('No genres in your library yet.')
    expect(
      screen.queryByRole('button', {
        name: 'Seed genres from your library',
      }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Seed genres' })).toBeNull()
  })
})
