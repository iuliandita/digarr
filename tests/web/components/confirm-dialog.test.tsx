// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ComponentProps, createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '@/web/components/confirm-dialog'
import { I18nProvider } from '@/web/lib/i18n'
import { installMemoryLocalStorage } from '../helpers/storage'

function renderDialog(props: Partial<ComponentProps<typeof ConfirmDialog>> = {}) {
  return render(
    <I18nProvider>
      <ConfirmDialog
        title="Confirm action"
        message="Continue?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  )
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  it('focuses cancel for destructive actions, traps Tab, cancels once, and restores focus', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const onCancel = vi.fn()
    const { unmount } = renderDialog({ onCancel })
    const dialog = screen.getByRole('dialog', { name: 'Confirm action' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Confirm' })

    await waitFor(() => expect(cancel).toHaveFocus())
    expect(cancel).toHaveClass('min-h-[44px]')
    expect(confirm).toHaveClass('min-h-[44px]')
    confirm.focus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    await waitFor(() => expect(cancel).toHaveFocus())
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    await waitFor(() => expect(confirm).toHaveFocus())
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)

    unmount()
    await waitFor(() => expect(trigger).toHaveFocus())
    trigger.remove()
  })

  it('focuses confirm first for non-destructive actions', async () => {
    renderDialog({ destructive: false })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus())
  })

  it('uses the fallback when the invoking trigger is disabled and cancels only outside the panel', async () => {
    const trigger = document.createElement('button')
    const fallback = document.createElement('section')
    fallback.tabIndex = -1
    document.body.append(trigger, fallback)
    trigger.focus()
    const fallbackFocusRef = createRef<HTMLElement>()
    fallbackFocusRef.current = fallback
    const onCancel = vi.fn()
    const { unmount } = renderDialog({ fallbackFocusRef, onCancel })
    const dialog = screen.getByRole('dialog', { name: 'Confirm action' })

    trigger.disabled = true
    fireEvent.click(screen.getByText('Continue?'))
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(dialog)
    expect(onCancel).toHaveBeenCalledTimes(1)

    unmount()
    await waitFor(() => expect(fallback).toHaveFocus())
    trigger.remove()
    fallback.remove()
  })
})
