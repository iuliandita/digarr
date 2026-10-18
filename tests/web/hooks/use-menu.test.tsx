// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useMenu } from '@/web/hooks/use-menu'

function Harness({ closeKey }: { closeKey?: string }) {
  const menu = useMenu(closeKey)
  return (
    <div ref={menu.containerRef}>
      <button type="button" {...menu.triggerProps}>
        Tools
      </button>
      {menu.open && (
        <div {...menu.menuProps} role="menu">
          {['One', 'Two', 'Three'].map((label) => (
            <button key={label} type="button" role="menuitem" tabIndex={-1}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const trigger = () => screen.getByRole('button', { name: 'Tools' })
const item = (name: string) => screen.getByRole('menuitem', { name })

describe('useMenu', () => {
  it('opens from the keyboard on the first item and wraps with the arrow keys', async () => {
    render(<Harness />)
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    await waitFor(() => expect(item('One')).toHaveFocus())
    fireEvent.keyDown(item('One'), { key: 'ArrowUp' })
    await waitFor(() => expect(item('Three')).toHaveFocus())
    fireEvent.keyDown(item('Three'), { key: 'ArrowDown' })
    await waitFor(() => expect(item('One')).toHaveFocus())
  })

  it('moves into an already open menu with ArrowDown', async () => {
    render(<Harness />)
    fireEvent.click(trigger())
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    await waitFor(() => expect(item('One')).toHaveFocus())
  })

  it.each(['Escape', 'Tab'])('closes on %s and returns focus to the trigger', async (key) => {
    render(<Harness />)
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    await waitFor(() => expect(item('One')).toHaveFocus())
    fireEvent.keyDown(item('One'), { key })
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('closes when the close key changes and keeps focus on the trigger', async () => {
    const { rerender } = render(<Harness closeKey="/a" />)
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    await waitFor(() => expect(item('One')).toHaveFocus())
    rerender(<Harness closeKey="/b" />)
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(trigger()).toHaveFocus())
  })
})
