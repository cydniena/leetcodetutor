import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

// Nav mirrors the phase plan. `phase` marks what is not built yet, so the app
// never pretends to have a page it does not have.
const NAV = [
  { to: '/',          label: 'Dashboard' },
  { to: '/problems',  label: 'Problems',  phase: 2 },
  { to: '/attempts',  label: 'Attempts',  phase: 3 },
  { to: '/plans',     label: 'Plans',     phase: 4 },
  { to: '/analytics', label: 'Analytics', phase: 6 },
];

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">LeetCode&nbsp;Tutor</div>
        <nav>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
              {item.phase && <span className="badge" title={`Arrives in phase ${item.phase}`}>{item.phase}</span>}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink to="/admin">
              Admin<span className="badge" title="Arrives in phase 7">7</span>
            </NavLink>
          )}
        </nav>
        <div className="who">
          <NavLink to="/settings" className="small">{user?.email}</NavLink>
          <button type="button" className="ghost" onClick={onLogout}>Log out</button>
        </div>
      </header>
      <main><Outlet /></main>
    </div>
  );
}
