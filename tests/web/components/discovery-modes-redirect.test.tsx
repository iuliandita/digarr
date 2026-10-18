// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { DiscoveryModesRedirect } from '@/web/components/discovery-modes-redirect'
import { DISCOVER_TABS, PRIMARY_NAV } from '@/web/lib/nav'

function Destination() {
  const { pathname, search, hash } = useLocation()
  return <p>{pathname + search + hash}</p>
}

describe('discovery mode navigation', () => {
  it.each(['/subscriptions?genre=jazz#form', '/discover/modes?mode=gap-fill#details'])(
    'redirects %s without losing its deep link',
    async (entry) => {
      render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/subscriptions" element={<DiscoveryModesRedirect />} />
            <Route path="/discover/modes" element={<DiscoveryModesRedirect />} />
            <Route path="/discovery-modes" element={<Destination />} />
          </Routes>
        </MemoryRouter>,
      )
      const suffix = entry.slice(entry.indexOf('?'))
      expect(await screen.findByText(`/discovery-modes${suffix}`)).toBeInTheDocument()
    },
  )

  it('has one modes destination and keeps Discover active on the unified page', () => {
    const location = { pathname: '/discovery-modes', search: '?mode=gap-fill' }
    expect(PRIMARY_NAV.some((item) => item.to === '/subscriptions')).toBe(false)
    expect(PRIMARY_NAV.find((item) => item.to === '/discover')?.isActive(location)).toBe(true)
    expect(DISCOVER_TABS.filter((item) => item.to === '/discovery-modes')).toHaveLength(1)
    expect(DISCOVER_TABS.find((item) => item.to === '/discovery-modes')?.isActive(location)).toBe(
      true,
    )
  })
})
