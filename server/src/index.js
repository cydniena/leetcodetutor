import { createApp } from './app.js';
import { pool } from './db.js';
import { pruneAttempts } from './repos/auth-attempt.js';

const port = Number(process.env.PORT) || 4000;

// Rate-limit counters only matter inside their window, so sweep the stale rows
// occasionally and keep auth_attempt the size of recent traffic rather than of
// all traffic ever. unref'd: this must never be the reason the process stays up.
const PRUNE_EVERY_MS = 60 * 60_000;
const PRUNE_OLDER_THAN_MS = 24 * 60 * 60_000;

setInterval(() => {
  pruneAttempts(pool, PRUNE_OLDER_THAN_MS)
    .catch((err) => console.error('auth_attempt prune failed:', err.message));
}, PRUNE_EVERY_MS).unref();

createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
