// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryFirstSyncBanner } from '@/web/components/library-first-sync-banner'
import { getLibrarySources } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))
vi.mock('@/web/lib/api', () => ({ getLibrarySources: vi.fn() }))

type Sources = Awaited<ReturnType<typeof getLibrarySources>>

const source = (status: string, cacheHits: number) =>
  ({
    id: 1,
    source: 'plex',
    lastSyncStatus: status,
    lastSyncCounts: { cacheHits },
  }) as unknown as Sources['sources'][number]

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <LibraryFirstSyncBanner />
      </QueryClientProvider>
    </I18nProvider>,
  )
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('LibraryFirstSyncBanner polling', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.useFakeTimers()
    vi.mocked(getLibrarySources).mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops polling once the first sync has completed', async () => {
    vi.mocked(getLibrarySources)
      .mockResolvedValueOnce({ sources: [source('running', 0)] })
      .mockResolvedValue({ sources: [source('success', 10)] })
    renderBanner()
    await tick(0)
    await tick(5000)
    expect(getLibrarySources).toHaveBeenCalledTimes(2)
    await tick(20_000)
    expect(getLibrarySources).toHaveBeenCalledTimes(2)
  })

  it('stops polling after dismissal', async () => {
    vi.mocked(getLibrarySources).mockResolvedValue({ sources: [source('running', 0)] })
    renderBanner()
    await tick(0)
    fireEvent.click(screen.getByRole('button'))
    const calls = vi.mocked(getLibrarySources).mock.calls.length
    await tick(20_000)
    expect(getLibrarySources).toHaveBeenCalledTimes(calls)
  })
})
