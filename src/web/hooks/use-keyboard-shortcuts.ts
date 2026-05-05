import { useCallback, useEffect } from 'react'

type ShortcutMap = Record<string, () => void>

// Hook

/**
 * Registers global keydown shortcuts.
 *
 * Shortcuts are ignored when focus is inside an interactive text element
 * (input, textarea, select, or contenteditable). Each shortcut key must be
 * the exact `e.key` value (e.g. "j", "k", "?", "ArrowLeft").
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap, enabled = true) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return

      // Skip when focus is in a text-entry context
      const target = e.target as HTMLElement
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
        return
      }

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
