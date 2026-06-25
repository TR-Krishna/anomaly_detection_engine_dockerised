// ============================================================
// components/explanation/ExplanationResult.tsx
// Renders AnomalyExplanationResponse in technical or non-tech view.
// Handles all status states: pending, completed, failed, null.
// ============================================================

import { Brain, AlertCircle, CheckCircle2, Clock, MinusCircle } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import JsonViewer from '@/components/shared/JsonViewer';
import {
  AnomalyIdBadge,
  ConfidencePill,
  ExplanationStatusBadge,
} from '@/components/shared/StatusBadge';
import { adaptExplanationResponse } from '@/lib/adapters';
import { fmtNum, formatTimestamp } from '@/lib/utils';

export default function ExplanationResult() {
  const viewMode = useAppStore((s) => s.viewMode);
  const { response, isLoading } = useAppStore((s) => s.explanation);

  // Empty / loading states
  if (isLoading && !response) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-text-muted">
        <Brain size={24} className="animate-pulse text-brand" />
        <span className="text-sm font-mono">Fetching explanation…</span>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2 text-text-muted p-8">
        <div className="text-4xl text-surface-border">🧠</div>
        <div className="text-sm font-mono text-center">
          Enter an anomaly ID to fetch the AI-generated explanation.
        </div>
        <div className="text-2xs text-text-muted text-center mt-1 max-w-xs">
          Explanations are generated asynchronously — if status is pending,
          the result panel will update automatically.
        </div>
      </div>
    );
  }

  return viewMode === 'technical'
    ? <TechnicalExplanation />
    : <NonTechnicalExplanation />;
}

// ── Technical explanation ─────────────────────────────────────

function TechnicalExplanation() {
  const { response } = useAppStore((s) => s.explanation);
  if (!response) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-border bg-surface-raised shrink-0 flex-wrap">
        <AnomalyIdBadge anomalyId={response.anomaly_id} showNavigate={false} />
        <span className="font-mono text-xs font-semibold text-text-primary">{response.meter_serial}</span>
        <span className="text-2xs font-mono text-text-muted">{formatTimestamp(response.interval_timestamp)}</span>
        <div className="ml-auto">
          <ExplanationStatusBadge status={response.explanation_status} size="md" />
        </div>
      </div>

      {/* Pending overlay */}
      {response.explanation_status === 'pending' && <PendingBanner />}

      {/* Full JSON */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {/* Explanation object */}
        {response.explanation && (
          <JsonViewer data={response.explanation} label="explanation" expandDepth={2} />
        )}

        {/* Detection context */}
        <JsonViewer
          data={{
            rule_violations: response.rule_violations,
            zscore_value:    response.zscore_value,
            if_score:        response.if_score,
          }}
          label="detection context"
          expandDepth={2}
        />

        {/* Metadata */}
        <JsonViewer
          data={{
            anomaly_id:               response.anomaly_id,
            meter_serial:             response.meter_serial,
            interval_timestamp:       response.interval_timestamp,
            explanation_status:       response.explanation_status,
            explanation_generated_at: response.explanation_generated_at,
            explanation_error:        response.explanation_error,
          }}
          label="metadata"
          expandDepth={2}
        />
      </div>
    </div>
  );
}

// ── Non-technical explanation ─────────────────────────────────

