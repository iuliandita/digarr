// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getLibraryHealth } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { LibraryHealthPage } from '@/web/pages/library-health'
import { createTestQueryClient } from '../helpers/query'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/web/components/library-first-sync-banner', () => ({
  LibraryFirstSyncBanner: () => null,
}))
vi.mock('@/web/components/library-sources-panel', () => ({ LibrarySourcesPanel: () => null }))
vi.mock('@/web/components/hint', () => ({ Hint: () => null }))
vi.mock('@/web/lib/api', () => ({
  fixHealthCheck: vi.fn(),
  getLibraryHealth: vi.fn(),
  getLibraryStats: vi.fn(async () => {
    throw new Error('no stats')
  }),
  getSettings: vi.fn(async () => ({})),
  scanLibraryHealth: vi.fn(),
}))

function renderPage() {
  const client = createTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <LibraryHealthPage />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const health = (lastError: string | null) => ({
  checks: [],
  scanning: false,
  lastStartedAt: null,
  lastCompletedAt: '2026-01-01T00:00:00Z',
  lastError,
  syncIntervalHours: 6,
})

describe('LibraryHealthPage last error', () => {
  it.each([
    ['Lidarr unreachable: connect ECONNREFUSED', true],
    [null, false],
  ])('stored lastError %s shows the warning: %s', async (lastError, shown) => {
    vi.mocked(getLibraryHealth).mockResolvedValue(health(lastError))
    renderPage()
    await screen.findByText('Last synced', { exact: false })
    expect(screen.queryByText(/The last sync ran into a problem/) !== null).toBe(shown)
    if (lastError) expect(screen.getByText(lastError)).toBeInTheDocument()
  })
})
