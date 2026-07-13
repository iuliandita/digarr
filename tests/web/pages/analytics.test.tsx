// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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

import { getAnalyticsBatches } from '@/web/lib/api'
import { AnalyticsPage } from '@/web/pages/analytics'

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.mocked(getAnalyticsBatches).mockResolvedValue([])
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

  it('renders translated analytics intro copy in French', async () => {
    localStorage.setItem('digarr-locale', 'fr')
    renderWithQuery(<AnalyticsPage />)

    expect(
      await screen.findByText(
        'Suivez les performances de votre pipeline de découverte au fil du temps. Des taux d’approbation plus élevés signifient que Digarr apprend bien vos goûts.',
      ),
    ).toBeInTheDocument()
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
})
