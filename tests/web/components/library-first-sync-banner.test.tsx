// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryFirstSyncBanner } from '@/web/components/library-first-sync-banner'
import { getLibrarySources } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { createTestQueryClient } from '../helpers/query'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)
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
  const client = createTestQueryClient()
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

  it.each([
    ['no sources are configured', [], false],
    ['a source is idle', [source('success', 10)], false],
    ['a resync is reusing the cache', [source('running', 5)], false],
    ['a first sync is running', [source('running', 0)], true],
  ])('visibility when %s', async (_label, sources, visible) => {
    vi.mocked(getLibrarySources).mockResolvedValue({ sources })
    renderBanner()
    await tick(0)
    expect(screen.queryByText('Building your library catalog') !== null).toBe(visible)
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
