// ============================================================
// components/explanation/ExplanationInput.tsx
// Input panel for GET /anomalies/{id}/explanation.
// Shows session anomaly IDs as quick-pick chips.
// ============================================================

import { Brain, Search, X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useExplanation } from '@/hooks/useExplanation';
import ProcessChecklist from '@/components/shared/ProcessChecklist';
import { POLLING_CONFIG } from '@/constants/config';
import { cn } from '@/lib/utils';

export default function ExplanationInput() {
  const {
    explanation,
    detection,
    setExplanationInputId,
    resetExplanation,
  } = useAppStore();

  const { fetchExplanation, cancelPolling } = useExplanation();

  const handleSubmit = () => {
    const id = parseInt(explanation.inputAnomalyId.trim());
    if (!id || id <= 0) return;
    fetchExplanation(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  const handleReset = () => {
    cancelPolling();
    resetExplanation();
  };

  const isValidId = parseInt(explanation.inputAnomalyId.trim()) > 0;
  const isActive  = explanation.isLoading || explanation.isPolling;

  // Elapsed time display for polling
  const elapsedSec = Math.round(explanation.pollElapsedMs / 1000);

  return (
    <div className="flex flex-col h-full bg-surface-card border border-surface-border rounded-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-border bg-surface-raised shrink-0">
        <Brain size={13} className="text-brand" />
        <span className="text-xs font-semibold text-text-primary">Decision Engine</span>
        <span className="text-2xs text-text-muted font-mono ml-1">AI Explanation</span>
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-3 gap-4">

        {/* Anomaly ID input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-2xs font-mono text-text-secondary uppercase tracking-widest">
            Anomaly ID
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={explanation.inputAnomalyId}
              onChange={(e) => setExplanationInputId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. 449618"
              disabled={isActive}
              className={cn(
                'flex-1 px-2.5 py-1.5 rounded-sm border bg-surface-raised font-mono text-sm text-text-primary',
                'focus:outline-none focus:ring-1 focus:ring-brand/50',
                'border-surface-border placeholder:text-text-muted',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            />
            <button
              onClick={handleSubmit}
              disabled={!isValidId || isActive}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold transition-colors shrink-0',
                'bg-brand text-text-inverse hover:bg-brand-light',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <Search size={11} />
              Fetch
            </button>
            {(isActive || explanation.response) && (
              <button
                onClick={handleReset}
                title="Clear and reset"
                className="p-1.5 rounded-sm border border-surface-border text-text-muted hover:text-anomaly hover:border-anomaly/50 transition-colors"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <div className="text-2xs text-text-muted font-mono">
            Enter an anomaly ID from the Detection Engine results, or pick one below.
          </div>
        </div>

        {/* Session quick-pick */}
        {detection.sessionAnomalyIds.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-2xs font-mono text-text-secondary uppercase tracking-widest">
              From This Session
            </div>
            <div className="flex flex-wrap gap-1.5">
              {detection.sessionAnomalyIds.map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    setExplanationInputId(String(id));
                    fetchExplanation(id);
                  }}
                  disabled={isActive}
                  className={cn(
                    'px-2 py-1 rounded-sm border text-2xs font-mono transition-colors',
                    explanation.inputAnomalyId === String(id)
                      ? 'border-brand/60 bg-brand-faint text-brand-dark'
                      : 'border-surface-border bg-surface-raised text-text-secondary hover:border-brand/40 hover:text-brand-dark',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  #{id}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Polling status */}
        {explanation.isPolling && (
          <div className="flex flex-col gap-1 p-2.5 bg-brand-faint border border-brand/30 rounded-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
              <span className="text-xs font-mono text-brand-dark">
                Waiting for AI analysis…
              </span>
            </div>
            <div className="flex items-center justify-between text-2xs font-mono text-text-muted">
              <span>{elapsedSec}s elapsed</span>
              <span>
                Timeout in {Math.max(0, POLLING_CONFIG.maxAttempts * POLLING_CONFIG.intervalMs / 1000 - elapsedSec)}s
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-0.5 bg-surface-border rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-brand transition-all duration-1000"
                style={{
                  width: `${Math.min(100,
                    (explanation.pollElapsedMs / (POLLING_CONFIG.maxAttempts * POLLING_CONFIG.intervalMs)) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Timeout message */}
        {explanation.timedOut && explanation.error && (
          <div className="p-2.5 bg-amber-50 border border-warning/40 rounded-sm">
            <div className="text-xs text-warning font-mono">{explanation.error}</div>
          </div>
        )}

        {/* Checklist */}
        {explanation.checklistSteps.length > 0 && (
          <div className="border-t border-surface-border pt-3">
            <div className="text-2xs text-text-muted font-mono mb-2 uppercase tracking-widest">
              Progress
            </div>
            <ProcessChecklist steps={explanation.checklistSteps} />
          </div>
        )}

        {/* Non-timeout errors */}
        {explanation.error && !explanation.timedOut && (
          <div className="text-xs text-anomaly font-mono bg-red-50 border border-anomaly/30 rounded-sm px-2.5 py-2">
            {explanation.error}
          </div>
        )}

        {/* Config reference */}
        <div className="mt-auto pt-3 border-t border-surface-border">
          <div className="text-2xs text-text-muted font-mono space-y-0.5">
            <div className="flex justify-between">
              <span>Poll interval</span>
              <span className="text-text-code">{POLLING_CONFIG.intervalMs / 1000}s</span>
            </div>
            <div className="flex justify-between">
              <span>Max attempts</span>
              <span className="text-text-code">{POLLING_CONFIG.maxAttempts}</span>
            </div>
            <div className="flex justify-between">
              <span>Timeout window</span>
              <span className="text-text-code">
                {POLLING_CONFIG.maxAttempts * POLLING_CONFIG.intervalMs / 1000}s
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
