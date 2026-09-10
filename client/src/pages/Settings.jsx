import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

export default function Settings() {
  const { user, changePassword } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  // See Login.jsx: remounts the alert so a repeated message is announced
  // again, and re-runs the focus effect when the message has not changed.
  const [failures, setFailures] = useState(0);
  const errorRef = useRef(null);
  const doneRef = useRef(null);
  const currentRef = useRef(null);
  const newRef = useRef(null);
  const confirmRef = useRef(null);

  // Send focus to the field that was rejected, so its message is read on
  // arrival. With no field to blame, the form-level alert takes focus.
  useEffect(() => {
    if (!failures) return;
    const target = (fields?.currentPassword && currentRef.current)
      || (fields?.newPassword && newRef.current)
      || (fields?.confirmPassword && confirmRef.current)
      || errorRef.current;
    target?.focus();
  }, [failures, fields]);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  function set(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setFields(null);
    setDone(false);

    // The confirmation box never leaves the browser -- it exists to catch a
    // typo in a field nobody can read back.
    if (form.newPassword !== form.confirmPassword) {
      setFields({ confirmPassword: 'The two new passwords do not match' });
      setError('Please check the highlighted fields.');
      setFailures((n) => n + 1);
      return;
    }

    setBusy(true);
    try {
      await changePassword(form.currentPassword, form.newPassword);
      setForm(EMPTY);
      setDone(true);
    } catch (err) {
      setError(err.display);
      setFields(err.fields);
      setFailures((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h1>Settings</h1>
        <dl className="kv">
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Timezone</dt><dd>{user.timezone}</dd>
        </dl>
      </div>

      <form className="card settings-form" onSubmit={onSubmit} aria-busy={busy}>
        <h2>Change password</h2>
        <p className="muted small">
          Changing your password signs out every other device. This one stays
          signed in.
        </p>

        {error && (
          <p key={failures} className="alert" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}

        {done && (
          <p className="alert info" role="status" tabIndex={-1} ref={doneRef}>
            Password changed. Any other device signed in to this account has been signed out.
          </p>
        )}

        <label htmlFor="currentPassword">Current password</label>
        <input id="currentPassword" type="password" autoComplete="current-password" required ref={currentRef}
          aria-invalid={Boolean(fields?.currentPassword)}
          aria-describedby={fields?.currentPassword ? 'currentPassword-error' : undefined}
          value={form.currentPassword} onChange={(e) => set('currentPassword', e.target.value)} />
        {fields?.currentPassword && (
          <span id="currentPassword-error" className="field-error">{fields.currentPassword}</span>
        )}

        <label htmlFor="newPassword">New password</label>
        <input id="newPassword" type="password" autoComplete="new-password" required minLength={8} ref={newRef}
          aria-invalid={Boolean(fields?.newPassword)}
          aria-describedby={fields?.newPassword ? 'newPassword-error' : 'newPassword-hint'}
          value={form.newPassword} onChange={(e) => set('newPassword', e.target.value)} />
        {fields?.newPassword
          ? <span id="newPassword-error" className="field-error">{fields.newPassword}</span>
          : <span id="newPassword-hint" className="muted small">At least 8 characters.</span>}

        <label htmlFor="confirmPassword">Confirm new password</label>
        <input id="confirmPassword" type="password" autoComplete="new-password" required ref={confirmRef}
          aria-invalid={Boolean(fields?.confirmPassword)}
          aria-describedby={fields?.confirmPassword ? 'confirmPassword-error' : undefined}
          value={form.confirmPassword} onChange={(e) => set('confirmPassword', e.target.value)} />
        {fields?.confirmPassword && (
          <span id="confirmPassword-error" className="field-error">{fields.confirmPassword}</span>
        )}

        <button type="submit" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
      </form>

      <div className="card">
        <h2>Forgotten your password?</h2>
        <p className="muted">
          There is no reset-by-email yet — it needs a mailer and single-use
          tokens, and it is on the roadmap as phase 8 along with account
          deletion. Until then, a password can only be changed from a session
          that is already signed in.
        </p>
      </div>
    </>
  );
}
