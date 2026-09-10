// App-level plumbing: health, the 404 fallthrough, CORS, and the error
// handler. These are the paths every route inherits, so a mistake here shows
// up as a wrong status on endpoints that look fine individually.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, pool, registerClient, startServer, stopServer } from './helpers.js';

let baseUrl;
before(async () => { baseUrl = await startServer(); });
after(stopServer);

/** A fetch that bypasses makeClient's JSON encoding, for malformed bodies. */
async function raw(path, { method = 'POST', body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}/api${path}`, { method, body, headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, body: json, raw: text };
}

const JSON_CT = { 'Content-Type': 'application/json' };

describe('health', () => {
  it('answers without a session', async () => {
    const res = await makeClient().get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });
});

describe('unmatched routes', () => {
  it('returns a json 404 rather than express html', async () => {
    const res = await makeClient().get('/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'no_such_route' });
  });

  it('treats a wrong method on a real path as 404', async () => {
    // GET /auth/login matches no route, so it falls through to the handler.
    const res = await makeClient().get('/auth/login');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'no_such_route' });
  });
});

describe('client errors keep their own status', () => {
  // Regression: the handler only recognised HttpError, so body-parser's own
  // 4xx errors fell through to `console.error` + 500. A caller cannot tell
  // "your JSON is broken" from "the server is broken" if both answer 500.
  it('answers 400 for a body that is not valid json', async () => {
    const res = await raw('/auth/login', { body: '{"email":', headers: JSON_CT });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'malformed_json' });
  });

  it('answers 400 for a json body that is not an object', async () => {
    // express.json() is strict: a bare string is a parse failure, not a body.
    const res = await raw('/auth/login', { body: '"hi"', headers: JSON_CT });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'malformed_json' });
  });

  it('answers 413 for a body over the 64kb limit', async () => {
    const body = JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(70 * 1024) });
    const res = await raw('/auth/login', { body, headers: JSON_CT });
    assert.equal(res.status, 413);
    assert.deepEqual(res.body, { error: 'payload_too_large' });
  });

  it('never echoes the rejected body back to the caller', async () => {
    // body-parser sets expose:true and puts a slice of the body in .message,
    // so replying with err.message would reflect unparsed input.
    const secret = 'topsecrettoken';
    const res = await raw('/auth/login', { body: `{"password":"${secret}"`, headers: JSON_CT });
    assert.equal(res.status, 400);
    assert.ok(!res.raw.includes(secret), `response echoed the body: ${res.raw}`);
  });

  it('ignores a body sent with a non-json content type', async () => {
    // Not a parse error: express.json() skips it, so the body is simply absent
    // and the route's own validation answers.
    const res = await raw('/auth/login', {
      body: 'email=a@b.co', headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'validation_failed');
  });

  it('treats a json array body as an absent body', async () => {
    const res = await raw('/auth/login', { body: '[1,2,3]', headers: JSON_CT });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'validation_failed');
    assert.equal(res.body.fields.email, 'email is required');
  });
});

describe('genuine server faults', () => {
  it('answers 500 without leaking the error, and stays up', async () => {
    // A session row whose userId is not a bigint makes findUserById fail in
    // the database. That is a real fault, so it must still be a 500 -- the
    // client-error branch must not swallow every error into a 4xx. It also
    // covers attachUser's catch: a corrupt session must not kill the process.
    const { client } = await registerClient('corruptsess');
    const sid = decodeURIComponent(client.jar.get('sid')).replace(/^s:/, '').split('.')[0];
    const { rowCount } = await pool.query(
      `update user_session set sess = jsonb_set(sess::jsonb, '{userId}', '"not-a-bigint"')::json
        where sid = $1`,
      [sid],
    );
    assert.equal(rowCount, 1, 'test needs to find the caller\'s own session row');

    const res = await client.get('/auth/me');
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'internal_error' }, 'must not leak the pg error');

    // The process survived: a later request on a clean session still works.
    assert.equal((await makeClient().get('/health')).status, 200);
  });
});

describe('CORS', () => {
  it('sends no CORS headers when CLIENT_ORIGIN is unset', async () => {
    const before = process.env.CLIENT_ORIGIN;
    delete process.env.CLIENT_ORIGIN;
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.headers.get('access-control-allow-origin'), null);
    } finally {
      if (before !== undefined) process.env.CLIENT_ORIGIN = before;
    }
  });

  it('allows the one configured origin with credentials', async () => {
    const before = process.env.CLIENT_ORIGIN;
    process.env.CLIENT_ORIGIN = 'http://localhost:5173';
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
      // credentials:'include' forbids a wildcard, so this pair must hold.
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
      assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
      // Caches must not serve one origin's response to another.
      assert.match(res.headers.get('vary') || '', /Origin/i);
    } finally {
      if (before === undefined) delete process.env.CLIENT_ORIGIN;
      else process.env.CLIENT_ORIGIN = before;
    }
  });

  it('answers a preflight 204 without running the route', async () => {
    const before = process.env.CLIENT_ORIGIN;
    process.env.CLIENT_ORIGIN = 'http://localhost:5173';
    try {
      const res = await fetch(`${baseUrl}/api/auth/login`, { method: 'OPTIONS' });
      assert.equal(res.status, 204);
      assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
      assert.match(res.headers.get('access-control-allow-headers') || '', /Content-Type/i);
    } finally {
      if (before === undefined) delete process.env.CLIENT_ORIGIN;
      else process.env.CLIENT_ORIGIN = before;
    }
  });
});

describe('security headers', () => {
  it('applies helmet to api responses', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    // helmet removes the framework fingerprint.
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});
