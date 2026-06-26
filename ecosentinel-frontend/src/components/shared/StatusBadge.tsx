// ============================================================
// components/shared/StatusBadge.tsx
// Semantic status badges used throughout the UI.
// ============================================================

import { AlertTriangle, CheckCircle2, Clock, XCircle, MinusCircle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Anomaly detection result badge ───────────────────────────

interface AnomalyBadgeProps {
  isAnomaly: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function AnomalyBadge({ isAnomaly, size = 'md', className }: AnomalyBadgeProps) {
  const sizeClasses = {
    sm:  'text-2xs px-1.5 py-0.5 gap-1',
    md:  'text-xs  px-2   py-1   gap-1.5',
    lg:  'text-sm  px-3   py-1.5 gap-2 font-semibold',
  }[size];

  const iconSize = size === 'lg' ? 14 : 11;

  if (isAnomaly) {
    return (
      <span className={cn(
        'inline-flex items-center font-mono font-semibold rounded-sm border',
        'bg-red-50 text-anomaly border-anomaly/50',
        sizeClasses, className,
      )}>
        <AlertTriangle size={iconSize} />
        ANOMALY
      </span>
    );
  }

  return (
    <span className={cn(
      'inline-flex items-center font-mono font-semibold rounded-sm border',
      'bg-green-50 text-normal border-normal/40',
      sizeClasses, className,
    )}>
      <CheckCircle2 size={iconSize} />
      NORMAL
    </span>
  );
}

// ── Explanation status badge ──────────────────────────────────

type ExplanationStatus = 'pending' | 'completed' | 'failed' | null;

interface ExplanationStatusBadgeProps {
  status: ExplanationStatus;
  size?: 'sm' | 'md';
  className?: string;
}

export function ExplanationStatusBadge({ status, size = 'sm', className }: ExplanationStatusBadgeProps) {
  const sizeClasses = size === 'sm'
    ? 'text-2xs px-1.5 py-0.5 gap-1'
    : 'text-xs px-2 py-1 gap-1.5';

  const iconSize = 10;

  switch (status) {
    case 'pending':
      return (
        <span className={cn(
          'inline-flex items-center font-mono rounded-sm border animate-pulse-slow',
          'bg-amber-50 text-warning border-warning/40',
          sizeClasses, className,
        )}>
          <Clock size={iconSize} />
          PENDING
        </span>
      );
    case 'completed':
      return (
        <span className={cn(
          'inline-flex items-center font-mono rounded-sm border',
          'bg-green-50 text-normal border-normal/40',
          sizeClasses, className,
        )}>
          <CheckCircle2 size={iconSize} />
          EXPLAINED
        </span>
      );
    case 'failed':
      return (
        <span className={cn(
          'inline-flex items-center font-mono rounded-sm border',
          'bg-red-50 text-anomaly border-anomaly/40',
          sizeClasses, className,
        )}>
          <XCircle size={iconSize} />
          FAILED
        </span>
      );
    case null:
    default:
      return (
        <span className={cn(
          'inline-flex items-center font-mono rounded-sm border',
          'bg-surface-raised text-text-muted border-surface-border',
          sizeClasses, className,
        )}>
          <MinusCircle size={iconSize} />
          NO EXPLANATION
        </span>
      );
  }
}

// ── Health / service status dot ───────────────────────────────

type ServiceStatus = 'ok' | 'degraded' | 'offline';

interface HealthDotProps {
  status: ServiceStatus;
  label?: string;
  className?: string;
}

export function HealthDot({ status, label, className }: HealthDotProps) {
  const dotColor = {
    ok:       'bg-normal',
    degraded: 'bg-warning animate-pulse',
    offline:  'bg-anomaly animate-pulse',
  }[status];

  const textColor = {
    ok:       'text-normal',
    degraded: 'text-warning',
    offline:  'text-anomaly',
  }[status];

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor)} />
      {label && (
        <span className={cn('text-2xs font-mono', textColor)}>{label}</span>
      )}
    </span>
  );
}

// ── Confidence pill ───────────────────────────────────────────

type Confidence = 'High' | 'Medium' | 'Low';

interface ConfidencePillProps {
  confidence: Confidence;
  className?: string;
}

export function ConfidencePill({ confidence, className }: ConfidencePillProps) {
  const styles: Record<Confidence, string> = {
    High:   'bg-green-50 text-normal border-normal/40',
    Medium: 'bg-amber-50 text-warning border-warning/40',
    Low:    'bg-red-50 text-anomaly border-anomaly/40',
  };

  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-mono font-semibold rounded-sm border',
      styles[confidence],
      className,
    )}>
      <Zap size={9} />
      {confidence.toUpperCase()} CONFIDENCE
    </span>
  );
}

// ── Layer status pill ─────────────────────────────────────────

interface LayerPillProps {
  label: string;
  fired: boolean;
  className?: string;
}

export function LayerPill({ label, fired, className }: LayerPillProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-mono rounded-sm border',
      fired
        ? 'bg-red-50 text-anomaly border-anomaly/40'
        : 'bg-green-50 text-normal border-normal/30',
      className,
    )}>
      {fired
        ? <AlertTriangle size={9} />
        : <CheckCircle2 size={9} />
      }
      {label}
    </span>
  );
}

// ── Anomaly ID badge ──────────────────────────────────────────

import { Copy, ArrowRight } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';

interface AnomalyIdBadgeProps {
  anomalyId: number;
  showNavigate?: boolean;
  className?: string;
}

export function AnomalyIdBadge({ anomalyId, showNavigate = true, className }: AnomalyIdBadgeProps) {
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const setExplanationInputId = useAppStore((s) => s.setExplanationInputId);

  const handleCopy = async () => {
    await copyToClipboard(String(anomalyId));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleNavigate = () => {
    setExplanationInputId(String(anomalyId));
    navigate('/explain');
  };

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border text-2xs font-mono',
      'bg-brand-faint border-brand/40 text-brand-dark',
      className,
    )}>
      <span className="text-text-muted">ANOMALY ID</span>
      <span className="font-semibold text-brand-dark">#{anomalyId}</span>
      <button
        onClick={handleCopy}
        title="Copy anomaly ID"
        className="text-text-muted hover:text-brand-dark transition-colors"
      >
        <Copy size={9} />
      </button>
      {copied && <span className="text-normal">copied</span>}
      {showNavigate && (
        <button
          onClick={handleNavigate}
          title="Go to Decision Engine"
          className="flex items-center gap-0.5 text-text-muted hover:text-brand-dark transition-colors"
        >
          <ArrowRight size={9} />
          explain
        </button>
      )}
    </span>
  );
}
