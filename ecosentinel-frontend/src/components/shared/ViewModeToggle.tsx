// ============================================================
// components/shared/ViewModeToggle.tsx
// Segmented toggle for switching between Technical and
// Non-Technical views. Reads/writes global viewMode in store.
// ============================================================

import { Code2, User } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import type { ViewMode } from '@/types';

interface ViewModeToggleProps {
  className?: string;
}

export default function ViewModeToggle({ className }: ViewModeToggleProps) {
  const viewMode    = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-sm border border-surface-border bg-surface-raised p-0.5 gap-0.5',
        className,
      )}
      role="group"
      aria-label="View mode"
    >
      <ToggleButton
        mode="technical"
        active={viewMode === 'technical'}
        icon={<Code2 size={11} />}
        label="Technical"
        onClick={() => setViewMode('technical')}
      />
      <ToggleButton
        mode="non-technical"
        active={viewMode === 'non-technical'}
        icon={<User size={11} />}
        label="Non-Technical"
        onClick={() => setViewMode('non-technical')}
      />
    </div>
  );
}

interface ToggleButtonProps {
  mode:    ViewMode;
  active:  boolean;
  icon:    React.ReactNode;
  label:   string;
  onClick: () => void;
}

function ToggleButton({ active, icon, label, onClick }: ToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-2xs font-medium transition-all duration-150',
        active
          ? 'bg-brand text-text-inverse font-semibold shadow-sm'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Inline variant for use inside panels ─────────────────────

interface InlineViewToggleProps {
  value:    ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}

export function InlineViewToggle({ value, onChange, className }: InlineViewToggleProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-sm border border-surface-border bg-surface-raised p-0.5 gap-0.5',
        className,
      )}
    >
      <ToggleButton
        mode="technical"
        active={value === 'technical'}
        icon={<Code2 size={11} />}
        label="Technical"
        onClick={() => onChange('technical')}
      />
      <ToggleButton
        mode="non-technical"
        active={value === 'non-technical'}
        icon={<User size={11} />}
        label="Non-Technical"
        onClick={() => onChange('non-technical')}
      />
    </div>
  );
}
