// ============================================================
// hooks/useExplanation.ts
// Fetches GET /anomalies/{id}/explanation.
// Polls when explanation_status === 'pending' until completed,
// failed, or timeout is reached.
// ============================================================

import { useCallback, useRef } from 'react';
import { getExplanation } from '@/api/api';
import { useAppStore } from '@/store/appStore';
import { POLLING_CONFIG } from '@/constants/config';

const STEPS = [
  { id: 'lookup',  label: 'Looking up anomaly record' },
  { id: 'status',  label: 'Reading explanation status' },
  { id: 'waiting', label: 'Waiting for AI analysis' },
  { id: 'ready',   label: 'Explanation ready' },
];

export function useExplanation() {
  const {
    explanation,
    setExplanationLoading,
    setExplanationPolling,
    setExplanationResponse,
    setExplanationError,
    setExplanationChecklist,
    updateExplanationStep,
    tickPollElapsed,
    setExplanationTimedOut,
    resetExplanation,
  } = useAppStore();

  // Ref to allow cancellation of in-flight polling
  const abortRef = useRef(false);

  const fetchExplanation = useCallback(async (anomalyId: number) => {
    abortRef.current = false;
    resetExplanation();
    setExplanationError(null);
    setExplanationTimedOut(false);

    setExplanationChecklist(
      STEPS.map((s) => ({ ...s, status: 'waiting' as const }))
    );

    setExplanationLoading(true);
    updateExplanationStep('lookup', 'running');

    let attempt = 0;
    const startMs = Date.now();

    try {
      // Initial fetch
      const initial = await getExplanation(anomalyId);
      updateExplanationStep('lookup', 'done');
      updateExplanationStep('status', 'done');

      setExplanationResponse(initial);

      // If already terminal — done
      if (initial.explanation_status === 'completed') {
        updateExplanationStep('waiting', 'skipped');
        updateExplanationStep('ready',   'done');
        return;
      }

      if (initial.explanation_status === 'failed') {
        updateExplanationStep('waiting', 'error');
        updateExplanationStep('ready',   'error');
        setExplanationError(initial.explanation_error ?? 'Explanation generation failed.');
        return;
      }

      if (initial.explanation_status === null) {
        // Decision engine was disabled — no polling needed
        updateExplanationStep('waiting', 'skipped');
        updateExplanationStep('ready',   'skipped');
        return;
      }

      // Status is 'pending' — begin polling
      updateExplanationStep('waiting', 'running');
      setExplanationPolling(true);

      while (attempt < POLLING_CONFIG.maxAttempts && !abortRef.current) {
        await sleep(POLLING_CONFIG.intervalMs);
        tickPollElapsed(POLLING_CONFIG.intervalMs);
        attempt++;

        if (abortRef.current) break;

        const polled = await getExplanation(anomalyId);
        setExplanationResponse(polled);

        if (polled.explanation_status === 'completed') {
          updateExplanationStep('waiting', 'done');
          updateExplanationStep('ready',   'done');
          setExplanationPolling(false);
          return;
        }

        if (polled.explanation_status === 'failed') {
          updateExplanationStep('waiting', 'error');
          updateExplanationStep('ready',   'error');
          setExplanationError(polled.explanation_error ?? 'Explanation generation failed.');
          setExplanationPolling(false);
          return;
        }
      }

      // Timeout reached
      if (!abortRef.current) {
        const elapsedSec = Math.round((Date.now() - startMs) / 1000);
        updateExplanationStep('waiting', 'error');
        updateExplanationStep('ready',   'error');
        setExplanationTimedOut(true);
        setExplanationError(
          `Explanation generation is still running after ${elapsedSec}s. ` +
          `You may refresh later using anomaly ID ${anomalyId}.`
        );
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch explanation';
      updateExplanationStep('lookup',  'error');
      updateExplanationStep('status',  'error');
      updateExplanationStep('waiting', 'error');
      updateExplanationStep('ready',   'error');
      setExplanationError(msg);
    } finally {
      setExplanationLoading(false);
      setExplanationPolling(false);
    }
  }, [
    resetExplanation,
    setExplanationLoading,
    setExplanationPolling,
    setExplanationResponse,
    setExplanationError,
    setExplanationChecklist,
    updateExplanationStep,
    tickPollElapsed,
    setExplanationTimedOut,
  ]);

  /** Cancel any in-flight polling. */
  const cancelPolling = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    fetchExplanation,
    cancelPolling,
    isPolling: explanation.isPolling,
    pollElapsedMs: explanation.pollElapsedMs,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
