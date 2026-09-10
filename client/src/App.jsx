import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import Placeholder from './components/Placeholder.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Settings from './pages/Settings.jsx';

/**
 * Route guard. This is convenience, not security -- it only decides what to
 * render. The actual authorization lives in the API's data layer, where every
 * query on user-owned data is scoped by user_id (see server/src/repos/).
 */
function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="boot">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function RequireAdmin({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="boot">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function RedirectIfLoggedIn({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="boot">Loading…</div>;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<RedirectIfLoggedIn><Login /></RedirectIfLoggedIn>} />
        <Route path="/register" element={<RedirectIfLoggedIn><Register /></RedirectIfLoggedIn>} />

        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="problems"  element={<Placeholder title="Problems"  phase={2} />} />
          <Route path="attempts"  element={<Placeholder title="Attempts"  phase={3} />} />
          <Route path="plans"     element={<Placeholder title="Plans"     phase={4} />} />
          <Route path="analytics" element={<Placeholder title="Analytics" phase={6} />} />
          <Route path="settings"  element={<Settings />} />
          <Route path="admin" element={<RequireAdmin><Placeholder title="Admin catalog" phase={7} /></RequireAdmin>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
