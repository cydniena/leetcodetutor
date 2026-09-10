import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [fields, setFields] = useState(null);
  const [busy, setBusy] = useState(false);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields(null);
    try {
      await register(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.display);
      setFields(err.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Create an account</h1>

        {error && <p className="alert">{error}</p>}

        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required
          value={email} onChange={(e) => setEmail(e.target.value)} />
        {fields?.email && <span className="field-error">{fields.email}</span>}

        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="new-password" required minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {fields?.password
          ? <span className="field-error">{fields.password}</span>
          : <span className="muted small">At least 8 characters.</span>}

        <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>

        <p className="muted small">
          Your timezone is detected as <code>{timezone}</code>. Day boundaries
          for “due today” use it; you can change it later.
        </p>
        <p className="muted small">
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
