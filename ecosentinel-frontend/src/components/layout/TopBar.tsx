// ============================================================
// components/layout/TopBar.tsx
// Top bar: view toggle, decision engine toggle, LLM selector,
// API health indicator.
// ============================================================

import { useEffect, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import ViewModeToggle from '@/components/shared/ViewModeToggle';
import { HealthDot } from '@/components/shared/StatusBadge';
import { useAppStore } from '@/store/appStore';
import { getHealth } from '@/api/api';
import { LLM_MODEL_GROUPS } from '@/constants/config';
import type { HealthResponse } from '@/types';
import { cn } from '@/lib/utils';

export default function TopBar() {
  const decisionEngineEnabled    = useAppStore((s) => s.decisionEngineEnabled);
  const setDecisionEngineEnabled = useAppStore((s) => s.setDecisionEngineEnabled);
  const selectedLLMModel         = useAppStore((s) => s.selectedLLMModel);
  const setSelectedLLMModel      = useAppStore((s) => s.setSelectedLLMModel);

  const [health, setHealth]           = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [modelOpen, setModelOpen]     = useState(false);

  // Health polling every 30 seconds
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const h = await getHealth();
        if (mounted) { setHealth(h); setHealthError(false); }
      } catch {
        if (mounted) setHealthError(true);
      }
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const healthStatus = healthError
    ? 'offline'
    : health?.status === 'ok'
      ? 'ok'
      : health?.status === 'degraded'
        ? 'degraded'
        : 'offline';

  const healthLabel = healthError ? 'API Offline' : health ? `API ${health.status}` : 'Connecting…';

  // Selected model display label
  const selectedOption = LLM_MODEL_GROUPS
    .flatMap((g) => g.models)
    .find((m) => m.value === selectedLLMModel);

  return (
    <header className="
      h-11 flex items-center gap-3 px-4
      bg-surface-card border-b border-surface-border
      shrink-0
    ">
      {/* Health indicator */}
      <HealthDot
        status={healthStatus}
        label={healthLabel}
        className="mr-1"
      />

      <div className="w-px h-4 bg-surface-border" />

      {/* View mode toggle */}
      <ViewModeToggle />

      <div className="w-px h-4 bg-surface-border" />

      {/* Decision Engine toggle */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <span className="text-2xs font-mono text-text-secondary">Decision Engine</span>
        <button
          role="switch"
          aria-checked={decisionEngineEnabled}
          onClick={() => setDecisionEngineEnabled(!decisionEngineEnabled)}
          className={cn(
            'relative inline-flex w-8 h-4 rounded-full transition-colors duration-200 shrink-0',
            decisionEngineEnabled ? 'bg-brand' : 'bg-surface-border',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200',
              decisionEngineEnabled ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
        <span className={cn(
          'text-2xs font-mono font-semibold',
          decisionEngineEnabled ? 'text-brand-dark' : 'text-text-muted',
        )}>
          {decisionEngineEnabled ? 'ON' : 'OFF'}
        </span>
      </label>

      <div className="w-px h-4 bg-surface-border" />

      {/* LLM Model selector */}
      <div className="relative">
        <button
          onClick={() => setModelOpen(!modelOpen)}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-2xs font-mono transition-colors',
            'border-surface-border bg-surface-raised text-text-secondary',
            'hover:border-brand/40 hover:text-text-primary',
            modelOpen && 'border-brand/40 text-text-primary',
          )}
        >
          <span className="text-text-muted">Model:</span>
          <span className="text-brand-dark max-w-[140px] truncate">
            {selectedOption?.label ?? selectedLLMModel}
          </span>
          <ChevronDown
            size={10}
            className={cn('transition-transform', modelOpen && 'rotate-180')}
          />
        </button>

        {modelOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setModelOpen(false)}
            />
            {/* Dropdown */}
            <div className="
              absolute right-0 top-full mt-1 z-20 w-64
              bg-surface-card border border-surface-border rounded-sm shadow-card
              py-1 animate-slide-in
            ">
              {LLM_MODEL_GROUPS.map((group) => (
                <div key={group.group}>
                  <div className="px-3 py-1.5 text-2xs font-mono text-text-muted uppercase tracking-widest border-b border-surface-border">
                    {group.group}
                  </div>
                  {group.models.map((model) => (
                    <button
                      key={model.value}
                      disabled={!model.available}
                      onClick={() => {
                        if (model.available) {
                          setSelectedLLMModel(model.value);
                          setModelOpen(false);
                        }
                      }}
                      title={model.note}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors',
                        model.available
                          ? selectedLLMModel === model.value
                            ? 'bg-brand-faint text-brand-dark'
                            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                          : 'text-text-muted cursor-not-allowed opacity-50',
                      )}
                    >
                      <span>{model.label}</span>
                      {!model.available && (
                        <span className="text-2xs text-text-muted">env vars</span>
                      )}
                      {selectedLLMModel === model.value && model.available && (
                        <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Reload health */}
      <button
        onClick={() => getHealth().then(setHealth).catch(() => setHealthError(true))}
        title="Refresh health status"
        className="p-1 rounded-sm text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
      >
        <RefreshCw size={11} />
      </button>
    </header>
  );
}
