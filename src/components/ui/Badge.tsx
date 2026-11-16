import * as React from 'react';
import { cn } from '../../lib/utils';

export type StatusTone = 'neutral' | 'nexus' | 'environ' | 'warning' | 'danger' | 'success';

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-[#edf2f8] text-[#070e16] border-[#d9dfe5]',
  nexus: 'bg-[#fef2f2] text-[#b91c1c] border-[#fecaca]',
  environ: 'bg-[#ecfdf5] text-[#047857] border-[#a7f3d0]',
  success: 'bg-[#ecfdf5] text-[#047857] border-[#a7f3d0]',
  warning: 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]',
  danger: 'bg-[#fef2f2] text-[#e60018] border-[#fecaca]',
};

export function StatusBadge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: StatusTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border whitespace-nowrap shrink-0 tracking-tight',
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function statusToTone(status: string): StatusTone {
  const s = status.toLowerCase();
  if (['approved', 'closed', 'active', 'pass', 'resolved', 'completed', 'present'].includes(s)) return 'success';
  if (['rejected', 'fail', 'critical', 'major', 'expired', 'absent', 'deactivated'].includes(s)) return 'danger';
  if (['pending_approval', 'submitted', 'in_progress', 'high', 'warning', 'expiring_soon', 'late', 'open'].includes(s)) return 'warning';
  return 'neutral';
}
