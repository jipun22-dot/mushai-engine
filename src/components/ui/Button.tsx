import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#070e16] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-[#070e16] text-white hover:bg-[#1b2634]',
        nexus: 'bg-[#e60018] text-white hover:bg-[#c80015]',
        environ: 'bg-[#007e46] text-white hover:bg-[#006638]',
        secondary: 'bg-[#edf2f8] text-[#070e16] hover:bg-[#dfe7f0] border border-[#d9dfe5]',
        outline: 'bg-white text-[#070e16] border border-[#d9dfe5] hover:bg-[#f9fafc]',
        ghost: 'text-[#555f69] hover:text-[#070e16] hover:bg-[#edf2f8]',
        destructive: 'bg-[#fef2f2] text-[#e60018] border border-[#fecaca] hover:bg-[#fee2e2]',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-sm',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = 'Button';
