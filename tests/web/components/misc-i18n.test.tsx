// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupSection } from '@/web/components/admin/backup-section'
import { ConnectionSuggestions } from '@/web/components/connection-suggestions'
import { ErrorBoundary } from '@/web/components/error-boundary'
import { KeyboardShortcuts } from '@/web/components/keyboard-shortcuts'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    data: unknown

    constructor(status: number, data: unknown) {
      super('api')
      this.status = status
      this.data = data
    }
  },
  downloadBackup: vi.fn(),
  getLastAutoBackup: vi.fn().mockResolvedValue({
    lastAutoBackup: { createdAt: '2025-12-31T14:05:00.000Z' },
  }),
  restoreBackupApi: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

function renderWithProviders(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </I18nProvider>,
  )
}

function ThrowOnRender(): never {
  throw new Error('boom')
}

describe('shared component i18n', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
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
        clear: vi.fn(() => {
          storage.clear()
        }),
      },
    })
  })

  it('translates connection suggestions in french', () => {
    localStorage.setItem('digarr-locale', 'fr')

    renderWithProviders(<ConnectionSuggestions service="spotify" onClose={vi.fn()} />)

    expect(screen.getByText('Suggestions pour Spotify')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compris' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ignorer pour le moment' })).toBeInTheDocument()
    expect(screen.getByLabelText('Fermer les suggestions')).toBeInTheDocument()
  })

  it('translates keyboard shortcuts chrome in german', () => {
    localStorage.setItem('digarr-locale', 'de')

    renderWithProviders(<KeyboardShortcuts open onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Tastenkombinationen' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tastenkombinationen schließen')).toBeInTheDocument()
    expect(screen.getByText('Weiter zur nächsten Karte')).toBeInTheDocument()
  })

  it('translates the error boundary actions in french', () => {
    localStorage.setItem('digarr-locale', 'fr')

    renderWithProviders(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Un probleme est survenu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reessayer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Retour a l'accueil" })).toBeInTheDocument()
  })

  it('formats backup timestamps with the active locale', async () => {
    localStorage.setItem('digarr-locale', 'fr')

    renderWithProviders(<BackupSection />)

    expect(await screen.findByText(/Derniere sauvegarde auto/)).toHaveTextContent(
      `Derniere sauvegarde auto : ${new Date('2025-12-31T14:05:00.000Z').toLocaleString('fr')}`,
    )
  })
})
