import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

const TONES = {
  info: { icon: Info, className: 'border-info/30 bg-info/10', iconClassName: 'text-info' },
  success: {
    icon: CircleCheck,
    className: 'border-approve/30 bg-approve/10',
    iconClassName: 'text-approve',
  },
  warning: {
    icon: TriangleAlert,
    className: 'border-warning/30 bg-warning/10',
    iconClassName: 'text-warning',
  },
  error: {
    icon: CircleAlert,
    className: 'border-reject/30 bg-reject/10',
    iconClassName: 'text-reject',
  },
} as const

export function Notice({
  tone = 'info',
  children,
  action,
  className,
}: {
  tone?: keyof typeof TONES
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  const { icon: Icon, className: toneClassName, iconClassName } = TONES[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-surface border px-4 py-3 text-body text-text',
        toneClassName,
        className,
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconClassName)} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
