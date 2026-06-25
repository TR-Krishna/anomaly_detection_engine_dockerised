// ============================================================
// lib/utils.ts
// Pure utility functions. No React, no side effects.
// ============================================================

import type { MeterFormState, DetectRequest } from '@/types';
import {
  FEATURE_OBIS_MAP,
  FEATURE_UNITS,
  DEFAULT_OBIS_PROFILE,
  CAPABILITY_GROUPS,
} from '@/constants/config';

// ── Timestamp formatting ──────────────────────────────────────

/** Formats an ISO 8601 timestamp into a compact human-readable form. */
export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day:    '2-digit',
      month:  'short',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

/** Returns relative time string like "2 minutes ago" */
export function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60)  return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)  return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)    return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return '';
  }
}

/** Returns current datetime in datetime-local input format (YYYY-MM-DDTHH:MM) */
export function nowForDatetimeInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

// ── Score normalisation ───────────────────────────────────────

/**
 * Normalises an Isolation Forest anomaly score to 0–1 for the
 * severity bar. IF scores are typically in the range –0.6 to +0.4.
 * More negative = more anomalous → higher severity.
 */
export function normaliseIFScore(score: number | null): number | null {
  if (score === null) return null;
  // Map [0.4, -0.6] → [0, 1] (higher = more anomalous)
  const clamped = Math.max(-0.6, Math.min(0.4, score));
  return (0.4 - clamped) / 1.0;
}

/** Returns a human label for an IF anomaly score. */
export function ifScoreLabel(score: number | null): string | null {
  if (score === null) return null;
  const norm = normaliseIFScore(score)!;
  const level = norm > 0.75 ? 'Critical' : norm > 0.5 ? 'High' : norm > 0.25 ? 'Medium' : 'Low';
  return `${level} anomaly score (${score.toFixed(3)})`;
}

/** Formats a spike_ratio into human language. */
export function spikeRatioLabel(spikeRatio: number | null): string | null {
  if (spikeRatio === null) return null;
  return `${spikeRatio.toFixed(1)}× statistical average`;
}

// ── Random ID generation ──────────────────────────────────────

/** Generates a random 6-digit integer for use as a record ID. */
export function randomRecordId(): number {
  return Math.floor(100000 + Math.random() * 900000);
}

// ── Payload builder — form state → DetectRequest ─────────────

/**
 * Builds a DetectRequest from the non-technical form state.
 * Constructs the pipe-delimited rawValue string expected by the
 * backend OBIS parser from the form field values.
 */
export function buildDetectRequestFromForm(form: MeterFormState): DetectRequest {
  const group = CAPABILITY_GROUPS[form.selectedGroup];
  if (!group) throw new Error(`Unknown capability group: ${form.selectedGroup}`);

  const recordId  = parseInt(form.advanced.id)      || randomRecordId();
  const entryId   = parseInt(form.advanced.entryId)  || 1;
  const obisCode  = form.advanced.obisCode           || DEFAULT_OBIS_PROFILE;
  const timestamp = form.advanced.timestamp
    ? new Date(form.advanced.timestamp).toISOString()
    : new Date().toISOString();

  // The interval timestamp inside rawValue matches the API receive timestamp
  const intervalTs = form.advanced.timestamp
    ? new Date(form.advanced.timestamp).toISOString().replace('T', ' ').slice(0, 19)
    : new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Build pipe-delimited rawValue:
  // Entry 1 is always the clock object (0.0.1.0.0.255) with timestamp
  // Subsequent entries are the feature OBIS codes with values
  const parts: string[] = [
    `1,0.0.1.0.0.255,2,${intervalTs},`,
  ];

  group.features.forEach((feature, idx) => {
    const obis  = FEATURE_OBIS_MAP[feature];
    const unit  = FEATURE_UNITS[feature] ?? '';
    const value = form.fieldValues[feature] ?? '0';
    parts.push(`${idx + 2},${obis},2,${value},${unit}`);
  });

  const rawValue = parts.join('|');

  return {
    records: [{
      id:          recordId,
      meterSerial: form.meterSerial,
      timestamp,
      obisCode,
      entryId,
      rawValue,
    }],
  };
}

/** Parses a raw JSON string into a DetectRequest with validation. */
export function parseDetectRequestJSON(raw: string): { ok: true; data: DetectRequest } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'JSON must be an object with a "records" array.' };
    }
    if (!Array.isArray(parsed.records) || parsed.records.length === 0) {
      return { ok: false, error: '"records" must be a non-empty array.' };
    }
    return { ok: true, data: parsed as DetectRequest };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
}

// ── Class name utility ────────────────────────────────────────

/** Merges class names, filtering falsy values. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ── Truncation ────────────────────────────────────────────────

/** Truncates a string to maxLen characters with ellipsis. */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/** Formats a number to N decimal places, returning '—' for null. */
export function fmtNum(val: number | null | undefined, decimals = 3): string {
  if (val === null || val === undefined) return '—';
  return val.toFixed(decimals);
}

// ── Copy to clipboard ─────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
