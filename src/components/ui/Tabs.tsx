import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-[#d9dfe5] bg-[#edf2f8] p-1 overflow-x-auto max-w-full',
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  accent,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { accent?: 'core' | 'nexus' | 'environ' }) {
  const activeClass =
    accent === 'nexus'
      ? 'data-[state=active]:bg-white data-[state=active]:text-[#e60018] data-[state=active]:border-[#fecaca]'
      : accent === 'environ'
        ? 'data-[state=active]:bg-white data-[state=active]:text-[#007e46] data-[state=active]:border-[#a7f3d0]'
        : 'data-[state=active]:bg-white data-[state=active]:text-[#070e16] data-[state=active]:border-[#d9dfe5]';

  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap shrink-0 rounded px-3 py-1.5 text-xs font-medium text-[#555f69] border border-transparent transition-colors hover:text-[#070e16] cursor-pointer',
        activeClass,
        className
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
