// Test harness with no new dependencies: node:test, node:assert and global
// fetch are all in the standard library on Node 22. This is what we use
// instead of vitest + supertest.
//
// Tests run against the development database but only ever touch rows they
// created themselves (unique emails, cleaned up in teardown), so the seeded
// demo data survives a test run.

import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';

let server;
let baseUrl;
const createdEmails = new Set();

// These suites make more credential requests in a few seconds than a person
// makes in a year, so they run with the rate limiter effectively off. The
// policy itself has its own suite (rate-limit.test.js) which sets a tight one.
// node --test gives each file its own process, so this cannot leak into it.
function relaxRateLimits() {
  process.env.RATE_LIMIT_BURST_MAX = '1000000';
  process.env.RATE_LIMIT_IP_MAX = '1000000';
  process.env.RATE_LIMIT_EMAIL_FAILURES = '1000000';
}

export async function startServer() {
  if (server) return baseUrl;
  process.env.NODE_ENV = 'test';
  relaxRateLimits();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

export async function stopServer() {
  // Remove every user this run created; cascades clear their owned rows.
  if (createdEmails.size) {
    await pool.query('delete from app_user where email = any($1)', [[...createdEmails]]);
    createdEmails.clear();
  }
  // Every address a test submits ends in @example.test, including the ones
  // written inline rather than handed out by testEmail(), so match on the
  // suffix and leave nothing behind in the counter table.
  await pool.query("delete from auth_attempt where scope = 'email' and subject like '%@example.test'");
  // The suite hammers the loopback address with the limiter turned off, so it
  // leaves a count that would lock the developer out of their own dev server,
  // which reads the real policy from .env. Clear it.
  await pool.query(
    "delete from auth_attempt where scope = 'ip' and subject = any($1)",
    [['127.0.0.1', '::1', '::ffff:127.0.0.1']],
  );
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
}

/** A fetch bound to one cookie jar, i.e. one browser. */
export function makeClient() {
  const jar = new Map();

  async function request(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (jar.size) {
      headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });

    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name);
      else jar.set(name, value);
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, body: json, raw: text, cookies: jar };
  }

  return {
    request,
    get: (p) => request(p),
    post: (p, body) => request(p, { method: 'POST', body }),
    patch: (p, body) => request(p, { method: 'PATCH', body }),
    del: (p) => request(p, { method: 'DELETE' }),
    jar,
  };
}

let counter = 0;
/** Unique email per call, tracked so teardown can delete it. */
export function testEmail(label = 'user') {
  const email = `test-${label}-${process.pid}-${Date.now()}-${counter++}@example.test`;
  createdEmails.add(email);
  return email;
}

/** Register a fresh user and return a logged-in client. */
export async function registerClient(label, overrides = {}) {
  const client = makeClient();
  const email = testEmail(label);
  const res = await client.post('/auth/register', {
    email, password: 'password123', ...overrides,
  });
  return { client, email, res };
}

export { pool };
