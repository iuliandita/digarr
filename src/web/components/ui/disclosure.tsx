import { ChevronDown } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { cn } from '../../lib/utils'

// Content stays mounted while closed so unsaved form drafts survive collapsing.
export function Disclosure({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
  className,
  id,
}: {
  title: ReactNode
  defaultOpen?: boolean
  /** Controlled state; omit for the uncontrolled default. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
  className?: string
  id?: string
}) {
  const [openState, setOpenState] = useState(defaultOpen)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  const panelId = useId()
  return (
    <div id={id} className={cn('rounded-surface border border-border', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 rounded-surface p-4 text-left text-body font-medium text-text transition-colors hover:bg-surface-2 focus-ring"
      >
        {title}
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!open} className="px-4 pb-4">
        {children}
      </div>
    </div>
  )
}
