// ============================================================
// components/layout/Sidebar.tsx
// Left navigation sidebar with section links.
// ============================================================

import { NavLink } from 'react-router-dom';
import { Zap, Brain, Settings, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/appStore';
import { getApiBaseUrl } from '@/api/api';

const NAV_ITEMS = [
  {
    to:    '/detect',
    label: 'Detection',
    sub:   'Anomaly Engine',
    icon:  Zap,
  },
  {
    to:    '/explain',
    label: 'Decision Engine',
    sub:   'AI Explanation',
    icon:  Brain,
  },
  {
    to:    '/ops',
    label: 'Ops',
    sub:   'Health & Models',
    icon:  Settings,
  },
];

export default function Sidebar() {
  const sessionAnomalyIds = useAppStore((s) => s.detection.sessionAnomalyIds);
  const apiBase           = getApiBaseUrl();

  return (
    <aside className="
      w-[200px] shrink-0 flex flex-col
      bg-surface-card border-r border-surface-border
      h-screen sticky top-0 overflow-hidden
    ">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-surface-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-sm bg-brand flex items-center justify-center shrink-0">
            <Zap size={14} className="text-text-inverse" fill="currentColor" />
          </div>
          <div>
            <div className="text-sm font-semibold text-text-primary tracking-tight leading-none">
              EcoSentinel
            </div>
            <div className="text-2xs text-text-muted mt-0.5">Anomaly Detection</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ to, label, sub, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn(
              'group flex items-center gap-2.5 px-2.5 py-2 rounded-sm text-sm transition-colors duration-100',
              isActive
                ? 'bg-brand-faint border border-brand/40 text-brand-dark'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-transparent',
            )}
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={14}
                  className={cn(
                    'shrink-0 transition-colors',
                    isActive ? 'text-brand' : 'text-text-muted group-hover:text-text-secondary',
                  )}
                />
                <div className="min-w-0">
                  <div className="font-medium leading-none text-xs">{label}</div>
                  <div className="text-2xs text-text-muted mt-0.5 leading-none">{sub}</div>
                </div>
                {/* Active indicator */}
                {isActive && (
                  <div className="ml-auto w-1 h-1 rounded-full bg-brand" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Session Anomaly IDs quick reference */}
      {sessionAnomalyIds.length > 0 && (
        <div className="px-3 py-2 border-t border-surface-border">
          <div className="text-2xs text-text-muted mb-1.5 uppercase tracking-widest font-mono">
            Session IDs
          </div>
          <div className="flex flex-wrap gap-1">
            {sessionAnomalyIds.slice(-6).map((id) => (
              <NavLink
                key={id}
                to="/explain"
                className="text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-brand-faint text-brand-dark border border-brand/20 hover:border-brand/50 transition-colors"
                onClick={() => {
                  useAppStore.getState().setExplanationInputId(String(id));
                }}
              >
                #{id}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* API info footer */}
      <div className="px-3 py-3 border-t border-surface-border">
        <div className="flex items-center gap-1.5 mb-1">
          <Activity size={9} className="text-text-muted" />
          <span className="text-2xs font-mono text-text-muted">API Endpoint</span>
        </div>
        <div className="text-2xs font-mono text-text-muted truncate" title={apiBase}>
          {apiBase.replace('http://', '').replace('https://', '')}
        </div>
      </div>
    </aside>
  );
}
