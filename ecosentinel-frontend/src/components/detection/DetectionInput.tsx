// ============================================================
// components/detection/DetectionInput.tsx
// Input panel for POST /detect.
// Tab 1 (Technical):  Raw JSON textarea
// Tab 2 (Non-Tech):   Group selector + dynamic meter form
// ============================================================

import { useState, useId } from 'react';
import { Send, ChevronDown, ChevronRight, RotateCcw, Code2, User } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useDetect } from '@/hooks/useDetect';
import ProcessChecklist from '@/components/shared/ProcessChecklist';
import {
  CAPABILITY_GROUPS,
  OBIS_HUMAN_LABELS,
} from '@/constants/config';
import {
  buildDetectRequestFromForm,
  parseDetectRequestJSON,
  nowForDatetimeInput,
  randomRecordId,
  cn,
} from '@/lib/utils';

const EXAMPLE_PAYLOAD = JSON.stringify({
  records: [{
    id:          449618,
    meterSerial: 'E0000002',
    timestamp:   '2025-11-12T04:38:09.523241+00:00',
    obisCode:    '1.0.99.1.0.255',
    entryId:     5,
    rawValue:
      '1,0.0.1.0.0.255,2,2025-11-12 10:00:00,' +
      '|2,1.0.12.27.0.255,2,225.91,V' +
      '|3,1.0.1.29.0.255,2,1.6,Wh' +
      '|4,1.0.11.27.0.255,2,1.4,A' +
      '|5,1.0.13.27.0.255,2,0.92,',
  }],
}, null, 2);

type InputTab = 'technical' | 'non-technical';

