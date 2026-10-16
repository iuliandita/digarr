// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HealthCheckCard } from '@/web/components/health-check-card'
import type { HealthCheckResult } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'de'),
  getStoredLocale: vi.fn(() => 'de'),
  setStoredLocale: vi.fn(),
}))

const check = (id: string, name: string): HealthCheckResult => ({
  id,
  name,
  description: 'English server description',
  severity: 'warning',
  fixable: false,
  count: 0,
  items: [],
})

describe('HealthCheckCard', () => {
  it('translates known checks by id', () => {
    render(
      <I18nProvider>
        <HealthCheckCard
          check={check('missing-metadata', 'Missing Metadata')}
          onFix={vi.fn()}
          fixing={false}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('Fehlende Metadaten')).toBeInTheDocument()
    expect(screen.queryByText('English server description')).toBeNull()
  })

  it('falls back to the server text for an unknown check', () => {
    render(
      <I18nProvider>
        <HealthCheckCard
          check={check('future-check', 'Future Check')}
          onFix={vi.fn()}
          fixing={false}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('Future Check')).toBeInTheDocument()
  })
})
