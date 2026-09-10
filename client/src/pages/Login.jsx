import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.display);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Log in</h1>
        <p className="muted">Track attempts, spot patterns, measure whether you are improving.</p>

        {error && <p className="alert">{error}</p>}

        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required
          value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />

        <button type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>

        <p className="muted small">
          No account? <Link to="/register">Register</Link>
        </p>
        <p className="muted small seed-hint">
          Seeded demo: <code>learner@example.com</code> / <code>password123</code>
        </p>
      </form>
    </div>
  );
}