export default function DetectionInput() {
  const [activeTab, setActiveTab] = useState<InputTab>('technical');

  return (
    <div className="flex flex-col h-full bg-surface-card border border-surface-border rounded-sm overflow-hidden">
      {/* Tab header */}
      <div className="flex items-center border-b border-surface-border bg-surface-raised shrink-0">
        <TabButton
          active={activeTab === 'technical'}
          onClick={() => setActiveTab('technical')}
          icon={<Code2 size={11} />}
          label="Technical"
        />
        <TabButton
          active={activeTab === 'non-technical'}
          onClick={() => setActiveTab('non-technical')}
          icon={<User size={11} />}
          label="Non-Technical"
        />
      </div>

      {activeTab === 'technical'     && <TechnicalInput />}
      {activeTab === 'non-technical' && <NonTechnicalInput />}
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────

function TabButton({
  active, onClick, icon, label,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
        active
          ? 'border-brand text-brand-dark bg-brand-faint'
          : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Technical input ───────────────────────────────────────────

function TechnicalInput() {
  const [json, setJson]       = useState(EXAMPLE_PAYLOAD);
  const [jsonError, setError] = useState<string | null>(null);

  const { detect } = useDetect();
  const { detection } = useAppStore();

  const validate = (val: string) => {
    const result = parseDetectRequestJSON(val);
    setError(result.ok ? null : result.error);
    return result;
  };

  const handleSubmit = () => {
    const result = validate(json);
    if (result.ok) detect(result.data);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 p-3 gap-3">
      <div className="text-2xs text-text-muted font-mono">
        Paste or edit a{' '}
        <code className="text-text-code">DetectRequest</code>{' '}
        JSON payload
      </div>

      <textarea
        value={json}
        onChange={(e) => { setJson(e.target.value); validate(e.target.value); }}
        spellCheck={false}
        className={cn(
          'flex-1 min-h-0 resize-none font-mono text-xs rounded-sm p-2.5',
          'bg-surface-bg border text-text-primary',
          'focus:outline-none focus:ring-1 focus:ring-brand/50',
          jsonError ? 'border-anomaly/60' : 'border-surface-border',
        )}
      />

      {jsonError && (
        <div className="text-2xs text-anomaly font-mono bg-red-50 border border-anomaly/30 rounded-sm px-2.5 py-1.5">
          {jsonError}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!!jsonError || detection.isLoading}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold transition-colors',
            'bg-brand text-text-inverse hover:bg-brand-light disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Send size={11} />
          {detection.isLoading ? 'Detecting…' : 'Run Detection'}
        </button>
        <button
          onClick={() => { setJson(EXAMPLE_PAYLOAD); setError(null); }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <RotateCcw size={10} />
          Reset
        </button>
      </div>

      {/* Checklist */}
      {detection.checklistSteps.length > 0 && (
        <div className="border-t border-surface-border pt-3">
          <div className="text-2xs text-text-muted font-mono mb-2 uppercase tracking-widest">
            Processing
          </div>
          <ProcessChecklist steps={detection.checklistSteps} compact />
        </div>
      )}

      {detection.error && (
        <div className="text-xs text-anomaly font-mono bg-red-50 border border-anomaly/30 rounded-sm px-2.5 py-2">
          {detection.error}
        </div>
      )}
    </div>
  );
}

// ── Non-technical input ───────────────────────────────────────

function NonTechnicalInput() {
  const {
    meterForm,
    setMeterFormField,
    setMeterFormGroup,
    setMeterFormFeature,
    setMeterFormAdvanced,
    detection,
  } = useAppStore();

  const { detect } = useDetect();
  const [formError, setFormError]       = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const inputId = useId();

  const selectedGroup = CAPABILITY_GROUPS[meterForm.selectedGroup];

  const handleGroupSelect = (groupKey: string) => {
    const group = CAPABILITY_GROUPS[groupKey];
    if (group) setMeterFormGroup(groupKey, group.features);
  };

  const handleSubmit = () => {
    setFormError(null);
    if (!meterForm.meterSerial.trim()) {
      setFormError('Meter serial number is required.');
      return;
    }
    try {
      const payload = buildDetectRequestFromForm(meterForm);
      detect(payload);
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-3 gap-4">

      {/* Meter serial — always visible */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${inputId}-serial`} className="text-2xs font-mono text-text-secondary uppercase tracking-widest">
          Meter Serial <span className="text-anomaly">*</span>
        </label>
        <input
          id={`${inputId}-serial`}
          type="text"
          value={meterForm.meterSerial}
          onChange={(e) => setMeterFormField('meterSerial', e.target.value)}
          placeholder="e.g. E0000002"
          className={cn(
            'px-2.5 py-1.5 rounded-sm border bg-surface-raised text-sm font-mono text-text-primary',
            'focus:outline-none focus:ring-1 focus:ring-brand/50',
            'border-surface-border placeholder:text-text-muted',
          )}
        />
      </div>

      {/* Capability group selector */}
      <div className="flex flex-col gap-1.5">
        <div className="text-2xs font-mono text-text-secondary uppercase tracking-widest">
          Meter Profile / Capability Group
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(CAPABILITY_GROUPS).map(([key, group]) => (
            <GroupCard
              key={key}
              groupKey={key}
              group={group}
              selected={meterForm.selectedGroup === key}
              onSelect={handleGroupSelect}
            />
          ))}
        </div>
      </div>

      {/* Dynamic feature fields */}
      {selectedGroup && (
        <div className="flex flex-col gap-1.5">
          <div className="text-2xs font-mono text-text-secondary uppercase tracking-widest">
            Meter Readings — {selectedGroup.label}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {selectedGroup.features.map((feature) => {
              const meta = OBIS_HUMAN_LABELS[feature];
              if (!meta) return null;
              return (
                <div key={feature} className="flex flex-col gap-1">
                  <label className="text-2xs text-text-secondary font-mono flex items-center gap-1">
                    {meta.label}
                    {meta.unit && (
                      <span className="text-text-muted">({meta.unit})</span>
                    )}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={meterForm.fieldValues[feature] ?? ''}
                    onChange={(e) => setMeterFormFeature(feature, e.target.value)}
                    placeholder={meta.placeholder}
                    className={cn(
                      'px-2.5 py-1.5 rounded-sm border bg-surface-raised font-mono text-xs text-text-primary',
                      'focus:outline-none focus:ring-1 focus:ring-brand/50',
                      'border-surface-border placeholder:text-text-muted',
                    )}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Advanced settings — collapsible */}
      <div className="border border-surface-border rounded-sm overflow-hidden">
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="w-full flex items-center justify-between px-3 py-2 bg-surface-raised text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <span className="font-mono">Advanced Settings</span>
          {advancedOpen
            ? <ChevronDown size={12} />
            : <ChevronRight size={12} />
          }
        </button>

        {advancedOpen && (
          <div className="p-3 grid grid-cols-2 gap-2 bg-surface-raised">
            <AdvField
              label="Record ID"
              hint="Auto-generated if empty"
              value={meterForm.advanced.id}
              onChange={(v) => setMeterFormAdvanced('id', v)}
              placeholder={String(randomRecordId())}
              type="number"
            />
            <AdvField
              label="Entry ID"
              value={meterForm.advanced.entryId}
              onChange={(v) => setMeterFormAdvanced('entryId', v)}
              placeholder="1"
              type="number"
            />
            <AdvField
              label="OBIS Profile Code"
              value={meterForm.advanced.obisCode}
              onChange={(v) => setMeterFormAdvanced('obisCode', v)}
              placeholder="1.0.99.1.0.255"
              className="col-span-2"
            />
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-2xs text-text-secondary font-mono">
                Timestamp <span className="text-text-muted">(defaults to now)</span>
              </label>
              <input
                type="datetime-local"
                value={meterForm.advanced.timestamp || nowForDatetimeInput()}
                onChange={(e) => setMeterFormAdvanced('timestamp', e.target.value)}
                className={cn(
                  'px-2.5 py-1.5 rounded-sm border bg-surface-raised font-mono text-xs text-text-primary',
                  'focus:outline-none focus:ring-1 focus:ring-brand/50 border-surface-border',
                )}
              />
            </div>
          </div>
        )}
      </div>

      {formError && (
        <div className="text-xs text-anomaly font-mono bg-red-50 border border-anomaly/30 rounded-sm px-2.5 py-2">
          {formError}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={detection.isLoading}
        className={cn(
          'flex items-center justify-center gap-1.5 py-2 rounded-sm text-sm font-semibold transition-colors',
          'bg-brand text-text-inverse hover:bg-brand-light disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <Send size={12} />
        {detection.isLoading ? 'Detecting…' : 'Run Detection'}
      </button>

      {/* Checklist */}
      {detection.checklistSteps.length > 0 && (
        <div className="border-t border-surface-border pt-3">
          <div className="text-2xs text-text-muted font-mono mb-2 uppercase tracking-widest">
            Processing
          </div>
          <ProcessChecklist steps={detection.checklistSteps} compact />
        </div>
      )}

      {detection.error && (
        <div className="text-xs text-anomaly font-mono bg-red-50 border border-anomaly/30 rounded-sm px-2.5 py-2">
          {detection.error}
        </div>
      )}
    </div>
  );
}

// ── Group card ────────────────────────────────────────────────

function GroupCard({
  groupKey, group, selected, onSelect,
}: {
  groupKey: string;
  group: { label: string; description: string; features: string[] };
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(groupKey)}
      className={cn(
        'flex flex-col items-start p-2 rounded-sm border text-left transition-all duration-100',
        selected
          ? 'border-brand/60 bg-brand-faint text-text-primary'
          : 'border-surface-border bg-surface-raised text-text-secondary hover:border-brand/40 hover:text-text-primary hover:bg-surface-hover',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {selected && <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" />}
        <span className="text-xs font-semibold font-mono">{group.label}</span>
      </div>
      <div className="text-2xs text-text-muted leading-tight">{group.description}</div>
      <div className="flex flex-wrap gap-0.5 mt-1.5">
        {group.features.slice(0, 3).map((f) => (
          <span key={f} className="text-2xs font-mono px-1 py-0.5 rounded-sm bg-surface-border/60 text-text-muted">
            {(OBIS_HUMAN_LABELS[f]?.label ?? f).split(' ')[0]}
          </span>
        ))}
        {group.features.length > 3 && (
          <span className="text-2xs font-mono px-1 py-0.5 rounded-sm bg-surface-border/60 text-text-muted">
            +{group.features.length - 3}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Advanced field ────────────────────────────────────────────

function AdvField({
  label, hint, value, onChange, placeholder, type = 'text', className = '',
}: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-2xs text-text-secondary font-mono">
        {label}
        {hint && <span className="text-text-muted ml-1">({hint})</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'px-2.5 py-1.5 rounded-sm border bg-surface-bg font-mono text-xs text-text-primary',
          'focus:outline-none focus:ring-1 focus:ring-brand/50 border-surface-border',
          'placeholder:text-text-muted',
        )}
      />
    </div>
  );
}
