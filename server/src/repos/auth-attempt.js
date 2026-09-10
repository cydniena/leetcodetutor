// Data layer for rate limiting. Same shape as every other repo: db handle
// first, no hidden global.
//
// The window is rolled forward inside the upsert rather than by deleting and
// re-inserting, so two concurrent attempts on the same subject cannot race into
// two rows -- the primary key serialises them and the loser takes the update
// branch.

/**
 * Counts one attempt against (scope, subject) and returns the running total.
 * If the previous window has expired the count restarts at 1, so this is a
 * fixed window, not a leaky bucket: cheap, and generous by at most one window.
 */
export async function countAttempt(db, scope, subject, windowMs) {
  const { rows } = await db.query(
    `insert into auth_attempt (scope, subject, attempts)
     values ($1, $2, 1)
     on conflict (scope, subject) do update
       set attempts = case
             when auth_attempt.window_started_at < now() - ($3 || ' milliseconds')::interval
             then 1
             else auth_attempt.attempts + 1
           end,
           window_started_at = case
             when auth_attempt.window_started_at < now() - ($3 || ' milliseconds')::interval
             then now()
             else auth_attempt.window_started_at
           end,
           last_at = now()
     returning attempts, window_started_at, last_at`,
    [scope, subject, String(Math.round(windowMs))],
  );
  return rows[0];
}

/**
 * Reads the counter without touching it. Used to decide whether to reject
 * before doing any expensive work, so that a request being turned away does
 * not itself extend the block.
 */
export async function readAttempt(db, scope, subject, windowMs) {
  const { rows } = await db.query(
    `select attempts, window_started_at, last_at
       from auth_attempt
      where scope = $1
        and subject = $2
        and window_started_at >= now() - ($3 || ' milliseconds')::interval`,
    [scope, subject, String(Math.round(windowMs))],
  );
  return rows[0] ?? null;
}

/** Called on a successful login: the streak of failures is over. */
export async function clearAttempt(db, scope, subject) {
  await db.query('delete from auth_attempt where scope = $1 and subject = $2', [scope, subject]);
}

/** Housekeeping: drop rows whose window closed long ago. */
export async function pruneAttempts(db, olderThanMs) {
  const { rowCount } = await db.query(
    `delete from auth_attempt where last_at < now() - ($1 || ' milliseconds')::interval`,
    [String(Math.round(olderThanMs))],
  );
  return rowCount;
}
