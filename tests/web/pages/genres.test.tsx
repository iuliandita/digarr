// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { toast } from 'sonner'
import { getCurrentUser, getGenres, seedGenres } from '@/web/lib/api'
import { GenresPage } from '@/web/pages/genres'

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
    const storage = new Map<string, string>([['digarr-locale', 'fr']])
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
      },
    })
    mockGetGenres.mockResolvedValue([])
    mockGetCurrentUser.mockResolvedValue(adminUser)
  })

  it('uses translated seed toast messages in French', async () => {
    mockSeedGenres.mockResolvedValue({} as never)

    renderWithQuery(<GenresPage />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Initialiser les genres depuis votre bibliothèque',
      }),
    )

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('Initialisation des genres lancée')
    })
  })

  it('uses translated seed error toast messages in French', async () => {
    mockSeedGenres.mockRejectedValue(new Error('nope'))

    renderWithQuery(<GenresPage />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Initialiser les genres depuis votre bibliothèque',
      }),
    )

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Échec de l'initialisation des genres")
    })
  })

  it('shows the seed button to an admin', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser)

    renderWithQuery(<GenresPage />)

    expect(
      await screen.findByRole('button', {
        name: 'Initialiser les genres depuis votre bibliothèque',
      }),
    ).toBeTruthy()
  })

  it('hides the seed button from a non-admin', async () => {
    mockGetCurrentUser.mockResolvedValue(regularUser)

    renderWithQuery(<GenresPage />)

    // Wait for the empty-state message to confirm the page rendered, then assert
    // neither the empty-state seed button nor the mobile FAB is present.
    await screen.findByText('Aucun genre dans votre bibliothèque pour le moment.')
    expect(
      screen.queryByRole('button', {
        name: 'Initialiser les genres depuis votre bibliothèque',
      }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Initialiser les genres' })).toBeNull()
  })
})
