// ============================================================
// pages/OpsPage.tsx
// Single-column operations page: health, model info, reload.
// ============================================================

import OpsPanel from '@/components/ops/OpsPanel';

export default function OpsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-2 border-b border-surface-border bg-surface-raised">
        <span className="text-2xs font-mono text-text-muted uppercase tracking-widest">
          Operations
        </span>
      </div>
      <OpsPanel />
    </div>
  );
}
