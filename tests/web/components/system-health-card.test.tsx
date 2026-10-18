// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SystemHealthCard } from '@/web/components/system-health-card'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

vi.mock('@/web/lib/api', () => ({
  getJobHealth: vi.fn(async () => ({
    pipeline: { status: 'ok', lastRun: null, nextRun: null },
    subscriptions: { status: 'degraded', healthy: 1, total: 2 },
    playlists: { status: 'error', lastRun: null },
    sources: {},
  })),
}))

describe('SystemHealthCard', () => {
  it('exposes each status as text and a distinct icon, not color alone', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider>
          <MemoryRouter>
            <SystemHealthCard />
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    )
    const row = async (label: string) =>
      (await screen.findAllByText(label))
        .map((el) => el.closest('span'))
        .find(Boolean) as HTMLElement

    const pipeline = await row('Pipeline')
    expect(within(pipeline).getByText('OK')).toBeInTheDocument()
    expect(pipeline.querySelector('svg')?.getAttribute('data-status')).toBe('ok')

    const subs = await row('Subscriptions')
    expect(within(subs).getByText('Degraded')).toBeInTheDocument()
    expect(subs.querySelector('svg')?.getAttribute('data-status')).toBe('degraded')

    const playlists = await row('Playlists')
    expect(within(playlists).getByText('Error')).toBeInTheDocument()
    expect(playlists.querySelector('svg')?.getAttribute('data-status')).toBe('error')
  })
})
