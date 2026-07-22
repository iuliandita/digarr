import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect, useRef } from 'react'
import { useI18n } from '../lib/i18n'
import { Button } from './ui/button'

type Props = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
  fallbackFocusRef?: RefObject<HTMLElement | null>
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = true,
  onConfirm,
  onCancel,
  fallbackFocusRef,
}: Props) {
  const { t } = useI18n()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCancelRef = useRef(onCancel)
  const resolvedConfirm = confirmLabel ?? t('common.confirm')
  const resolvedCancel = cancelLabel ?? t('common.cancel')
  onCancelRef.current = onCancel

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    ;(destructive ? cancelRef : confirmRef).current?.focus()

    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onCancelRef.current()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      previousFocus?.focus()
      if (document.activeElement !== previousFocus) fallbackFocusRef?.current?.focus()
    }
  }, [destructive, fallbackFocusRef])

  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const focusable =
      dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (!focusable?.length) return
    const first = focusable.item(0)
    const last = focusable.item(focusable.length - 1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 bg-bg/70 backdrop-blur-sm z-50"
        aria-hidden="true"
      />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        onKeyDown={trapTab}
        onClick={(event) => {
          if (event.target === event.currentTarget) onCancel()
        }}
      >
        <div className="bg-surface border border-border rounded-lg shadow-lg w-full max-w-sm p-4">
          <h3 className="text-sm font-medium text-text">{title}</h3>
          <p className="text-sm text-muted mt-2">{message}</p>

          <div className="mt-4 flex flex-col flex-wrap justify-end gap-2 sm:flex-row">
            <Button
              ref={cancelRef}
              variant="outline"
              onClick={onCancel}
              className="w-full sm:w-auto"
            >
              {resolvedCancel}
            </Button>
            <Button
              ref={confirmRef}
              variant={destructive ? 'destructive' : 'default'}
              onClick={onConfirm}
              className="w-full sm:w-auto"
            >
              {resolvedConfirm}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
