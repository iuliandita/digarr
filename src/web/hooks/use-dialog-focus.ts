import { type RefObject, useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'

/**
 * Modal focus contract: focus moves inside on open, Tab cycles within, Escape closes,
 * and focus returns to the opener on close.
 */
export function useDialogFocus(
  open: boolean,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // biome-ignore lint/correctness/useExhaustiveDependencies: the initial focus target is read once per open
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    ]
    const frame = requestAnimationFrame(() => {
      ;(initialFocusRef?.current ?? focusables()[0] ?? dialogRef.current)?.focus()
    })

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables()
      const first = list[0]
      const last = list[list.length - 1]
      if (!first || !last) return
      const inside = dialogRef.current?.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

  return dialogRef
}
