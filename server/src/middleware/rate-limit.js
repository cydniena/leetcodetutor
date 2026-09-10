// Two layers in front of the credential endpoints, plus a cheap third in
// front of both.
//
//   1. An in-process burst gate. No I/O at all, so a flood is refused before
//      it can take a pg pool connection. Best-effort by nature: process-local,
//      lost on restart, and it gives up its bookkeeping under memory pressure.
//      It exists to protect the pool, not to enforce the policy.
//   2. A per-IP volume cap over a fixed window, in Postgres.
//   3. A per-email consecutive-failure counter on login with exponential
//      backoff, in Postgres. Reset by a successful login.
//
// Only the two endpoints that hash a password are limited. Applying layer 2 to
// all of /api/auth/* would count GET /auth/me, which the client calls on every
// page load, and a normal session would exhaust the cap without a single login.
//
// Known trade-off in layer 3: because the counter is keyed on the submitted
// address, someone can hold a victim's account in backoff by failing logins
// against it. The alternative -- keying on address plus IP -- is trivially
// defeated by rotating IPs, which is the threat that actually matters here. The
// backoff is capped rather than a lockout, and sustaining it requires
// sustaining traffic that layer 2 is already counting.

import { pool } from '../db.js';
import { ah, tooManyRequests } from '../lib/http.js';
import { clearAttempt, countAttempt, readAttempt } from '../repos/auth-attempt.js';

const num = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Read per-call rather than captured at import, so a test can tighten the
 * policy without a module cache dance.
 */
export const policy = () => ({
  burstMax: num('RATE_LIMIT_BURST_MAX', 10),
  burstWindowMs: num('RATE_LIMIT_BURST_WINDOW_MS', 10_000),
  ipMax: num('RATE_LIMIT_IP_MAX', 30),
  ipWindowMs: num('RATE_LIMIT_IP_WINDOW_MS', 15 * 60_000),
  emailFailures: num('RATE_LIMIT_EMAIL_FAILURES', 5),
  emailBaseMs: num('RATE_LIMIT_EMAIL_BASE_MS', 60_000),
  emailCapMs: num('RATE_LIMIT_EMAIL_CAP_MS', 15 * 60_000),
  emailWindowMs: num('RATE_LIMIT_EMAIL_WINDOW_MS', 60 * 60_000),
});

// --- layer 1: in-process burst gate ---------------------------------------

const MAX_TRACKED_IPS = 10_000;
const buckets = new Map();

function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full of live buckets: drop the lot rather than grow without bound.
  // Turning a flood into unbounded memory growth would be a worse bug than the
  // one this file is fixing, and layers 2 and 3 still hold.
  if (buckets.size >= MAX_TRACKED_IPS) buckets.clear();
}

/** True when this key has already spent its allowance for the current window. */
function burstExceeded(key, { burstMax, burstWindowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_IPS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + burstWindowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > burstMax;
}

/** Test seam: the gate is process-local, so a test needs to be able to reset it. */
export function resetBurstGate() {
  buckets.clear();
}

// --- shared ----------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.ceil(ms / 1000));

/**
 * 429 with a Retry-After header. Set on res before throwing: the error handler
 * writes the body but does not touch headers, so this survives.
 */
function refuse(res, retryAfterMs) {
  const retryAfter = seconds(retryAfterMs);
  res.set('Retry-After', String(retryAfter));
  return tooManyRequests('too_many_attempts', { retry_after: retryAfter });
}

// --- layer 2: per-IP volume cap -------------------------------------------

/**
 * Mounted on the credential endpoints. Counts every request, successful or
 * not: the cost being rationed is the bcrypt hash and the pool connection,
 * which a correct password spends just the same.
 */
export const limitByIp = ah(async (req, res, next) => {
  const p = policy();
  const key = req.ip || 'unknown';

  if (burstExceeded(key, p)) throw refuse(res, p.burstWindowMs);

  const row = await countAttempt(pool, 'ip', key, p.ipWindowMs);
  if (row.attempts > p.ipMax) {
    const until = new Date(row.window_started_at).getTime() + p.ipWindowMs;
    throw refuse(res, until - Date.now());
  }

  next();
});

// --- layer 3: per-email backoff on login ----------------------------------

/** Normalised the same way the lookup is, so case cannot sidestep the counter. */
export const emailKey = (email) => String(email ?? '').trim().toLowerCase();

function backoffMs(row, p) {
  if (!row || row.attempts < p.emailFailures) return 0;
  const over = row.attempts - p.emailFailures;
  const wait = Math.min(p.emailBaseMs * 2 ** over, p.emailCapMs);
  return new Date(row.last_at).getTime() + wait - Date.now();
}

/**
 * Throws 429 if this address is in backoff. Call before comparing the
 * password: the whole point is to not spend 200ms of event loop on an attempt
 * that is going to be refused.
 */
export async function assertEmailNotInBackoff(res, email) {
  const p = policy();
  const row = await readAttempt(pool, 'email', emailKey(email), p.emailWindowMs);
  const remaining = backoffMs(row, p);
  if (remaining > 0) throw refuse(res, remaining);
}

export async function recordLoginFailure(email) {
  const p = policy();
  await countAttempt(pool, 'email', emailKey(email), p.emailWindowMs);
}

export async function clearLoginFailures(email) {
  await clearAttempt(pool, 'email', emailKey(email));
}
