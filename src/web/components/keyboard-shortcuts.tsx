import { useEffect } from 'react'

type KeyboardShortcutsProps = {
  open: boolean
  onClose: () => void
}

// Shortcut data

const SHORTCUTS: { key: string; label: string }[] = [
  { key: 'j', label: 'Next card' },
  { key: 'k', label: 'Previous card' },
  { key: 'a', label: 'Approve focused card' },
  { key: 'r', label: 'Reject focused card' },
  { key: 'd', label: 'Open / close detail view' },
  { key: '?', label: 'Show / hide shortcuts' },
  { key: '\u2190', label: 'Previous card (stack view)' },
  { key: '\u2192', label: 'Next card (stack view)' },
]

// Component

export function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
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
    /* Full-screen backdrop as a button so click-outside closes the dialog */
    <button
      type="button"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm w-full cursor-default"
      onClick={onClose}
      aria-label="Close shortcuts overlay"
    >
      {/* Dialog card -- stop propagation so clicking inside doesn't close */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="bg-surface border border-border rounded-xl shadow-xl p-6 w-full max-w-md mx-4 cursor-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text">Keyboard Shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
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
          {SHORTCUTS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <kbd className="shrink-0 inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 text-xs font-mono bg-bg border border-border rounded text-text">
                {key}
              </kbd>
              <span className="text-xs text-muted text-right leading-tight">{label}</span>
            </div>
          ))}
        </div>

        <p className="mt-5 text-micro text-muted text-center">
          Shortcuts are disabled when a text field is focused.
        </p>
      </div>
    </button>
  )
}
