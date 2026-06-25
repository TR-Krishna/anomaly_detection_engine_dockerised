// ============================================================
// pages/DetectionPage.tsx
// Two-column layout: left = DetectionInput, right = DetectionResult.
// ============================================================

import DetectionInput  from '@/components/detection/DetectionInput';
import DetectionResult from '@/components/detection/DetectionResult';

export default function DetectionPage() {
  return (
    <div className="flex h-full gap-0 divide-x divide-surface-border">
      {/* Left: input panel */}
      <div className="w-[380px] shrink-0 flex flex-col overflow-hidden">
        <SectionLabel label="Detection Input" />
        <div className="flex-1 min-h-0 p-3 overflow-hidden flex flex-col">
          <DetectionInput />
        </div>
      </div>

      {/* Right: results panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <SectionLabel label="Detection Results" />
        <div className="flex-1 min-h-0 overflow-hidden">
          <DetectionResult />
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
