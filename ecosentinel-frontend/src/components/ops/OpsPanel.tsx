// ============================================================
// components/ops/OpsPanel.tsx
// Three sections: service health, model info, model reload.
// Always raw display — no dual-view needed for ops.
// ============================================================

import { useEffect, useState, useCallback } from 'react';
import {
  Activity, Database, Cpu, RefreshCw, CheckCircle2,
  XCircle, AlertCircle, ChevronDown, ChevronRight,
} from 'lucide-react';
import { getHealth, getModelInfo, postModelReload } from '@/api/api';
import { HealthDot } from '@/components/shared/StatusBadge';
import type { HealthResponse, ModelInfoResponse, ModelReloadResponse } from '@/types';
import { cn, formatTimestamp, timeAgo } from '@/lib/utils';
import { DETECTION_THRESHOLDS } from '@/constants/config';

export default function OpsPanel() {
  return (
    <div className="flex flex-col gap-4 p-4 max-w-4xl">
      <HealthSection />
      <ModelInfoSection />
      <ModelReloadSection />
    </div>
  );
}

// ── Health section ────────────────────────────────────────────

function HealthSection() {
  const [health, setHealth]           = useState<HealthResponse | null>(null);
  const [error, setError]             = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [countdown, setCountdown]     = useState(30);

  const check = useCallback(async () => {
    try {
      const h = await getHealth();
      setHealth(h);
      setError(false);
      setLastChecked(new Date().toISOString());
      setCountdown(30);
    } catch {
      setError(true);
      setCountdown(30);
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [check]);

  // Countdown ticker
  useEffect(() => {
    const tick = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(tick);
  }, []);

  const overallStatus = error ? 'offline' : health?.status === 'ok' ? 'ok' : health?.status === 'degraded' ? 'degraded' : 'offline';

  const components = [
    {
      key:    'service',
      label:  'API Service',
      icon:   Activity,
      status: error ? 'unavailable' : (health ? 'ok' : 'connecting'),
    },
    {
      key:    'model_artifacts',
      label:  'Model Artifacts',
      icon:   Cpu,
      status: health?.components.model_artifacts ?? (error ? 'unavailable' : 'connecting'),
    },
    {
      key:    'database',
      label:  'Database',
      icon:   Database,
      status: health?.components.database ?? (error ? 'unavailable' : 'connecting'),
    },
  ];

  return (
    <OpsCard title="Service Health" icon={<Activity size={13} className="text-brand" />}>
      {/* Overall status */}
      <div className="flex items-center justify-between mb-4">
        <HealthDot
          status={overallStatus}
          label={error ? 'API Offline' : health ? `Status: ${health.status.toUpperCase()}` : 'Connecting…'}
        />
        <div className="flex items-center gap-2">
          {lastChecked && (
            <span className="text-2xs font-mono text-text-muted">
              Checked {timeAgo(lastChecked)}
            </span>
          )}
          {/* Countdown progress bar */}
          <div className="w-16 h-0.5 bg-surface-border rounded-full overflow-hidden">
            <div
              className="h-full bg-brand transition-all duration-1000"
              style={{ width: `${(countdown / 30) * 100}%` }}
            />
          </div>
          <button
            onClick={check}
            title="Refresh now"
            className="p-1 rounded-sm text-text-muted hover:text-brand hover:bg-surface-hover transition-colors"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* Component rows */}
      <div className="flex flex-col gap-1.5">
        {components.map(({ key, label, icon: Icon, status }) => (
          <div
            key={key}
            className="flex items-center gap-3 px-3 py-2 bg-surface-raised border border-surface-border rounded-sm"
          >
            <Icon size={12} className="text-text-muted shrink-0" />
            <span className="text-xs font-mono text-text-secondary flex-1">{label}</span>
            <ComponentStatusChip status={status} />
          </div>
        ))}
      </div>

      {health?.timestamp && (
        <div className="mt-2 text-2xs font-mono text-text-muted">
          Server timestamp: {formatTimestamp(health.timestamp)}
        </div>
      )}
    </OpsCard>
  );
}

function ComponentStatusChip({ status }: { status: string }) {
  const isOk    = status === 'ok';
  const isWarn  = status === 'degraded' || status === 'missing';
  const isError = status === 'unavailable' || status === 'not_configured' || status === 'offline';

  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-2xs font-mono border',
      isOk    && 'bg-green-50 text-normal border-normal/30',
      isWarn  && 'bg-amber-50 text-warning border-warning/30',
      isError && 'bg-red-50 text-anomaly border-anomaly/30',
      !isOk && !isWarn && !isError && 'bg-surface-border text-text-muted border-surface-border',
    )}>
      {isOk    && <CheckCircle2 size={9} />}
      {isWarn  && <AlertCircle  size={9} />}
      {isError && <XCircle      size={9} />}
      {status.replace(/_/g, ' ').toUpperCase()}
    </span>
  );
}

// ── Model Info section ────────────────────────────────────────

