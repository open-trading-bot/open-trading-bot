// client/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Positions } from './pages/Positions';
import { Trades } from './pages/Trades';
import { Strategies } from './pages/Strategies';
import { Settings } from './pages/Settings';
import { Backtest } from './pages/Backtest';
import { Reports } from './pages/Reports';
import { Login } from './pages/Login';
import { AcceptInvite } from './pages/AcceptInvite';
import { AcceptDisclaimer } from './pages/AcceptDisclaimer';
import { NotFound } from './pages/NotFound';
import { Terms } from './pages/Terms';
import { Privacy } from './pages/Privacy';
import { TestnetHelp } from './pages/TestnetHelp';
import { useAuthStore } from 'common';

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
    </BrowserRouter>
  );
}

export default App;
