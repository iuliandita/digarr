import { X } from 'lucide-react'
import { useHints } from '../hooks/use-hints'
import { useI18n } from '../lib/i18n'

type HintProps = {
  id: string
  type?: 'inline' | 'spotlight' | 'post-action'
  children: React.ReactNode
  className?: string
}

export function Hint({ id, type = 'inline', children, className = '' }: HintProps) {
  const { isHintDismissed, dismissHint } = useHints()
  const { t } = useI18n()

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
          aria-label={t('hint.dismissHint')}
          className="shrink-0 -my-3 -mr-3 flex min-h-11 min-w-11 items-center justify-center text-muted hover:text-text transition-colors sm:m-0 sm:min-h-0 sm:min-w-0"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    )
  }

  if (type === 'spotlight') {
    return (
      <div
        className={`flex items-start gap-2 px-3 py-2 rounded-md border border-info/30 bg-info/8 text-sm ${className}`}
      >
        <span className="flex-1 text-text">{children}</span>
        <button
          type="button"
          onClick={() => dismissHint(id)}
          aria-label={t('hint.dismissHint')}
          className="shrink-0 -my-3 -mr-3 flex min-h-11 min-w-11 items-center justify-center text-muted hover:text-text transition-colors sm:m-0 sm:min-h-0 sm:min-w-0"
        >
          <X size={13} aria-hidden="true" />
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
        aria-label={t('hint.dismissHint')}
        className="shrink-0 -my-3 -mr-3 flex min-h-11 min-w-11 items-center justify-center text-muted hover:text-text transition-colors sm:m-0 sm:min-h-0 sm:min-w-0"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  )
}
