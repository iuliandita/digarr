// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'it'),
  getRequestLocale: vi.fn(() => 'it'),
  getStoredLocale: vi.fn(() => 'it'),
  setStoredLocale: vi.fn(),
}))

import { MonitoringOptions } from '@/web/components/monitoring-options'

describe('MonitoringOptions', () => {
  it('renders translated button and dropdown labels', () => {
    render(
      <I18nProvider>
        <MonitoringOptions onApprove={vi.fn()} onOpenAlbumPicker={vi.fn()} />
      </I18nProvider>,
    )

    expect(screen.getByRole('button', { name: 'Approva' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Opzioni di monitoraggio' }))

    expect(screen.getByText('Tutti gli album')).toBeInTheDocument()
    expect(screen.getByText('Monitora e cerca tutti gli album')).toBeInTheDocument()
    expect(screen.getByText('Solo uscite future')).toBeInTheDocument()
    expect(screen.getByText('Monitora solo le nuove uscite da ora in poi')).toBeInTheDocument()
    expect(screen.getByText('Album selezionati')).toBeInTheDocument()
    expect(screen.getByText('Scegli quali album monitorare')).toBeInTheDocument()
    expect(screen.getByText('Nessuno')).toBeInTheDocument()
    expect(screen.getByText('Aggiungi senza monitoraggio (solo tracciamento)')).toBeInTheDocument()
  })
})
