// ============================================================
// components/detection/DetectionResult.tsx
// Renders DetectBatchResponse in technical or non-technical view.
// AnomalyIdBadge is always shown regardless of view mode.
// ============================================================

import { useState } from 'react';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import JsonViewer from '@/components/shared/JsonViewer';
import {
  AnomalyBadge,
  ExplanationStatusBadge,
  AnomalyIdBadge,
  LayerPill,
} from '@/components/shared/StatusBadge';
import { adaptDetectResponse } from '@/lib/adapters';
import { cn, formatTimestamp } from '@/lib/utils';
import { DETECTION_LAYER_LABELS } from '@/constants/config';
import type { DetectResponse, DetectBatchResponse } from '@/types';

// ── Root component ────────────────────────────────────────────

export default function DetectionResult() {
  const viewMode    = useAppStore((s) => s.viewMode);
  const { lastResponse, isLoading } = useAppStore((s) => s.detection);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-text-muted">
        <Activity size={24} className="animate-pulse text-brand" />
        <span className="text-sm font-mono">Running detection pipeline…</span>
      </div>
    );
  }

  if (!lastResponse) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2 text-text-muted p-8">
        <div className="text-4xl text-surface-border">⚡</div>
        <div className="text-sm font-mono text-center">
          Submit a detection request to see results here.
        </div>
        <div className="text-2xs text-text-muted text-center mt-1">
          Results will show layer-by-layer anomaly detection output.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Batch summary header */}
      <BatchHeader response={lastResponse} />

      {/* Record results */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {lastResponse.results.map((result, i) => (
          <RecordResult
            key={i}
            result={result}
            index={i}
            viewMode={viewMode}
          />
        ))}
      </div>
    </div>
  );
}

// ── Batch header ──────────────────────────────────────────────

function BatchHeader({ response }: { response: DetectBatchResponse }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-b border-surface-border bg-surface-raised shrink-0">
      <div className="flex items-center gap-1.5">
        <span className="text-2xs text-text-muted font-mono">BATCH</span>
        <span className="text-xs font-mono font-semibold text-text-primary">{response.total} records</span>
      </div>
      <div className="w-px h-3 bg-surface-border" />
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono font-semibold text-anomaly">{response.anomalies}</span>
        <span className="text-2xs text-text-muted font-mono">anomalies</span>
      </div>
      <div className="w-px h-3 bg-surface-border" />
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono font-semibold text-normal">{response.total - response.anomalies}</span>
        <span className="text-2xs text-text-muted font-mono">normal</span>
      </div>
    </div>
  );
}

// ── Per-record result ─────────────────────────────────────────

function RecordResult({
  result,
  index,
  viewMode,
}: {
  result: DetectResponse;
  index: number;
  viewMode: 'technical' | 'non-technical';
}) {
  return (
    <div className={cn(
      'border rounded-sm overflow-hidden transition-colors',
      result.is_anomaly
        ? 'border-anomaly/40 bg-red-50'
        : 'border-surface-border bg-surface-card',
    )}>
      {/* Record header — always shown */}
      <RecordHeader result={result} index={index} />

      {/* View-dependent body */}
      {viewMode === 'technical'
        ? <TechnicalBody result={result} />
        : <NonTechBody result={result} />
      }
    </div>
  );
}

// ── Record header ─────────────────────────────────────────────

function RecordHeader({ result, index }: { result: DetectResponse; index: number }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-surface-border bg-surface-raised flex-wrap">
      <span className="text-2xs font-mono text-text-muted">#{index + 1}</span>

      <span className="font-mono text-xs font-semibold text-text-primary">
        {result.meter_serial}
      </span>

      <span className="text-2xs font-mono text-text-muted">
        {formatTimestamp(result.interval_timestamp)}
      </span>

      <div className="ml-auto flex items-center gap-2 flex-wrap">
        {/* Anomaly ID badge — always visible when anomaly */}
        {result.anomaly_id && (
          <AnomalyIdBadge anomalyId={result.anomaly_id} />
        )}

        {/* Explanation status — always visible when present */}
        {result.explanation_status !== undefined && result.is_anomaly && (
          <ExplanationStatusBadge status={result.explanation_status} />
        )}

        <AnomalyBadge isAnomaly={result.is_anomaly} size="sm" />
      </div>
    </div>
  );
}

// ── Technical body ────────────────────────────────────────────

