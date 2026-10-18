// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HygieneSection } from '@/web/components/admin/hygiene-section'
import { getAiAuditResults, runHygieneTool } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { createTestQueryClient } from '../helpers/query'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)
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
    const client = createTestQueryClient()
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

describe('HygieneSection results', () => {
  it('renders translated labels instead of raw keys and skips structured fields', async () => {
    vi.mocked(getAiAuditResults).mockResolvedValue({
      flaggedIds: [],
      fixedIds: [],
      inProgress: false,
    })
    vi.mocked(runHygieneTool).mockResolvedValue({
      tool: 'rescore',
      rescored: 4,
      skipped: 1,
      weightProfile: { a: 1 },
    })
    const client = createTestQueryClient()
    render(
      <I18nProvider>
        <QueryClientProvider client={client}>
          <HygieneSection />
        </QueryClientProvider>
      </I18nProvider>,
    )
    fireEvent.click((await screen.findAllByRole('button', { name: 'Run' }))[2] as HTMLElement)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Run' })).at(-1) as HTMLElement)
    expect(await screen.findByText('Rescored: 4, Skipped: 1')).toBeInTheDocument()
  })
})
