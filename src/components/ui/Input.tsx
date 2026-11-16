import * as React from 'react';
import { cn } from '../../lib/utils';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('block text-xs font-medium text-[#070e16] mb-1.5', className)}
      {...props}
    />
  )
);
Label.displayName = 'Label';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-[#d9dfe5] bg-white px-3 py-1.5 text-sm text-[#070e16] placeholder:text-[#555f69]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#070e16]/20 focus-visible:border-[#070e16] disabled:cursor-not-allowed disabled:bg-[#f9fafc] disabled:opacity-60',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[84px] w-full rounded-md border border-[#d9dfe5] bg-white px-3 py-2 text-sm text-[#070e16] placeholder:text-[#555f69]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#070e16]/20 focus-visible:border-[#070e16] disabled:cursor-not-allowed disabled:bg-[#f9fafc]',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';
