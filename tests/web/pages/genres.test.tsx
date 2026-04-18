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
import { getGenres, seedGenres } from '@/web/lib/api'
import { GenresPage } from '@/web/pages/genres'

const mockGetGenres = vi.mocked(getGenres)
const mockSeedGenres = vi.mocked(seedGenres)
const mockToastSuccess = vi.mocked(toast.success)
const mockToastError = vi.mocked(toast.error)

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
})
