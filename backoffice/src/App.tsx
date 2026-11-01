import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { useAuthStore } from 'common';

// Pages other than the login and dashboard load on first visit.
const Leads = lazy(() => import('./pages/Leads').then((m) => ({ default: m.Leads })));
const Users = lazy(() => import('./pages/Users').then((m) => ({ default: m.Users })));
const UserDetail = lazy(() => import('./pages/UserDetail').then((m) => ({ default: m.UserDetail })));
const FeatureFlags = lazy(() => import('./pages/FeatureFlags').then((m) => ({ default: m.FeatureFlags })));
const Invitations = lazy(() => import('./pages/Invitations').then((m) => ({ default: m.Invitations })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/users" element={<Users />} />
          <Route path="/users/:id" element={<UserDetail />} />
          <Route path="/feature-flags" element={<FeatureFlags />} />
          <Route path="/invitations" element={<Invitations />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
