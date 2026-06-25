// ============================================================
// pages/ExplanationPage.tsx
// Two-column layout: left = ExplanationInput, right = ExplanationResult.
// ============================================================

import ExplanationInput  from '@/components/explanation/ExplanationInput';
import ExplanationResult from '@/components/explanation/ExplanationResult';

export default function ExplanationPage() {
  return (
    <div className="flex h-full gap-0 divide-x divide-surface-border">
      {/* Left: input + checklist */}
      <div className="w-[340px] shrink-0 flex flex-col overflow-hidden">
        <SectionLabel label="Anomaly ID Input" />
        <div className="flex-1 min-h-0 p-3 overflow-hidden flex flex-col">
          <ExplanationInput />
        </div>
      </div>

      {/* Right: explanation output */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <SectionLabel label="AI Explanation" />
        <div className="flex-1 min-h-0 overflow-hidden">
          <ExplanationResult />
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-4 py-2 border-b border-surface-border bg-surface-raised shrink-0">
      <span className="text-2xs font-mono text-text-muted uppercase tracking-widest">{label}</span>
    </div>
  );
}
