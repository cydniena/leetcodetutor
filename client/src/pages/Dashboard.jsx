import { useAuth } from '../lib/auth.jsx';

// Phase 1 dashboard. The real one (today's queue plus the three headline
// numbers) needs the reviews and analytics endpoints, so it lands in phase 5.
export default function Dashboard() {
  const { user, isAdmin } = useAuth();

  return (
    <>
      <div className="card">
        <h1>Signed in</h1>
        <p className="muted">
          Session-based auth is working: the cookie is HttpOnly, so this page
          learned who you are by asking <code>GET /api/auth/me</code>, not by
          reading a token.
        </p>
        <dl className="kv">
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Role</dt><dd>{user.role}{isAdmin && ' (catalog editing unlocked in phase 7)'}</dd>
          <dt>Timezone</dt><dd>{user.timezone}</dd>
          <dt>Today, for you</dt><dd>{user.today}</dd>
        </dl>
      </div>

      <div className="card">
        <h2>What this dashboard becomes</h2>
        <p className="muted">
          Phase 5 replaces this panel with today’s queue — overdue plan items
          plus reviews that are due — and the three numbers that decide whether
          the app is working at all:
        </p>
        <ul className="checks">
          <li>Average time-to-solve at a given difficulty, trending down</li>
          <li>Share of solves needing hint level 2+, trending down</li>
          <li>Repeat attempts on old problems holding up instead of decaying</li>
        </ul>
        <p className="muted small">
          The seeded demo history already contains a real trend in all three, so
          the charts have something to prove themselves against.
        </p>
      </div>
    </>
  );
}
