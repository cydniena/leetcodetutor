// The authorization suite.
//
// Phase 1 has only the identity surface, so that is what is covered here.
// Every later phase adds its resource to this file: the rule being defended is
// that user B receives 404 -- never 403, never a row -- for every one of user
// A's resources, and that the check lives in the data layer rather than the UI.
//
// Phase 2: notes.        Phase 3: attempts.
// Phase 4: plans, plan items.  Phase 5: goals, reviews.  Phase 6: analytics.
// Phase 7: admin-only catalog writes.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, pool, registerClient, startServer, stopServer } from './helpers.js';
import { findUserById } from '../src/repos/user.js';

before(startServer);
after(stopServer);

describe('unauthenticated access', () => {
  it('refuses /auth/me without a session', async () => {
    const res = await makeClient().get('/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'login_required');
  });

  it('refuses to change a timezone without a session', async () => {
    const res = await makeClient().patch('/auth/me', { timezone: 'Asia/Tokyo' });
    assert.equal(res.status, 401);
  });
});

describe('one session cannot become another user', () => {
  it('keeps two concurrent sessions separate', async () => {
    const a = await registerClient('own-a');
    const b = await registerClient('own-b');

    assert.equal((await a.client.get('/auth/me')).body.user.email, a.email);
    assert.equal((await b.client.get('/auth/me')).body.user.email, b.email);

    // A writes; B must be untouched.
    await a.client.patch('/auth/me', { timezone: 'Asia/Tokyo' });
    assert.equal((await a.client.get('/auth/me')).body.user.timezone, 'Asia/Tokyo');
    assert.equal((await b.client.get('/auth/me')).body.user.timezone, 'UTC');
  });

  it('a stolen-but-stale cookie is worthless once the user is gone', async () => {
    const { client, email } = await registerClient('deleted');
    assert.equal((await client.get('/auth/me')).status, 200);

    await pool.query('delete from app_user where email = $1', [email]);

    // attachUser finds no user and drops the session rather than trusting the cookie.
    assert.equal((await client.get('/auth/me')).status, 401);
  });

  it('a garbage session cookie is rejected, not honoured', async () => {
    const client = makeClient();
    client.jar.set('sid', 's%3Anot-a-real-session-id.bogussignature');
    const res = await client.get('/auth/me');
    assert.equal(res.status, 401);
  });
});

describe('the data layer, directly', () => {
  it('findUserById never returns the password hash', async () => {
    const { email } = await registerClient('projection');
    const { rows } = await pool.query('select id from app_user where email = $1', [email]);
    const user = await findUserById(pool, rows[0].id);
    assert.equal(user.email, email);
    assert.ok(!('password_hash' in user), 'the safe projection must omit the hash');
  });

  it('returns null for a user that does not exist', async () => {
    assert.equal(await findUserById(pool, 999_999_999), null);
  });
});

describe('role separation', () => {
  it('the seeded admin is an admin and the seeded learner is not', async () => {
    const { rows } = await pool.query(
      `select email, role from app_user
        where email in ('admin@example.com','learner@example.com') order by email`,
    );
    assert.deepEqual(rows, [
      { email: 'admin@example.com', role: 'admin' },
      { email: 'learner@example.com', role: 'learner' },
    ], 'run `npm run seed` if this fails');
  });
});
