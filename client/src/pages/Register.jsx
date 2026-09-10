import { useEffect, useRef, useState } from 'react';
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
  // See Login.jsx: remounts the alert so a repeated message is announced
  // again, and re-runs the focus effect when the message has not changed.
  const [failures, setFailures] = useState(0);
  const errorRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  // Send focus to the first field the server rejected, so its message is read
  // on arrival. With no field to blame, the form-level alert takes focus.
  useEffect(() => {
    if (!failures) return;
    const target = (fields?.email && emailRef.current)
      || (fields?.password && passwordRef.current)
      || errorRef.current;
    target?.focus();
  }, [failures, fields]);

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
      setFailures((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="card auth-card" onSubmit={onSubmit} aria-busy={busy}>
        <h1>Create an account</h1>

        {error && (
          <p key={failures} className="alert" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}

        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required autoFocus ref={emailRef}
          aria-invalid={Boolean(fields?.email)}
          aria-describedby={fields?.email ? 'email-error' : undefined}
          value={email} onChange={(e) => setEmail(e.target.value)} />
        {fields?.email && <span id="email-error" className="field-error">{fields.email}</span>}

        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="new-password" required minLength={8} ref={passwordRef}
          aria-invalid={Boolean(fields?.password)}
          aria-describedby={fields?.password ? 'password-error' : 'password-hint'}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {fields?.password
          ? <span id="password-error" className="field-error">{fields.password}</span>
          : <span id="password-hint" className="muted small">At least 8 characters.</span>}

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
