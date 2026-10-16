// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useDialogFocus } from '@/web/hooks/use-dialog-focus'

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useDialogFocus(true, onClose)
  return (
    <div ref={ref} role="dialog" aria-label="Test dialog">
      <button type="button">First</button>
      <input aria-label="Middle" />
      <button type="button">Last</button>
    </div>
  )
}

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && <Dialog onClose={() => setOpen(false)} />}
    </>
  )
}

describe('useDialogFocus', () => {
  it('moves focus in, wraps Tab both ways, and restores focus on Escape', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)

    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    await waitFor(() => expect(first).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })
})
