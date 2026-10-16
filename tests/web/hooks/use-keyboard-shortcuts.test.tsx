// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from '@/web/hooks/use-keyboard-shortcuts'

function Harness({ onKey, children }: { onKey: () => void; children?: React.ReactNode }) {
  useKeyboardShortcuts({ a: onKey, Enter: onKey })
  return <>{children}</>
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useKeyboardShortcuts', () => {
  it('fires on the page', () => {
    const onKey = vi.fn()
    render(<Harness onKey={onKey} />)
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(onKey).toHaveBeenCalledOnce()
  })

  it.each([
    ['a menu is open', <div key="m" role="menu" />, 'a'],
    ['a dialog is open', <div key="d" role="dialog" />, 'a'],
  ])('is suspended while %s', (_label, overlay, key) => {
    const onKey = vi.fn()
    render(<Harness onKey={onKey}>{overlay}</Harness>)
    fireEvent.keyDown(document.body, { key })
    expect(onKey).not.toHaveBeenCalled()
  })

  it('leaves Enter on a focused button to the button', () => {
    const onKey = vi.fn()
    const { getByRole } = render(
      <Harness onKey={onKey}>
        <button type="button">Approve</button>
      </Harness>,
    )
    fireEvent.keyDown(getByRole('button'), { key: 'Enter' })
    expect(onKey).not.toHaveBeenCalled()
  })

  it.each(['ctrlKey', 'metaKey', 'altKey'])('leaves %s combinations to the browser', (modifier) => {
    const onKey = vi.fn()
    render(<Harness onKey={onKey} />)
    fireEvent.keyDown(document.body, { key: 'a', [modifier]: true })
    expect(onKey).not.toHaveBeenCalled()
  })

  it('ignores events another handler already consumed', () => {
    const onKey = vi.fn()
    render(<Harness onKey={onKey} />)
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)
    expect(onKey).not.toHaveBeenCalled()
  })
})
