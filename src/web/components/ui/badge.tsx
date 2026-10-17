import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium',
  {
    variants: {
      variant: {
        default: 'bg-accent/5 text-accent',
        outline: 'border border-border text-muted',
        success: 'bg-approve/20 text-approve',
        destructive: 'bg-reject/5 text-reject',
        info: 'bg-info/20 text-info',
        warning: 'bg-warning/20 text-warning',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
