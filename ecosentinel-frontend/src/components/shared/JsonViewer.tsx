// ============================================================
// components/shared/JsonViewer.tsx
// Syntax-highlighted JSON display for technical view.
// Uses react-json-view-lite with custom light-theme styles.
// ============================================================

import { JsonView, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

interface JsonViewerProps {
  data: unknown;
  label?: string;
  /** Initial depth to expand. Default: 2 */
  expandDepth?: number;
  className?: string;
}

// Custom style overrides — light theme, brand green palette
const JSON_STYLES = {
  ...defaultStyles,
  container:         'bg-transparent font-mono text-xs leading-5',
  basicChildStyle:   'ml-4',
  label:             'text-text-secondary mr-1',
  nullValue:         'text-text-muted',
  undefinedValue:    'text-text-muted',
  numberValue:       'text-[#006E35]',   // text.code — dark green
  stringValue:       'text-[#007A3C]',   // brand.dark
  booleanValue:      'text-brand',
  otherValue:        'text-text-primary',
  punctuation:       'text-text-muted',
  collapseIcon:      'text-brand cursor-pointer hover:text-brand-dark mr-1',
  expandIcon:        'text-brand cursor-pointer hover:text-brand-dark mr-1',
  collapsedContent:  'text-text-muted',
  noQuotesForStringValues: false,
};

export default function JsonViewer({ data, label, expandDepth = 2, className = '' }: JsonViewerProps) {
  return (
    <div className={`bg-surface-raised border border-surface-border rounded-sm ${className}`}>
      {label && (
        <div className="px-3 py-1.5 border-b border-surface-border bg-surface-card">
          <span className="text-2xs font-mono text-text-muted uppercase tracking-widest">{label}</span>
        </div>
      )}
      <div className="p-3 overflow-x-auto">
        <JsonView
          data={data as object}
          shouldExpandNode={shouldExpand(expandDepth)}
          style={JSON_STYLES}
        />
      </div>
    </div>
  );
}

function shouldExpand(depth: number) {
  return (level: number) => level < depth;
}

// Raw pre-formatted block for string content
export function RawCodeBlock({ content, label }: { content: string; label?: string }) {
  return (
    <div className="bg-surface-raised border border-surface-border rounded-sm">
      {label && (
        <div className="px-3 py-1.5 border-b border-surface-border bg-surface-card">
          <span className="text-2xs font-mono text-text-muted uppercase tracking-widest">{label}</span>
        </div>
      )}
      <pre className="p-3 text-xs font-mono text-text-code overflow-x-auto whitespace-pre-wrap break-all">
        {content}
      </pre>
    </div>
  );
}
