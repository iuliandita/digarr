import { useState } from 'react'
import { useI18n } from '../lib/i18n'

export function DiscoveryModeInfoBox({
  storageKey,
  title,
  children,
}: {
  storageKey: string
  title?: string
  children: React.ReactNode
}) {
  const { t } = useI18n()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  })

  if (dismissed) {
    return null
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
      {title && <div className="mb-1 font-medium text-text">{title}</div>}
      <div>{children}</div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(storageKey, '1')
            } catch {
              // ignore storage failures
            }
            setDismissed(true)
          }}
          className="text-xs font-medium text-accent underline"
        >
          {t('discoveryMode.dismiss')}
        </button>
      </div>
    </div>
  )
}
