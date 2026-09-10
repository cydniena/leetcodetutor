import { useEffect, useRef, useState } from 'react';
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
  // Counts failed submits. Two purposes: remounting the alert so a repeated
  // message is announced again, and re-running the focus effect when the
  // message text itself has not changed.
  const [failures, setFailures] = useState(0);
  const errorRef = useRef(null);

  useEffect(() => {
    if (failures) errorRef.current?.focus();
  }, [failures]);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.display);
      setFailures((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  // A login failure is not field-specific -- the server will not say which of
  // the two was wrong -- so both inputs point at the one form-level message.
  const describedBy = error ? 'login-error' : undefined;

  return (
    <div className="auth-shell">
      <form className="card auth-card" onSubmit={onSubmit} aria-busy={busy}>
        <h1>Log in</h1>
        <p className="muted">Track attempts, spot patterns, measure whether you are improving.</p>

        {error && (
          <p key={failures} id="login-error" className="alert" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}

        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required autoFocus
          aria-invalid={Boolean(error)} aria-describedby={describedBy}
          value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required
          aria-invalid={Boolean(error)} aria-describedby={describedBy}
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