function NonTechnicalExplanation() {
  const { response } = useAppStore((s) => s.explanation);
  if (!response) return null;

  const display = adaptExplanationResponse(response);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-border bg-surface-raised shrink-0 flex-wrap">
        <Brain size={13} className="text-brand" />
        <span className="text-xs font-semibold text-text-primary">
          Anomaly Analysis — {display.meterSerial}
        </span>
        <span className="text-2xs font-mono text-text-muted">{display.timestamp}</span>
        <div className="ml-auto flex items-center gap-2">
          <AnomalyIdBadge anomalyId={display.anomalyId} showNavigate={false} />
          <ExplanationStatusBadge status={display.status} size="md" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

        {/* Status-specific rendering */}
        {display.status === 'pending' && <PendingBanner />}

        {display.status === 'failed' && (
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-anomaly/40 rounded-sm">
            <AlertCircle size={16} className="text-anomaly shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-anomaly mb-1">Explanation Generation Failed</div>
              {display.error && (
                <div className="text-xs text-text-secondary font-mono">{display.error}</div>
              )}
            </div>
          </div>
        )}

        {display.status === null && (
          <div className="flex items-start gap-3 p-3 bg-surface-raised border border-surface-border rounded-sm">
            <MinusCircle size={16} className="text-text-muted shrink-0 mt-0.5" />
            <div className="text-sm text-text-muted">
              Decision engine was disabled when this anomaly was detected.
              Enable the Decision Engine toggle and re-run detection to generate explanations.
            </div>
          </div>
        )}

        {display.status === 'completed' && display.explanation && (
          <>
            {/* Main explanation */}
            <Section
              icon={<Brain size={14} className="text-brand" />}
              title="What happened?"
            >
              <p className="text-sm text-text-primary leading-relaxed">
                {display.explanation}
              </p>
            </Section>

            {/* Supporting factors */}
            {display.supportingFactors.length > 0 && (
              <Section
                icon={<CheckCircle2 size={14} className="text-normal" />}
                title="Evidence supporting this finding"
              >
                <ul className="flex flex-col gap-1.5">
                  {display.supportingFactors.map((factor, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-normal mt-1 shrink-0">•</span>
                      {factor}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* False positive scenarios */}
            {display.falsePositiveScenarios.length > 0 && (
              <Section
                icon={<AlertCircle size={14} className="text-warning" />}
                title="Could this be a false alarm?"
              >
                <ul className="flex flex-col gap-1.5">
                  {display.falsePositiveScenarios.map((scenario, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-warning mt-1 shrink-0">•</span>
                      {scenario}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Confidence + limitations */}
            <div className="flex flex-col gap-2">
              {display.confidence && (
                <div className="flex items-center gap-3">
                  <ConfidencePill confidence={display.confidence} />
                  {display.limitations && (
                    <span className="text-2xs text-text-muted font-mono italic">
                      {display.limitations}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Footer attribution */}
            <div className="mt-auto pt-3 border-t border-surface-border flex items-center justify-between flex-wrap gap-2">
              {display.modelAttribution && (
                <span className="text-2xs text-text-muted font-mono">
                  Generated by {display.modelAttribution}
                </span>
              )}
              {display.generatedAt && (
                <div className="flex items-center gap-1 text-2xs text-text-muted font-mono">
                  <Clock size={9} />
                  {display.generatedAt}
                </div>
              )}
            </div>
          </>
        )}

        {/* Detection context — always show for context */}
        {(response?.rule_violations?.length || response?.zscore_value !== null || response?.if_score !== null) && (
          <div className="border border-surface-border rounded-sm overflow-hidden">
            <div className="px-3 py-1.5 bg-surface-raised border-b border-surface-border">
              <span className="text-2xs font-mono text-text-muted uppercase tracking-widest">
                Detection Context
              </span>
            </div>
            <div className="p-3 grid grid-cols-3 gap-3 text-xs font-mono">
              <div>
                <div className="text-2xs text-text-muted mb-1">Rule Violations</div>
                <div className="text-text-secondary">
                  {response?.rule_violations?.length
                    ? response.rule_violations.join(', ')
                    : <span className="text-normal">None</span>}
                </div>
              </div>
              <div>
                <div className="text-2xs text-text-muted mb-1">Z-Score</div>
                <div className="text-text-primary">{fmtNum(response?.zscore_value)}</div>
              </div>
              <div>
                <div className="text-2xs text-text-muted mb-1">IF Score</div>
                <div className="text-text-primary">{fmtNum(response?.if_score)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────

function PendingBanner() {
  const pollElapsedMs = useAppStore((s) => s.explanation.pollElapsedMs);
  const elapsedSec    = Math.round(pollElapsedMs / 1000);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-warning/30">
      <div className="w-2 h-2 rounded-full bg-warning animate-pulse shrink-0" />
      <span className="text-xs font-mono text-warning">
        AI is analyzing this anomaly
        {elapsedSec > 0 && ` · ${elapsedSec}s elapsed`}
      </span>
    </div>
  );
}

function Section({
  icon, title, children,
}: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold text-text-primary">{title}</span>
      </div>
      <div className="pl-6">{children}</div>
    </div>
  );
}
