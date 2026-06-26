// ============================================================
// components/layout/MainLayout.tsx
// Root layout: sidebar + topbar + content area via <Outlet />.
// ============================================================

import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar  from './TopBar';

export default function MainLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-bg text-text-primary font-sans">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar />

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
