import { useCallback, useEffect } from 'react'

type ShortcutMap = Record<string, () => void>

const CONTROL_SELECTOR =
  'button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"]'
const OVERLAY_SELECTOR = '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]'

/** True when a page shortcut must not act on this event (see useKeyboardShortcuts). */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return true
  const target = e.target as HTMLElement
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
    return true
  }
  if ((e.key === 'Enter' || e.key === ' ') && target.closest(CONTROL_SELECTOR)) return true
  return !!document.querySelector(OVERLAY_SELECTOR)
}

// Hook

/**
 * Registers global keydown shortcuts.
 *
 * Shortcuts are ignored when focus is inside an interactive text element
 * (input, textarea, select, or contenteditable), while a menu or dialog is
 * open, when another handler already consumed the event, and for Enter/Space
 * on a focused control. Each shortcut key must be the exact `e.key` value
 * (e.g. "j", "k", "?", "ArrowLeft").
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap, enabled = true) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || shouldIgnoreShortcut(e)) return

      const action = shortcuts[e.key]
      if (action) {
        e.preventDefault()
        action()
      }
    },
    [enabled, shortcuts],
  )

  useEffect(() => {
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handler])
}
