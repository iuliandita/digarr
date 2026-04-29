import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus:outline-none',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:opacity-90',
        outline: 'border border-border bg-transparent hover:bg-surface text-text',
        ghost: 'hover:bg-surface text-muted hover:text-text',
        destructive: 'bg-reject text-bg hover:opacity-90',
      },
      size: {
        default: 'px-4 py-2 min-h-[44px] sm:min-h-9',
        sm: 'px-3 py-1.5 text-xs min-h-9 sm:min-h-8',
        lg: 'px-6 py-3 text-base min-h-[48px]',
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
