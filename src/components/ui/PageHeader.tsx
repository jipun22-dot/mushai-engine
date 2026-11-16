import * as React from 'react';
import { cn } from '../../lib/utils';

export function PageHeader({
  title,
  subtitle,
  moduleAccent,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  moduleAccent?: 'core' | 'nexus' | 'environ';
  actions?: React.ReactNode;
  className?: string;
}) {
  const accentLabel =
    moduleAccent === 'nexus'
      ? { text: 'Nexus Manufacturing', color: 'text-[#e60018]' }
      : moduleAccent === 'environ'
        ? { text: 'Environ EHS & Sustainability', color: 'text-[#007e46]' }
        : null;

  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-[#e9eef4]', className)}>
      <div>
        {accentLabel && (
          <p className={cn('text-xs font-semibold tracking-wide mb-1', accentLabel.color)}>
            {accentLabel.text}
          </p>
        )}
        <h1 className="text-xl font-semibold text-[#070e16] tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-[#555f69] mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2.5 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}
