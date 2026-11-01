// client/src/App.tsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { AcceptDisclaimer } from './pages/AcceptDisclaimer';
import { NotFound } from './pages/NotFound';
import { useAuthStore } from 'common';
import { PageFallback } from './components/PageFallback';

// Pages other than the login and dashboard load on first visit. Backtest
// alone pulls in the chart library.
const Positions = lazy(() => import('./pages/Positions').then((m) => ({ default: m.Positions })));
const Trades = lazy(() => import('./pages/Trades').then((m) => ({ default: m.Trades })));
const Strategies = lazy(() => import('./pages/Strategies').then((m) => ({ default: m.Strategies })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Backtest = lazy(() => import('./pages/Backtest').then((m) => ({ default: m.Backtest })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite').then((m) => ({ default: m.AcceptInvite })));
const Terms = lazy(() => import('./pages/Terms').then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.Privacy })));
const TestnetHelp = lazy(() => import('./pages/TestnetHelp').then((m) => ({ default: m.TestnetHelp })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, disclaimerAccepted } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (!disclaimerAccepted) return <Navigate to="/accept-disclaimer" replace />;
  return <>{children}</>;
}

function DisclaimerRoute() {
  const { token, disclaimerAccepted } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  if (disclaimerAccepted) return <Navigate to="/" replace />;
  return <AcceptDisclaimer />;
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/accept-disclaimer" element={<DisclaimerRoute />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/positions" element={<Positions />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/strategies" element={<Strategies />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/help/testnet" element={<Navigate to="/help/testnet/bybit" replace />} />
          <Route path="/help/testnet/:exchange" element={<TestnetHelp />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
