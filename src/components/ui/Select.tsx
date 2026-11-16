import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options?: SelectOption[];
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-[#d9dfe5] bg-white px-3 py-1.5 text-sm text-[#070e16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#070e16]/20 focus-visible:border-[#070e16] disabled:cursor-not-allowed disabled:bg-[#f9fafc]',
        className
      )}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options
        ? options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))
        : children}
    </select>
  )
);
Select.displayName = 'Select';