function TechnicalBody({ result }: { result: DetectResponse }) {
  const [openTab, setOpenTab] = useState<string>('overview');

  const tabs = [
    { id: 'overview',          label: 'Overview' },
    { id: 'rule_based',        label: 'Rule-Based' },
    { id: 'zscore',            label: 'Z-Score' },
    { id: 'isolation_forest',  label: 'Isolation Forest' },
    { id: 'features',          label: 'Features' },
  ];

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex border-b border-surface-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setOpenTab(tab.id)}
            className={cn(
              'px-3 py-1.5 text-2xs font-mono whitespace-nowrap transition-colors',
              openTab === tab.id
                ? 'border-b-2 border-brand text-brand-dark bg-brand-faint'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover',
            )}
          >
            {tab.label}
            {/* Anomaly dot */}
            {tab.id !== 'overview' && tab.id !== 'features' && result.layers && (
              (() => {
                const layer = result.layers[tab.id as keyof typeof result.layers] as { is_anomaly: boolean } | undefined;
                return layer?.is_anomaly
                  ? <span className="ml-1 w-1.5 h-1.5 inline-block rounded-full bg-anomaly align-middle" />
                  : null;
              })()
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-3">
        {openTab === 'overview' && (
          <JsonViewer
            data={{
              meter_serial:       result.meter_serial,
              interval_timestamp: result.interval_timestamp,
              is_anomaly:         result.is_anomaly,
              anomaly_id:         result.anomaly_id,
              explanation_status: result.explanation_status,
              error:              result.error,
            }}
            expandDepth={3}
          />
        )}
        {openTab === 'rule_based'       && result.layers && <JsonViewer data={result.layers.rule_based}       expandDepth={2} />}
        {openTab === 'zscore'           && result.layers && <JsonViewer data={result.layers.zscore}           expandDepth={2} />}
        {openTab === 'isolation_forest' && result.layers && <JsonViewer data={result.layers.isolation_forest} expandDepth={2} />}
        {openTab === 'features'         && result.features && (
          <JsonViewer data={result.features} expandDepth={1} />
        )}
        {!result.layers && !result.features && (
          <div className="text-xs text-text-muted font-mono py-2">No data for this tab.</div>
        )}
      </div>
    </div>
  );
}

// ── Non-technical body ────────────────────────────────────────

function NonTechBody({ result }: { result: DetectResponse }) {
  const display = adaptDetectResponse(result);

  if (display.error) {
    return (
      <div className="p-3 text-xs text-anomaly font-mono">
        Error: {display.error}
      </div>
    );
  }

  if (!display.isAnomaly) {
    return (
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="text-xs text-text-secondary font-mono">
          All detection layers passed. No anomalous patterns detected for this reading.
        </span>
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-3">
      {/* Layer status row */}
      <div>
        <div className="text-2xs text-text-muted font-mono mb-1.5">Detection Layers</div>
        <div className="flex flex-wrap gap-1.5">
          {display.layers.map((layer) => (
            <LayerPill key={layer.key} label={DETECTION_LAYER_LABELS[layer.key] ?? layer.label} fired={layer.fired} />
          ))}
        </div>
      </div>

      {/* Triggers */}
      <div className="grid grid-cols-1 gap-2">
        {/* Rule violations */}
        {display.ruleViolations.length > 0 && (
          <TriggerBlock label="Rule Violations">
            <ul className="flex flex-col gap-0.5">
              {display.ruleViolations.map((v, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-text-secondary">
                  <span className="text-anomaly mt-0.5">•</span>
                  {v}
                </li>
              ))}
            </ul>
          </TriggerBlock>
        )}

        {/* Z-score */}
        {display.zscoreLabel && (
          <TriggerBlock label="Statistical Deviation">
            <span className="text-xs text-warning font-mono">{display.zscoreLabel}</span>
          </TriggerBlock>
        )}

        {/* IF severity bar */}
        {display.ifSeverity !== null && (
          <TriggerBlock label="ML Anomaly Score">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-surface-border rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    display.ifSeverity > 0.75 ? 'bg-anomaly' :
                    display.ifSeverity > 0.5  ? 'bg-warning'  :
                    display.ifSeverity > 0.25 ? 'bg-yellow-500' :
                    'bg-normal',
                  )}
                  style={{ width: `${Math.round(display.ifSeverity * 100)}%` }}
                />
              </div>
              <span className="text-2xs font-mono text-text-secondary whitespace-nowrap">
                {display.ifSeverityLabel}
              </span>
            </div>
          </TriggerBlock>
        )}
      </div>
    </div>
  );
}

function TriggerBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-surface-border rounded-sm overflow-hidden">
      <div className="px-2.5 py-1 bg-surface-raised border-b border-surface-border">
        <span className="text-2xs font-mono text-text-muted uppercase tracking-widest">{label}</span>
      </div>
      <div className="px-2.5 py-2">{children}</div>
    </div>
  );
}

// ── Collapsible panel (used in TechnicalBody previously, kept for future use) ──

export function CollapsibleSection({
  title, children, defaultOpen = false, anomalyDot = false,
}: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; anomalyDot?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-surface-border rounded-sm overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface-raised hover:bg-surface-hover transition-colors text-xs"
      >
        <span className="font-mono text-text-secondary flex items-center gap-1.5">
          {anomalyDot && <span className="w-1.5 h-1.5 rounded-full bg-anomaly" />}
          {title}
        </span>
        {open ? <ChevronDown size={12} className="text-text-muted" /> : <ChevronRight size={12} className="text-text-muted" />}
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
}
