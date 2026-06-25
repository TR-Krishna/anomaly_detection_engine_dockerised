// ============================================================
// components/shared/ProcessChecklist.tsx
// Animated checklist showing the status of each processing step.
// Fully driven by props — no internal state.
// ============================================================

import { CheckCircle, Circle, XCircle, Loader2, MinusCircle } from 'lucide-react';
import type { ChecklistStep, ChecklistStatus } from '@/types';
import { cn } from '@/lib/utils';

interface ProcessChecklistProps {
  steps: ChecklistStep[];
  className?: string;
  /** Compact mode hides skipped steps. Default: false */
  compact?: boolean;
}

export default function ProcessChecklist({ steps, className = '', compact = false }: ProcessChecklistProps) {
  const visibleSteps = compact
    ? steps.filter((s) => s.status !== 'skipped')
    : steps;

  if (visibleSteps.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {visibleSteps.map((step) => (
        <StepRow key={step.id} step={step} />
      ))}
    </div>
  );
}

function StepRow({ step }: { step: ChecklistStep }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-sm text-xs transition-colors duration-200',
        step.status === 'running'  && 'bg-brand-faint',
        step.status === 'done'     && 'bg-transparent',
        step.status === 'error'    && 'bg-red-50',
        step.status === 'waiting'  && 'bg-transparent',
        step.status === 'skipped'  && 'bg-transparent opacity-50',
      )}
    >
      <StatusIcon status={step.status} />
      <span
        className={cn(
          'font-mono text-2xs',
          step.status === 'running' && 'text-brand-light',
          step.status === 'done'    && 'text-normal',
          step.status === 'error'   && 'text-anomaly',
          step.status === 'waiting' && 'text-text-muted',
          step.status === 'skipped' && 'text-text-muted line-through',
        )}
      >
        {step.label}
      </span>
      {step.status === 'running' && (
        <span className="ml-auto text-2xs text-brand animate-pulse">in progress</span>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: ChecklistStatus }) {
  const size = 12;
  switch (status) {
    case 'done':
      return <CheckCircle size={size} className="text-normal shrink-0" />;
    case 'running':
      return <Loader2 size={size} className="text-brand animate-spin shrink-0" />;
    case 'error':
      return <XCircle size={size} className="text-anomaly shrink-0" />;
    case 'skipped':
      return <MinusCircle size={size} className="text-text-muted shrink-0" />;
    case 'waiting':
    default:
      return <Circle size={size} className="text-surface-border shrink-0" />;
  }
}
