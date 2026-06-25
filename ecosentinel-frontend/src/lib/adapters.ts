// ============================================================
// lib/adapters.ts
// Pure functions that transform raw API response objects into
// non-technical display shapes.
//
// This is the decoupling layer between the API contract and the
// non-technical UI. When the API evolves, only these functions
// (and types/index.ts) need to change — UI components stay stable.
// ============================================================

import type {
  DetectResponse,
  AnomalyExplanationResponse,
  NonTechDetectionDisplay,
  NonTechExplanationDisplay,
} from '@/types';

import {
  DETECTION_LAYER_LABELS,
  RULE_VIOLATION_LABELS,
} from '@/constants/config';

import {
  formatTimestamp,
  normaliseIFScore,
  ifScoreLabel,
  spikeRatioLabel,
} from '@/lib/utils';

// ── Detection adapter ─────────────────────────────────────────

/**
 * Transforms a single DetectResponse into a NonTechDetectionDisplay.
 * All technical field names are replaced with human labels.
 */
export function adaptDetectResponse(r: DetectResponse): NonTechDetectionDisplay {
  // Build layer status list from whatever layers are present.
  // New detection layers are automatically included via DETECTION_LAYER_LABELS.
  const layers = r.layers
    ? Object.entries(DETECTION_LAYER_LABELS).map(([key, label]) => {
        const layerData = r.layers![key as keyof typeof r.layers] as { is_anomaly: boolean } | undefined;
        return {
          key,
          label,
          fired: layerData?.is_anomaly ?? false,
        };
      })
    : [];

  // Map raw rule violation strings to human-readable labels.
  // Falls back to the raw string if no mapping exists.
  const ruleViolations = r.layers?.rule_based?.violations?.map(
    (v) => RULE_VIOLATION_LABELS[v] ?? humaniseViolation(v)
  ) ?? [];

  // Z-score display: prefer spike_ratio (more intuitive), fall back to z-score
  const zscore = r.layers?.zscore ?? null;
  const zscoreLabel =
    zscore?.spike_ratio != null
      ? spikeRatioLabel(zscore.spike_ratio)
      : zscore?.z_score != null
        ? `Z-score: ${zscore.z_score.toFixed(2)}`
        : null;

  // IF score
  const ifScore = r.layers?.isolation_forest?.anomaly_score ?? null;

  return {
    meterSerial:      r.meter_serial,
    timestamp:        formatTimestamp(r.interval_timestamp),
    isAnomaly:        r.is_anomaly,
    anomalyId:        r.anomaly_id,
    explanationStatus: r.explanation_status,
    layers,
    ruleViolations,
    zscoreLabel:      r.is_anomaly ? zscoreLabel : null,
    ifSeverity:       r.is_anomaly ? normaliseIFScore(ifScore) : null,
    ifSeverityLabel:  r.is_anomaly ? ifScoreLabel(ifScore) : null,
    error:            r.error,
  };
}

/** Converts snake_case/internal violation keys to Title Case words. */
function humaniseViolation(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Explanation adapter ───────────────────────────────────────

/**
 * Transforms an AnomalyExplanationResponse into a NonTechExplanationDisplay.
 */
export function adaptExplanationResponse(r: AnomalyExplanationResponse): NonTechExplanationDisplay {
  const exp = r.explanation;

  const modelAttribution =
    exp?.llm_model && exp?.llm_provider
      ? `${exp.llm_model} via ${exp.llm_provider}`
      : exp?.llm_model ?? null;

  return {
    anomalyId:             r.anomaly_id,
    meterSerial:           r.meter_serial,
    timestamp:             formatTimestamp(r.interval_timestamp),
    status:                r.explanation_status,
    explanation:           exp?.anomaly_explanation ?? null,
    supportingFactors:     exp?.supporting_factors ?? [],
    falsePositiveScenarios: exp?.possible_false_positive_scenarios ?? [],
    confidence:            exp?.confidence ?? null,
    limitations:           exp?.limitations ?? null,
    modelAttribution,
    generatedAt:           r.explanation_generated_at
      ? formatTimestamp(r.explanation_generated_at)
      : null,
    error:                 r.explanation_error,
  };
}
