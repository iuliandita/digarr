import { X } from 'lucide-react'
import { useHints } from '../hooks/use-hints'

type HintProps = {
  id: string
  type?: 'inline' | 'spotlight' | 'empty-state' | 'post-action'
  children: React.ReactNode
  className?: string
}

export function Hint({ id, type = 'inline', children, className = '' }: HintProps) {
  const { isHintDismissed, dismissHint } = useHints()

  if (isHintDismissed(id)) return null

  if (type === 'inline') {
    return (
      <div
        className={`flex items-start gap-2 px-3 py-2 bg-surface border border-border rounded-md text-sm text-muted ${className}`}
      >
        <span className="flex-1">{children}</span>
        <button
          type="button"
          onClick={() => dismissHint(id)}
          aria-label="Dismiss hint"
          className="shrink-0 text-muted hover:text-text transition-colors"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    )
  }

  if (type === 'spotlight') {
    return (
      <div
        className={`flex items-start gap-2 px-3 py-2 border-l-2 border-accent bg-surface text-sm ${className}`}
      >
        <span className="flex-1 text-muted">{children}</span>
        <button
          type="button"
          onClick={() => dismissHint(id)}
          aria-label="Dismiss hint"
          className="shrink-0 text-muted hover:text-text transition-colors"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    )
  }

  if (type === 'empty-state') {
    return (
      <div className={`text-center space-y-3 py-6 ${className}`}>
        <div className="text-sm text-muted max-w-sm mx-auto">{children}</div>
        <button
          type="button"
          onClick={() => dismissHint(id)}
          className="text-xs text-muted hover:text-text transition-colors underline underline-offset-2"
        >
          Dismiss
        </button>
      </div>
    )
  }

  // post-action: toast-like
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 bg-surface border border-border rounded-lg text-sm ${className}`}
    >
      <span className="flex-1 text-text">{children}</span>
      <button
        type="button"
        onClick={() => dismissHint(id)}
        aria-label="Dismiss hint"
        className="shrink-0 text-muted hover:text-text transition-colors"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  )
}
