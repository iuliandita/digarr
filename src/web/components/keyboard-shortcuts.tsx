import { type KeyboardEvent as ReactKeyboardEvent, useEffect } from 'react'
import type { MessageKey } from '@/core/i18n/messages/types'
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
  { key: '\u2190', labelKey: 'keyboardShortcuts.previousCardStack' },
  { key: '\u2192', labelKey: 'keyboardShortcuts.nextCardStack' },
]

export function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
  const { t } = useI18n()

  function onBackdropKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClose()
    }
  }

  // Close on Escape (handled in hook, but belt-and-suspenders here)
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    /* Full-screen backdrop so click-outside closes the dialog */
    /* biome-ignore lint/a11y/useSemanticElements: backdrop cannot be a real button because the dialog contains buttons */
    <div
      role="button"
      tabIndex={0}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm w-full cursor-default"
      onClick={onClose}
      onKeyDown={onBackdropKeyDown}
    >
      {/* Dialog card -- stop propagation so clicking inside doesn't close */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('keyboardShortcuts.title')}
        className="bg-surface border border-border rounded-xl shadow-xl p-6 w-full max-w-md mx-4 cursor-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
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
    </div>
  )
}
