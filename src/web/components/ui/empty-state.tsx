import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function EmptyState({
  message,
  action,
  className,
}: {
  message: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-8 text-center', className)}>
      <p className="max-w-prose text-body text-muted">{message}</p>
      {action}
    </div>
  )
}