function ModelInfoSection() {
  const [info, setInfo]       = useState<ModelInfoResponse | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [threshOpen, setThreshOpen] = useState(true);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [pathsOpen, setPathsOpen]   = useState(false);

  useEffect(() => {
    getModelInfo()
      .then(setInfo)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <OpsCard title="Model Info" icon={<Cpu size={13} className="text-brand" />}>
      {loading && (
        <div className="text-xs font-mono text-text-muted animate-pulse">Loading model info…</div>
      )}
      {error && (
        <div className="text-xs font-mono text-anomaly">Failed to load: {error}</div>
      )}

      {info && (
        <div className="flex flex-col gap-2">
          {/* Detection Thresholds */}
          <Collapsible
            title="Detection Thresholds"
            open={threshOpen}
            onToggle={() => setThreshOpen(!threshOpen)}
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {Object.entries({ ...DETECTION_THRESHOLDS, ...(info.detection_config ?? {}) }).map(([key, val]) => (
                <div key={key} className="flex items-center justify-between py-0.5 border-b border-surface-border/50">
                  <span className="text-2xs font-mono text-text-muted">{key.replace(/_/g, ' ')}</span>
                  <span className="text-2xs font-mono text-text-code">{String(val)}</span>
                </div>
              ))}
            </div>
          </Collapsible>

          {/* Feature Schema */}
          <Collapsible
            title={`Feature Schema (${info.feature_schema?.length ?? 0} features)`}
            open={schemaOpen}
            onToggle={() => setSchemaOpen(!schemaOpen)}
          >
            <div className="flex flex-wrap gap-1">
              {(info.feature_schema ?? []).map((f) => (
                <span key={f} className="px-1.5 py-0.5 rounded-sm bg-surface-border/60 text-2xs font-mono text-text-secondary">
                  {f}
                </span>
              ))}
            </div>
          </Collapsible>

          {/* Artifact Paths */}
          <Collapsible
            title="Artifact Paths"
            open={pathsOpen}
            onToggle={() => setPathsOpen(!pathsOpen)}
          >
            <div className="flex flex-col gap-1">
              {Object.entries(info.artifact_paths ?? {}).map(([key, path]) => (
                <div key={key} className="flex flex-col gap-0.5">
                  <span className="text-2xs font-mono text-text-muted">{key}</span>
                  <span className="text-2xs font-mono text-text-code break-all">{path}</span>
                </div>
              ))}
            </div>
          </Collapsible>
        </div>
      )}
    </OpsCard>
  );
}

// ── Model Reload section ──────────────────────────────────────

function ModelReloadSection() {
  const [confirm, setConfirm]         = useState(false);
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState<ModelReloadResponse | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [lastReloaded, setLastReloaded] = useState<string | null>(null);

  const handleReload = async () => {
    if (!confirm) { setConfirm(true); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await postModelReload();
      setResult(r);
      setLastReloaded(new Date().toISOString());
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <OpsCard title="Model Reload" icon={<RefreshCw size={13} className="text-brand" />}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-secondary">
          Hot-reloads all model artifacts from disk. No in-flight requests are dropped.
          Use after retraining models to deploy updates without restarting the service.
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={handleReload}
            disabled={loading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold transition-colors',
              confirm
                ? 'bg-warning text-surface-bg hover:bg-yellow-400'
                : 'bg-brand text-text-inverse hover:bg-brand-light',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Reloading…' : confirm ? 'Confirm Reload' : 'Reload Models'}
          </button>

          {confirm && (
            <button
              onClick={() => setConfirm(false)}
              className="px-2.5 py-1.5 rounded-sm text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
          )}

          {lastReloaded && (
            <span className="text-2xs font-mono text-text-muted">
              Last reloaded {timeAgo(lastReloaded)}
            </span>
          )}
        </div>

        {confirm && (
          <div className="text-xs text-warning font-mono bg-amber-50 border border-warning/30 rounded-sm px-2.5 py-2">
            This will replace all in-memory models. Click "Confirm Reload" to proceed.
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-1 p-2.5 bg-green-50 border border-normal/30 rounded-sm">
            <div className="flex items-center gap-1.5 text-xs text-normal font-mono">
              <CheckCircle2 size={12} />
              Reload successful — {result.status}
            </div>
            {result.artifacts && Object.entries(result.artifacts).map(([k, v]) => (
              <div key={k} className="text-2xs font-mono text-text-muted flex gap-2">
                <span className="text-text-secondary">{k}:</span>
                <span className="break-all">{v}</span>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="text-xs text-anomaly font-mono bg-red-50 border border-anomaly/30 rounded-sm px-2.5 py-2">
            {error}
          </div>
        )}
      </div>
    </OpsCard>
  );
}

// ── Shared layout primitives ──────────────────────────────────

function OpsCard({
  title, icon, children,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-border bg-surface-raised">
        {icon}
        <span className="text-xs font-semibold text-text-primary">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Collapsible({
  title, open, onToggle, children,
}: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border border-surface-border rounded-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface-raised hover:bg-surface-hover transition-colors text-xs"
      >
        <span className="font-mono text-text-secondary">{title}</span>
        {open
          ? <ChevronDown size={12} className="text-text-muted" />
          : <ChevronRight size={12} className="text-text-muted" />
        }
      </button>
      {open && <div className="p-3 bg-surface-bg">{children}</div>}
    </div>
  );
}
