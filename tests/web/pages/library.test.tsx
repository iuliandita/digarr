// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'
import { isSettingsActive, TOOLS_NAV } from '@/web/lib/nav'
import { LibraryPage } from '@/web/pages/library'

vi.mock('@/web/pages/library-health', () => ({
  LibraryHealthPage: () => <div>health content</div>,
}))
vi.mock('@/web/pages/library-reconciliation', () => ({
  LibraryReconciliationPage: () => <div>reconciliation content</div>,
}))

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  )
}

function renderLibrary(url: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[url]}>
        <LibraryPage />
        <LocationProbe />
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('Library navigation', () => {
  it.each(['health', 'reconciliation'] as const)(
    'redirects the old %s route to its tab',
    async (tab) => {
      renderLibrary(`/library/${tab}`)
      expect(await screen.findByText(`${tab} content`)).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent(`/library?tab=${tab}`)
      expect(
        screen.getByRole('link', { name: tab === 'health' ? 'Health' : 'Reconciliation' }),
      ).toHaveAttribute('aria-current', 'page')
    },
  )

  it('defaults to Health and switches content with the URL', () => {
    renderLibrary('/library')
    expect(screen.getByText('health content')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Reconciliation' }))
    expect(screen.getByText('reconciliation content')).toBeInTheDocument()
    expect(screen.queryByText('health content')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/library?tab=reconciliation')
  })

  it('keeps three Tools entries and one Job History shortcut', () => {
    expect(TOOLS_NAV).toHaveLength(3)
    expect(TOOLS_NAV.map(({ to }) => to)).toEqual([
      '/library?tab=health',
      '/analytics',
      '/settings?tab=system#jobs',
    ])
    const system = { pathname: '/settings', search: '?tab=system' }
    expect(TOOLS_NAV[2]?.isActive(system)).toBe(true)
    expect(isSettingsActive(system)).toBe(false)
    expect(TOOLS_NAV[0]?.isActive({ pathname: '/library', search: '?tab=reconciliation' })).toBe(
      true,
    )
  })
})
