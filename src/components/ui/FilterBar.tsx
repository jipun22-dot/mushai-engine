import * as React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from './Input';
import { Button } from './Button';

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search records...',
  children,
  onReset,
}: {
  search?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
  onReset?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 bg-white border border-[#d9dfe5] rounded-lg px-4 py-3">
      {onSearchChange !== undefined && (
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 text-[#555f69] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={search ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
          />
        </div>
      )}
      {children}
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <X className="h-3.5 w-3.5" />
          Reset
        </Button>
      )}
    </div>
  );
}
