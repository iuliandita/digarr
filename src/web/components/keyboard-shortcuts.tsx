import { useEffect } from 'react'
import type { MessageKey } from '@/core/i18n/messages/types'
import { useDialogFocus } from '@/web/hooks/use-dialog-focus'
import { useI18n } from '@/web/lib/i18n'

type KeyboardShortcutsProps = {
  open: boolean
  onClose: () => void
}

const SHORTCUTS: { key: string; labelKey: MessageKey }[] = [
  { key: 'j', labelKey: 'keyboardShortcuts.nextCard' },
  { key: 'k', labelKey: 'keyboardShortcuts.previousCard' },
  { key: 'a', labelKey: 'keyboardShortcuts.approveFocusedCard' },
  { key: 'r', labelKey: 'keyboardShortcuts.rejectFocusedCard' },
  { key: 'd', labelKey: 'keyboardShortcuts.toggleDetailView' },
  { key: '?', labelKey: 'keyboardShortcuts.toggleShortcuts' },
  { key: '\u2190', labelKey: 'keyboardShortcuts.rejectCardStack' },
  { key: '\u2192', labelKey: 'keyboardShortcuts.approveCardStack' },
]

export function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
  const { t } = useI18n()
  const dialogRef = useDialogFocus(open, onClose)

  // `?` toggles the dialog; page shortcuts are suspended while it is open
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === '?') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-bg/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('keyboardShortcuts.title')}
        className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 shadow-xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text">{t('keyboardShortcuts.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('keyboardShortcuts.close')}
            className="p-1 text-muted hover:text-text transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
          {SHORTCUTS.map(({ key, labelKey }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <kbd className="shrink-0 inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 text-xs font-mono bg-bg border border-border rounded text-text">
                {key}
              </kbd>
              <span className="text-xs text-muted text-right leading-tight">{t(labelKey)}</span>
            </div>
          ))}
        </div>

        <p className="mt-5 text-micro text-muted text-center">
          {t('keyboardShortcuts.disabledWhileTyping')}
        </p>
      </div>
    </>
  )
}
