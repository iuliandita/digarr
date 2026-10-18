import { ChevronDown } from 'lucide-react'
import type * as React from 'react'
import { useId, useState } from 'react'
import type { MessageKey } from '@/core/i18n/messages/types'
import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Card } from './ui/card'

// `saved` means credentials are stored but not tested in this session; only OAuth uses `connected`.
export type ServiceStatus =
  | 'not_configured'
  | 'saved'
  | 'testing'
  | 'test_passed'
  | 'test_passed_unsaved'
  | 'error'
  | 'connected'

export type ServiceCardProps = {
  name: string
  description?: React.ReactNode
  status: ServiceStatus
  icon?: React.ReactNode
  /** Shown in the collapsed row, for notices that must stay visible (e.g. Experimental). */
  badge?: React.ReactNode
  onRemove?: () => void
  removing?: boolean
  onTest?: () => void
  /** Fires on any field change inside the panel, so callers can drop stale test results. */
  onEdit?: () => void
  defaultOpen?: boolean
  children: React.ReactNode
}

const STATUS_STYLE: Record<ServiceStatus, { dot: string; text: string; label: MessageKey }> = {
  not_configured: { dot: 'bg-muted', text: 'text-muted', label: 'service.notConfigured' },
  saved: { dot: 'bg-muted', text: 'text-muted', label: 'service.saved' },
  testing: { dot: 'bg-muted animate-pulse', text: 'text-muted', label: 'service.testing' },
  test_passed: { dot: 'bg-approve', text: 'text-approve', label: 'service.testPassed' },
  test_passed_unsaved: {
    dot: 'bg-warning',
    text: 'text-warning',
    label: 'service.testPassedUnsaved',
  },
  error: { dot: 'bg-reject', text: 'text-reject', label: 'service.error' },
  connected: { dot: 'bg-approve', text: 'text-approve', label: 'service.connected' },
}

function StatusIndicator({ status }: { status: ServiceStatus }) {
  const { t } = useI18n()
  const style = STATUS_STYLE[status]
  return (
    <span className={cn('flex shrink-0 items-center gap-1.5 text-caption', style.text)}>
      <span className={cn('inline-block h-2 w-2 rounded-full', style.dot)} />
      {t(style.label)}
    </span>
  )
}

/** Collapsed row with live status; the form stays mounted while closed so drafts survive. */
export function ServiceCard({
  name,
  description,
  status,
  icon,
  badge,
  onTest,
  onRemove,
  removing,
  onEdit,
  defaultOpen = false,
  children,
}: ServiceCardProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(defaultOpen)
  const titleId = useId()
  const panelId = useId()
  return (
    <Card role="group" aria-labelledby={titleId}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-surface px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-ring"
        >
          <span
            id={titleId}
            className="flex min-w-0 flex-1 items-center gap-2 text-lead font-semibold text-text"
          >
            {icon}
            {name}
            {badge}
          </span>
          <StatusIndicator status={status} />
          <ChevronDown
            aria-hidden="true"
            className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')}
          />
        </button>
      </h3>
      <div
        id={panelId}
        hidden={!open}
        onChange={onEdit}
        className="space-y-3 border-t border-border-subtle px-4 py-4"
      >
        {description && <p className="text-body text-muted">{description}</p>}
        {children}
        {onRemove && (
          <Button variant="outline" size="sm" onClick={onRemove} disabled={removing}>
            {t('settings.disconnect')}
          </Button>
        )}
        {onTest && (
          <Button variant="outline" size="sm" onClick={onTest} disabled={status === 'testing'}>
            {t('serviceCard.testConnection')}
          </Button>
        )}
      </div>
    </Card>
  )
}
