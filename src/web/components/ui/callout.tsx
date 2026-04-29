import * as React from 'react'
import { cn } from '../../lib/utils'

type Tone = 'accent' | 'info' | 'warning' | 'reject'

const TONE_CLASSES: Record<Tone, string> = {
  accent: 'bg-accent/8 border-accent/30',
  info: 'bg-info/8 border-info/30',
  warning: 'bg-warning/10 border-warning/35',
  reject: 'bg-reject/8 border-reject/30',
}

export interface CalloutProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: Tone
  icon?: React.ReactNode
  label?: React.ReactNode
}

const Callout = React.forwardRef<HTMLDivElement, CalloutProps>(
  ({ className, tone = 'accent', icon, label, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-start gap-3 rounded-md border px-3 py-2 text-sm',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0 flex-1 space-y-1">
        {label && <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>}
        <div className="text-text">{children}</div>
      </div>
    </div>
  ),
)
Callout.displayName = 'Callout'

export { Callout }
