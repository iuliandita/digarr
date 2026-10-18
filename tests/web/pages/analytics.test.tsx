// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

function renderWithQuery(ui: ReactElement) {
  const client = createTestQueryClient()
  return render(
    <I18nProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </I18nProvider>,
  )
}

vi.mock('@/web/lib/api', () => ({
  getAnalyticsBatches: vi.fn().mockResolvedValue([]),
  getAnalyticsGenres: vi.fn().mockResolvedValue([]),
  getAnalyticsOverview: vi.fn().mockResolvedValue({
    totalRecs: 0,
    approvalRate: 0,
    avgScore: 0,
    totalBatches: 0,
  }),
  getAnalyticsSources: vi.fn().mockResolvedValue([]),
  getApprovalTrend: vi.fn().mockResolvedValue([]),
  getUserPreferences: vi.fn().mockResolvedValue({ dismissedHints: [] }),
  getScoreDistribution: vi.fn().mockResolvedValue([]),
  getTimeToAct: vi.fn().mockResolvedValue([]),
}))

import { getAnalyticsBatches, getAnalyticsOverview } from '@/web/lib/api'
import { AnalyticsPage } from '@/web/pages/analytics'
import { createTestQueryClient } from '../helpers/query'
import { installMemoryLocalStorage } from '../helpers/storage'

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.mocked(getAnalyticsBatches).mockResolvedValue([])
    installMemoryLocalStorage()
  })

  it('gives each discovery chart column the full chart height', async () => {
    vi.mocked(getAnalyticsBatches).mockResolvedValueOnce([
      {
        id: 1,
        createdAt: '2026-07-13T12:00:00.000Z',
        status: 'completed',
        stats: {},
        total: 10,
        approved: 4,
        rejected: 3,
        pending: 3,
      },
    ])

    renderWithQuery(<AnalyticsPage />)

    const column = await screen.findByTitle(/10 recs \(4 approved\)/)
    expect(column).toHaveClass('h-full')
    expect(column.querySelectorAll('[style*="height"]')).toHaveLength(2)
  })

  it('keeps the diagnostic charts in a collapsed More charts section and remembers it opened', async () => {
    const first = renderWithQuery(<AnalyticsPage />)
    const toggle = await screen.findByRole('button', { name: 'More charts' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Discovery Over Time')).toBeVisible()
    expect(screen.getByText('Score Distribution')).not.toBeVisible()

    fireEvent.click(toggle)
    expect(screen.getByText('Score Distribution')).toBeVisible()
    first.unmount()

    renderWithQuery(<AnalyticsPage />)
    expect(await screen.findByRole('button', { name: 'More charts' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })
})

describe('AnalyticsPage load errors', () => {
  it('shows an error notice and no fabricated zeros when the overview fails', async () => {
    vi.mocked(getAnalyticsOverview).mockRejectedValueOnce(new Error('403'))
    renderWithQuery(<AnalyticsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Some analytics couldn't be loaded.")
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(4)
  })
})
