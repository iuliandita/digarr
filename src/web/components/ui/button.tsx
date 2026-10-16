import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-body font-medium transition-colors focus-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'bg-surface-2 text-text hover:bg-surface-3',
        outline: 'border border-border bg-transparent hover:bg-surface-2 text-text',
        ghost: 'hover:bg-surface-2 text-muted hover:text-text',
        destructive: 'bg-reject text-bg hover:bg-reject/90',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'px-4 py-2 min-h-[44px] sm:min-h-9',
        sm: 'px-3 py-1.5 text-caption min-h-9 sm:min-h-8',
        lg: 'px-6 py-3 text-lead min-h-[48px]',
        icon: 'h-11 w-11 sm:h-9 sm:w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
