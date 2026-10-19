// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiscoveryModeForm } from '@/web/components/discovery-mode-form'
import type { DiscoveryModeResponse } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

const limit = { key: 'maxArtistsPerRun', label: 'Artists checked per run', type: 'number' as const }
const other = { key: 'seed', label: 'Seed artist', type: 'text' as const }

function modeWith(
  easyFields: DiscoveryModeResponse['easyFields'],
  advancedFields: DiscoveryModeResponse['advancedFields'],
): DiscoveryModeResponse {
  return {
    id: 'm',
    label: 'M',
    description: 'd',
    availability: { enabled: true, fallbackUsed: false, providerPath: [] },
    easyFields,
    advancedFields,
  }
}

function renderForm(mode: DiscoveryModeResponse) {
  return render(
    <I18nProvider>
      <DiscoveryModeForm mode={mode} onRun={async () => {}} />
    </I18nProvider>,
  )
}

describe('DiscoveryModeForm settings toggle', () => {
  it('keeps the toggle for advanced-only modes and reveals the field', () => {
    renderForm(modeWith([], [limit]))
    expect(screen.queryByText('Artists checked per run')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByText('Artists checked per run')).toBeInTheDocument()
  })

  it.each([
    ['identical lists', [limit], [limit]],
    ['no advanced fields', [other], []],
  ])('hides the toggle for %s', (_name, easy, advanced) => {
    renderForm(modeWith(easy, advanced))
    expect(screen.queryByRole('button', { name: 'Advanced' })).toBeNull()
  })
})
