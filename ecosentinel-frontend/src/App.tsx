// ============================================================
// App.tsx
// Root application component with React Router v6 configuration.
// Routes: / → /detect, /detect, /explain, /ops
// ============================================================

import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';

import MainLayout      from '@/components/layout/MainLayout';
import DetectionPage   from '@/pages/DetectionPage';
import ExplanationPage from '@/pages/ExplanationPage';
import OpsPage         from '@/pages/OpsPage';

const router = createBrowserRouter([
  {
    path:    '/',
    element: <MainLayout />,
    children: [
      // Default redirect to detection
      {
        index:   true,
        element: <Navigate to="/detect" replace />,
      },
      {
        path:    'detect',
        element: <DetectionPage />,
      },
      {
        path:    'explain',
        element: <ExplanationPage />,
      },
      {
        path:    'ops',
        element: <OpsPage />,
      },
      // Catch-all — redirect to detection
      {
        path:    '*',
        element: <Navigate to="/detect" replace />,
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
