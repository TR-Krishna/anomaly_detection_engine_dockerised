// ============================================================
// hooks/useDetect.ts
// Orchestrates POST /detect with animated checklist tracking.
// ============================================================

import { useCallback } from 'react';
import { postDetect } from '@/api/api';
import { useAppStore } from '@/store/appStore';
import type { DetectRequest } from '@/types';

// Detection checklist step definitions
const DETECT_STEPS = [
  { id: 'validate',    label: 'Validating payload' },
  { id: 'pipeline',   label: 'Running detection pipeline' },
  { id: 'rule',       label: 'Rule-based checks' },
  { id: 'zscore',     label: 'Statistical analysis (z-score)' },
  { id: 'ml',         label: 'ML anomaly detection (Isolation Forest)' },
  { id: 'persist',    label: 'Persisting results' },
  { id: 'explain',    label: 'Scheduling AI explanation task' },
];

export function useDetect() {
  const {
    setDetectionLoading,
    setDetectionRequest,
    setDetectionResponse,
    setDetectionError,
    setDetectionChecklist,
    updateDetectionStep,
    resetDetection,
    decisionEngineEnabled,
  } = useAppStore();

  const detect = useCallback(async (request: DetectRequest) => {
    // Reset previous state
    resetDetection();
    setDetectionError(null);

    // Initialise checklist — all steps waiting
    setDetectionChecklist(
      DETECT_STEPS.map((s) => ({ ...s, status: 'waiting' as const }))
    );

    // Step 1: Validate
    updateDetectionStep('validate', 'running');
    await tick();

    if (!request.records || request.records.length === 0) {
      updateDetectionStep('validate', 'error');
      setDetectionError('No records to process.');
      return;
    }
    updateDetectionStep('validate', 'done');

    // Steps 2–6: mark as running during API call
    // (these all happen server-side in one atomic call)
    setDetectionLoading(true);
    setDetectionRequest(request);
    updateDetectionStep('pipeline', 'running');
    updateDetectionStep('rule',     'running');
    updateDetectionStep('zscore',   'running');
    updateDetectionStep('ml',       'running');
    updateDetectionStep('persist',  'running');

    // Step 7: DE scheduling — only shown if enabled
    if (!decisionEngineEnabled) {
      updateDetectionStep('explain', 'skipped');
    }

    try {
      const response = await postDetect(request);

      // Mark pipeline steps done
      updateDetectionStep('pipeline', 'done');
      updateDetectionStep('rule',     'done');
      updateDetectionStep('zscore',   'done');
      updateDetectionStep('ml',       'done');
      updateDetectionStep('persist',  'done');

      setDetectionResponse(response);

      // Step 7: decide based on whether any anomaly has an explanation pending
      const hasExplainPending = response.results.some(
        (r) => r.explanation_status === 'pending'
      );

      if (!decisionEngineEnabled) {
        updateDetectionStep('explain', 'skipped');
      } else if (hasExplainPending) {
        updateDetectionStep('explain', 'done');
      } else if (response.anomalies === 0) {
        updateDetectionStep('explain', 'skipped');
      } else {
        updateDetectionStep('explain', 'skipped');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Detection failed';
      updateDetectionStep('pipeline', 'error');
      updateDetectionStep('rule',     'error');
      updateDetectionStep('zscore',   'error');
      updateDetectionStep('ml',       'error');
      updateDetectionStep('persist',  'error');
      updateDetectionStep('explain',  'error');
      setDetectionError(msg);
    } finally {
      setDetectionLoading(false);
    }
  }, [
    resetDetection,
    setDetectionError,
    setDetectionChecklist,
    setDetectionLoading,
    setDetectionRequest,
    setDetectionResponse,
    updateDetectionStep,
    decisionEngineEnabled,
  ]);

  return { detect };
}

/** Tiny async tick to let React flush state before the next synchronous update. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 80));
}
