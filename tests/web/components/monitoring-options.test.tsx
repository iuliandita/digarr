// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock('it'),
)

import { MonitoringOptions } from '@/web/components/monitoring-options'

describe('MonitoringOptions', () => {
  it('keeps all options enabled when popularAvailable defaults to true', () => {
    render(
      <I18nProvider>
        <MonitoringOptions onApprove={vi.fn()} onOpenAlbumPicker={vi.fn()} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni di monitoraggio' }))
    const disabled = screen.getAllByRole('button').filter((b) => (b as HTMLButtonElement).disabled)
    expect(disabled).toHaveLength(0)
  })

  it('disables the Popular option and ignores clicks when popularAvailable is false', () => {
    const onApprove = vi.fn()
    render(
      <I18nProvider>
        <MonitoringOptions
          onApprove={onApprove}
          onOpenAlbumPicker={vi.fn()}
          popularAvailable={false}
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni di monitoraggio' }))
    const disabled = screen
      .getAllByRole('menuitem')
      .filter((b) => (b as HTMLButtonElement).disabled)
    expect(disabled).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    fireEvent.click(disabled[0]!)
    expect(onApprove).not.toHaveBeenCalled()
  })

  function openMenu() {
    const toggle = screen.getByRole('button', { name: 'Opzioni di monitoraggio' })
    fireEvent.click(toggle)
    return toggle
  }

  it('exposes the dropdown as an ARIA menu with menuitem children', () => {
    render(
      <I18nProvider>
        <MonitoringOptions onApprove={vi.fn()} onOpenAlbumPicker={vi.fn()} />
      </I18nProvider>,
    )
    const toggle = openMenu()
    expect(toggle).toHaveAttribute('aria-haspopup', 'menu')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu')
    expect(menu).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(9)
  })

  it('focuses the first menuitem when opened', async () => {
    render(
      <I18nProvider>
        <MonitoringOptions onApprove={vi.fn()} onOpenAlbumPicker={vi.fn()} />
      </I18nProvider>,
    )
    openMenu()
    const items = screen.getAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
  })

  it('moves focus with ArrowDown/ArrowUp and wraps around', async () => {
    render(
      <I18nProvider>
        <MonitoringOptions onApprove={vi.fn()} onOpenAlbumPicker={vi.fn()} />
      </I18nProvider>,
    )
    openMenu()
    const menu = screen.getByRole('menu')
    const items = screen.getAllByRole('menuitem')
    await waitFor(() => expect(items[0]).toHaveFocus())

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(items[1]))

    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    await waitFor(() => expect(document.activeElement).toBe(items[0]))

    // ArrowUp from the first item wraps to the last.
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    await waitFor(() => expect(document.activeElement).toBe(items[items.length - 1]))
  })

  it('skips disabled items during arrow navigation', async () => {
    render(
      <I18nProvider>
        <MonitoringOptions
          onApprove={vi.fn()}
          onOpenAlbumPicker={vi.fn()}
          popularAvailable={false}
        />
      </I18nProvider>,
    )
    openMenu()
    const menu = screen.getByRole('menu')
    const items = screen.getAllByRole('menuitem')
    const popularIndex = items.findIndex((b) => (b as HTMLButtonElement).disabled)
    await waitFor(() => expect(items[0]).toHaveFocus())

    // Walk down to the item just before the disabled one, then once more: focus
    // must land past it, never on the disabled item.
    for (let i = 0; i < popularIndex; i += 1) fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).not.toBe(items[popularIndex])
  })

  it('closes on Escape and returns focus to the toggle', async () => {
    render(
      <I18nProvider>
        <MonitoringOptions onApprove={vi.fn()} onOpenAlbumPicker={vi.fn()} />
      </I18nProvider>,
    )
    const toggle = openMenu()
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(toggle))
  })
})
