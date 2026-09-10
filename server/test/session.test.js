// The bug these cover: express-session's regenerate/save/destroy call back
// asynchronously, so `throw` from inside one of those callbacks escaped the
// handler's promise chain and arrived as an uncaughtException -- which by
// default kills the process. A store hiccup on one login took the API down for
// everyone. The property under test is that a store failure is now an ordinary
// rejection that the error handler can turn into a 500.
//
// No database here: a deliberately broken MemoryStore stands in for Postgres,
// so this file runs even with the dev stack down.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import { ah } from '../src/lib/http.js';
import { destroySession, regenerateSession, saveSession } from '../src/lib/session.js';

/** MemoryStore that fails the named methods, the way a dropped pool would. */
class FlakyStore extends session.MemoryStore {
  constructor() {
    super();
    this.failing = new Set();
  }

  #maybeFail(method, args) {
    if (!this.failing.has(method)) return false;
    const cb = args[args.length - 1];
    // Asynchronous, like a real store round-trip. That timing is the whole
    // point: a synchronous callback would still be inside the promise chain.
    setImmediate(() => cb(new Error(`${method} failed`)));
    return true;
  }

  set(...args) {
    if (this.#maybeFail('set', args)) return;
    super.set(...args);
  }

  destroy(...args) {
    if (this.#maybeFail('destroy', args)) return;
    super.destroy(...args);
  }
}

let store;
let baseUrl;
let server;

before(async () => {
  store = new FlakyStore();

  const app = express();
  app.use(express.json());
  app.use(session({
    name: 'sid', secret: 'test-only', resave: false, saveUninitialized: false, store,
  }));

  // Mirrors the real /auth/login and /auth/logout session handling.
  app.post('/login', ah(async (req, res) => {
    await regenerateSession(req.session);
    req.session.userId = 1;
    await saveSession(req.session);
    res.json({ ok: true });
  }));

  app.post('/logout', ah(async (req, res) => {
    await destroySession(req.session);
    res.status(204).end();
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(500).json({ error: 'internal_error' }));

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const post = (path) => fetch(`${baseUrl}${path}`, { method: 'POST' });

describe('session store failures', () => {
  it('logs in normally when the store is healthy', async () => {
    store.failing.clear();
    const res = await post('/login');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it('a failure inside regenerate becomes a 500, not a crash', async () => {
    // regenerate() drops the old record, so a failing destroy breaks it.
    store.failing = new Set(['destroy']);
    const res = await post('/login');
    // Reaching this line at all is the regression test: before the fix the
    // throw was uncaught and this process would not have survived to assert.
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'internal_error' });
  });

  it('a failure inside save becomes a 500, not a crash', async () => {
    store.failing = new Set(['set']);
    const res = await post('/login');
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'internal_error' });
  });

  it('a failure inside destroy becomes a 500, not a silent 204', async () => {
    store.failing = new Set(['destroy']);
    const res = await post('/logout');
    assert.equal(res.status, 500, 'logout must not report success it did not achieve');
  });

  it('the process is still healthy afterwards', async () => {
    store.failing.clear();
    const res = await post('/login');
    assert.equal(res.status, 200, 'a store failure must not poison later requests');
  });
});

describe('the promisified wrappers', () => {
  it('reject with the store error rather than throwing past the caller', async () => {
    const fake = {
      regenerate: (cb) => setImmediate(() => cb(new Error('boom'))),
      save: (cb) => setImmediate(() => cb(new Error('boom'))),
      destroy: (cb) => setImmediate(() => cb(new Error('boom'))),
    };
    for (const wrap of [regenerateSession, saveSession, destroySession]) {
      await assert.rejects(wrap(fake), /boom/);
    }
  });

  it('resolve when the store succeeds', async () => {
    const fake = {
      regenerate: (cb) => setImmediate(cb),
      save: (cb) => setImmediate(cb),
      destroy: (cb) => setImmediate(cb),
    };
    for (const wrap of [regenerateSession, saveSession, destroySession]) {
      await wrap(fake);
    }
  });
});
