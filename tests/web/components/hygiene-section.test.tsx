// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HygieneSection } from '@/web/components/admin/hygiene-section'
import { getAiAuditResults } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/web/lib/api', () => ({
  getAiAuditResults: vi.fn(),
  runHygieneTool: vi.fn(),
}))

afterEach(() => {
  vi.useRealTimers()
})

describe('HygieneSection audit polling', () => {
  it('keeps polling while fixes are in progress, then stops', async () => {
    vi.useFakeTimers()
    const status = (inProgress: boolean) => ({ flaggedIds: [1], fixedIds: [], inProgress })
    vi.mocked(getAiAuditResults)
      .mockResolvedValueOnce(status(true))
      .mockResolvedValueOnce(status(true))
      .mockResolvedValue(status(false))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <I18nProvider>
        <QueryClientProvider client={client}>
          <HygieneSection />
        </QueryClientProvider>
      </I18nProvider>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getAiAuditResults).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/in progress|fixed/i)).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(getAiAuditResults).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(getAiAuditResults).toHaveBeenCalledTimes(3)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(getAiAuditResults).toHaveBeenCalledTimes(3)
  })
})
