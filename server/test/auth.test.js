import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {
  makeClient, pool, registerClient, startServer, stopServer, testEmail,
} from './helpers.js';
import { BCRYPT_HASH_RE, DUMMY_HASH } from '../src/routes/auth.js';

before(startServer);
after(stopServer);

describe('registration', () => {
  it('creates a learner and starts a session', async () => {
    const { client, email, res } = await registerClient('reg');
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, email);
    assert.equal(res.body.user.role, 'learner');

    const me = await client.get('/auth/me');
    assert.equal(me.status, 200, 'session should be live right after registering');
    assert.equal(me.body.user.email, email);
  });

  it('never returns the password hash', async () => {
    const { client, res } = await registerClient('nohash');
    assert.ok(!('password_hash' in res.body.user));
    const me = await client.get('/auth/me');
    assert.ok(!('password_hash' in me.body.user));
    assert.ok(!/\$2[aby]\$/.test(me.raw), 'no bcrypt hash anywhere in the response');
  });

  it('actually hashes the password', async () => {
    const { email } = await registerClient('hashed');
    const { rows } = await pool.query('select password_hash from app_user where email = $1', [email]);
    assert.match(rows[0].password_hash, /^\$2[aby]\$12\$/, 'bcrypt, cost 12');
    assert.notEqual(rows[0].password_hash, 'password123');
  });

  it('rejects a duplicate email regardless of case', async () => {
    const { email } = await registerClient('dupe');
    const second = await makeClient().post('/auth/register', {
      email: email.toUpperCase(), password: 'password123',
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'email_taken');
  });

  it('rejects a short password and a malformed email', async () => {
    const short = await makeClient().post('/auth/register', {
      email: testEmail('short'), password: 'abc',
    });
    assert.equal(short.status, 400);
    assert.ok(short.body.fields.password);

    const bad = await makeClient().post('/auth/register', {
      email: 'not-an-email', password: 'password123',
    });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fields.email);
  });

  it('cannot be talked into creating an admin', async () => {
    // Privilege escalation via an extra body field. The validator returns only
    // declared fields, so `role` never reaches the insert.
    const client = makeClient();
    const email = testEmail('escalate');
    const res = await client.post('/auth/register', {
      email, password: 'password123', role: 'admin',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'learner');

    const { rows } = await pool.query('select role from app_user where email = $1', [email]);
    assert.equal(rows[0].role, 'learner', 'the database must agree');
  });

  it('falls back to UTC for a bogus timezone and keeps a real one', async () => {
    const bogus = await registerClient('tz-bad', { timezone: 'Mars/Olympus' });
    assert.equal(bogus.res.body.user.timezone, 'UTC');

    const good = await registerClient('tz-good', { timezone: 'Asia/Tokyo' });
    assert.equal(good.res.body.user.timezone, 'Asia/Tokyo');
    // "today" is computed in the user's zone, not the server's.
    assert.match(good.res.body.user.today, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('login and logout', () => {
  it('logs in with the right password', async () => {
    const { email } = await registerClient('login');
    const fresh = makeClient();
    const res = await fresh.post('/auth/login', { email, password: 'password123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, email);
    assert.equal((await fresh.get('/auth/me')).status, 200);
  });

  it('rejects a wrong password and an unknown email identically', async () => {
    const { email } = await registerClient('wrong');
    const wrongPassword = await makeClient().post('/auth/login', { email, password: 'not-it-at-all' });
    const unknownEmail = await makeClient().post('/auth/login', {
      email: 'nobody-here@example.test', password: 'password123',
    });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    // Same code both ways: the response must not reveal whether the account exists.
    assert.equal(wrongPassword.body.error, unknownEmail.body.error);
    assert.equal(wrongPassword.body.error, 'invalid_credentials');
  });

  // The unknown-email branch compares against DUMMY_HASH to keep its response
  // time in line with a wrong password. bcryptjs returns false immediately for
  // a malformed hash, so a typo in the constant silently removes the defence
  // without failing any status-code assertion -- hence checking it directly.
  it('compares unknown emails against a real bcrypt hash of the right cost', async () => {
    assert.equal(DUMMY_HASH.length, 60);
    assert.match(DUMMY_HASH, BCRYPT_HASH_RE);
    // Same cost as registration, or the two branches still differ in time.
    assert.equal(bcrypt.getRounds(DUMMY_HASH), 12);
    // bcryptjs only does key derivation for a hash it can parse; a malformed
    // one short-circuits to false, so this proves the comparison runs.
    const start = process.hrtime.bigint();
    assert.equal(await bcrypt.compare('any-password', DUMMY_HASH), false);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms > 20, `comparing against DUMMY_HASH took ${ms.toFixed(1)}ms; expected a real derivation`);
  });

  it('does not apply the password policy at login', async () => {
    // A short wrong password is a failed login (401), not malformed input (400).
    // Returning 400 here would leak the minimum length and would lock out
    // existing accounts if the policy were ever tightened.
    const { email } = await registerClient('shortwrong');
    const res = await makeClient().post('/auth/login', { email, password: 'no' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_credentials');
  });

  it('rotates the session id on login', async () => {
    const { email } = await registerClient('rotate');
    const client = makeClient();
    await client.get('/auth/me');                    // touch, may set nothing
    await client.post('/auth/login', { email, password: 'password123' });
    const afterLogin = client.jar.get('sid');
    await client.post('/auth/logout');
    await client.post('/auth/login', { email, password: 'password123' });
    assert.notEqual(client.jar.get('sid'), afterLogin, 'a new login gets a new session id');
  });

  it('logout ends the session server-side', async () => {
    const { client } = await registerClient('logout');
    assert.equal((await client.get('/auth/me')).status, 200);
    assert.equal((await client.post('/auth/logout')).status, 204);
    assert.equal((await client.get('/auth/me')).status, 401);
  });

  it('sets an HttpOnly cookie', async () => {
    const { email } = await registerClient('httponly');
    const res = await fetch(`${(await startServer())}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sid='));
    assert.ok(cookie, 'a session cookie is set');
    assert.match(cookie, /HttpOnly/i, 'the token must not be readable from JS');
    assert.match(cookie, /SameSite=Lax/i);
  });
});

describe('the session store', () => {
  it('persists the session in Postgres, not in memory', async () => {
    const { client } = await registerClient('store');
    const sid = client.jar.get('sid');
    assert.ok(sid);
    // express-session signs the cookie as s:<sid>.<sig>; the row key is <sid>.
    const rawSid = decodeURIComponent(sid).replace(/^s:/, '').split('.')[0];
    const { rows } = await pool.query('select sid from user_session where sid = $1', [rawSid]);
    assert.equal(rows.length, 1, 'session row exists in user_session');
  });
});

describe('changing the password', () => {
  /** The raw sid, i.e. the user_session primary key, from a client's jar. */
  function rawSid(client) {
    const cookie = client.jar.get('sid');
    return cookie ? decodeURIComponent(cookie).replace(/^s:/, '').split('.')[0] : null;
  }

  it('swaps the password: the old one stops working, the new one starts', async () => {
    const { client, email } = await registerClient('pw-change');
    const res = await client.patch('/auth/me/password', {
      currentPassword: 'password123', newPassword: 'a-much-better-one',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, email);
    assert.ok(!('password_hash' in res.body.user));

    const old = await makeClient().post('/auth/login', { email, password: 'password123' });
    assert.equal(old.status, 401, 'the old password must be dead');

    const fresh = makeClient();
    assert.equal((await fresh.post('/auth/login', { email, password: 'a-much-better-one' })).status, 200);
    assert.equal((await fresh.get('/auth/me')).status, 200);
  });

  it('stores a new bcrypt hash rather than the password', async () => {
    const { client, email } = await registerClient('pw-hash');
    const before = await pool.query('select password_hash from app_user where email = $1', [email]);
    await client.patch('/auth/me/password', {
      currentPassword: 'password123', newPassword: 'another-good-one',
    });
    const after = await pool.query('select password_hash from app_user where email = $1', [email]);

    assert.match(after.rows[0].password_hash, /^\$2[aby]\$12\$/, 'bcrypt, cost 12');
    assert.notEqual(after.rows[0].password_hash, before.rows[0].password_hash);
    assert.notEqual(after.rows[0].password_hash, 'another-good-one');
  });

  it('refuses a wrong current password and leaves the old one working', async () => {
    const { client, email } = await registerClient('pw-wrong');
    const res = await client.patch('/auth/me/password', {
      currentPassword: 'not-the-password', newPassword: 'a-much-better-one',
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'current_password_incorrect');

    const still = await makeClient().post('/auth/login', { email, password: 'password123' });
    assert.equal(still.status, 200, 'a failed change must not touch the password');
  });

  it('applies the registration policy to the new password', async () => {
    const { client } = await registerClient('pw-policy');
    const short = await client.patch('/auth/me/password', {
      currentPassword: 'password123', newPassword: 'abc',
    });
    assert.equal(short.status, 400);
    assert.equal(short.body.error, 'validation_failed');
    assert.ok(short.body.fields.newPassword);

    const same = await client.patch('/auth/me/password', {
      currentPassword: 'password123', newPassword: 'password123',
    });
    assert.equal(same.status, 400, 'reusing the current password is not a change');
    assert.ok(same.body.fields.newPassword);
  });

  it('does not apply the policy to the current password field', async () => {
    // A short *wrong* current password is a rejected credential (401), not
    // malformed input (400) -- same reasoning as login.
    const { client } = await registerClient('pw-shortcurrent');
    const res = await client.patch('/auth/me/password', {
      currentPassword: 'no', newPassword: 'a-much-better-one',
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'current_password_incorrect');
  });

  it('needs a session', async () => {
    const res = await makeClient().patch('/auth/me/password', {
      currentPassword: 'password123', newPassword: 'a-much-better-one',
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'login_required');
  });

  it('rotates the caller session and keeps the caller logged in', async () => {
    const { client } = await registerClient('pw-rotate');
    const before = rawSid(client);
    await client.patch('/auth/me/password', {
      currentPassword: 'password123', newPassword: 'a-much-better-one',
    });
    const after = rawSid(client);

    assert.notEqual(after, before, 'the caller gets a new session id');
    assert.equal((await client.get('/auth/me')).status, 200, 'and stays logged in');

    const { rows } = await pool.query('select sid from user_session where sid = $1', [before]);
    assert.equal(rows.length, 0, 'the old session row is gone');
  });

  it('signs the user out of every other session', async () => {
    const { client, email } = await registerClient('pw-others');

    // A second and third browser for the same account.
    const other = makeClient();
    await other.post('/auth/login', { email, password: 'password123' });
    const third = makeClient();
    await third.post('/auth/login', { email, password: 'password123' });
    assert.equal((await other.get('/auth/me')).status, 200);
    assert.equal((await third.get('/auth/me')).status, 200);

    await client.patch('/auth/me/password', {
      currentPassword: 'password123', newPassword: 'a-much-better-one',
    });

    assert.equal((await other.get('/auth/me')).status, 401, 'other sessions are dead');
    assert.equal((await third.get('/auth/me')).status, 401);
    assert.equal((await client.get('/auth/me')).status, 200, 'the caller survives');
  });

  it('leaves other users signed in', async () => {
    const mine = await registerClient('pw-mine');
    const theirs = await registerClient('pw-theirs');

    await mine.client.patch('/auth/me/password', {
      currentPassword: 'password123', newPassword: 'a-much-better-one',
    });

    assert.equal((await theirs.client.get('/auth/me')).status, 200, 'not my session to end');
  });
});
