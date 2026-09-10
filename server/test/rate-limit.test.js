// Rate limiting has its own harness rather than reusing helpers.js, because it
// needs the opposite setup: a deliberately tight policy, and control over the
// apparent client address so each case gets its own counter. node --test gives
// each file its own process, so the tight policy set here cannot leak into the
// other suites.
//
// Two rules keep the layers from being mistaken for each other, since both
// answer 429:
//   - tests of the per-IP cap use a fresh email per request, so the per-email
//     backoff can never be the thing that fired;
//   - tests of the per-email backoff use a fresh address per request, so the
//     per-IP cap can never be the thing that fired.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetBurstGate } from '../src/middleware/rate-limit.js';

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_BURST_MAX = '1000000';   // relaxed except where tested
process.env.RATE_LIMIT_BURST_WINDOW_MS = '10000';
process.env.RATE_LIMIT_IP_MAX = '3';
process.env.RATE_LIMIT_IP_WINDOW_MS = '60000';
process.env.RATE_LIMIT_EMAIL_FAILURES = '2';
process.env.RATE_LIMIT_EMAIL_BASE_MS = '60000';
process.env.RATE_LIMIT_EMAIL_CAP_MS = '900000';
process.env.RATE_LIMIT_EMAIL_WINDOW_MS = '3600000';

const PASSWORD = 'password123';
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

let proxied;        // trusts one proxy, so X-Forwarded-For becomes req.ip
let direct;         // TRUST_PROXY unset, which is the default
let proxiedUrl;
let directUrl;
const subjects = new Set();   // auth_attempt rows to clean up
const emails = new Set();     // app_user rows to clean up

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

before(async () => {
  process.env.TRUST_PROXY = '1';
  ({ server: proxied, url: proxiedUrl } = await listen(createApp()));

  delete process.env.TRUST_PROXY;
  ({ server: direct, url: directUrl } = await listen(createApp()));
});

after(async () => {
  if (emails.size) {
    await pool.query('delete from app_user where email = any($1)', [[...emails]]);
  }
  if (subjects.size) {
    await pool.query('delete from auth_attempt where subject = any($1)', [[...subjects]]);
  }
  await pool.query(
    "delete from auth_attempt where scope = 'ip' and subject = any($1)", [LOOPBACK],
  );
  for (const server of [proxied, direct]) {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

beforeEach(() => {
  // The gate is process-local and shared between cases.
  resetBurstGate();
});

/** A distinct apparent client address per use, so counters never overlap. */
let ipCounter = 0;
function freshIp() {
  const ip = `203.0.113.${++ipCounter}`;
  subjects.add(ip);
  return ip;
}

let emailCounter = 0;
function freshEmail(label) {
  const email = `test-rl-${label}-${process.pid}-${Date.now()}-${emailCounter++}@example.test`;
  emails.add(email);
  subjects.add(email.toLowerCase());
  return email;
}

function post(baseUrl, path, { ip, body } = {}) {
  return fetch(`${baseUrl}/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    body: JSON.stringify(body ?? {}),
  }).then(async (res) => ({
    status: res.status,
    retryAfter: res.headers.get('Retry-After'),
    body: await res.json().catch(() => null),
  }));
}

const login = (url, ip, email, password = PASSWORD) =>
  post(url, '/auth/login', { ip, body: { email, password } });

const attemptRow = async (scope, subject) => {
  const { rows } = await pool.query(
    'select attempts from auth_attempt where scope = $1 and subject = $2', [scope, subject],
  );
  return rows[0] ?? null;
};

/** Registers a real user from an address with a full budget. */
async function seedUser(label) {
  const email = freshEmail(label);
  const res = await post(proxiedUrl, '/auth/register', {
    ip: freshIp(), body: { email, password: PASSWORD },
  });
  assert.equal(res.status, 201, 'seeding a user should not be rate limited');
  return email;
}

describe('the per-IP cap', () => {
  it('refuses a fourth credential request with 429 and a Retry-After', async () => {
    const ip = freshIp();

    for (let i = 1; i <= 3; i++) {
      const res = await login(proxiedUrl, ip, freshEmail(`ipcap${i}`), 'wrong');
      assert.equal(res.status, 401, `attempt ${i} should be counted, not blocked`);
    }

    const blocked = await login(proxiedUrl, ip, freshEmail('ipcap4'), 'wrong');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'too_many_attempts');
    assert.ok(Number(blocked.retryAfter) > 0, 'Retry-After tells the client when to come back');
  });

  it('counts registration against the same budget', async () => {
    const ip = freshIp();
    for (let i = 1; i <= 3; i++) {
      const res = await post(proxiedUrl, '/auth/register', {
        ip, body: { email: freshEmail(`flood${i}`), password: PASSWORD },
      });
      assert.equal(res.status, 201);
    }
    const blocked = await post(proxiedUrl, '/auth/register', {
      ip, body: { email: freshEmail('flood4'), password: PASSWORD },
    });
    assert.equal(blocked.status, 429, 'a registration flood is bounded too');
  });

  it('is per-address, so one attacker does not lock out everyone', async () => {
    const attacker = freshIp();
    for (let i = 1; i <= 4; i++) {
      await login(proxiedUrl, attacker, freshEmail(`att${i}`), 'wrong');
    }
    const bystander = await login(proxiedUrl, freshIp(), freshEmail('bystander'), 'wrong');
    assert.equal(bystander.status, 401, 'a different address has its own budget');
  });

  it('does not count GET /auth/me, which the client calls on every load', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${proxiedUrl}/api/auth/me`, { headers: { 'X-Forwarded-For': ip } });
      assert.equal(res.status, 401);
    }
    assert.equal(await attemptRow('ip', ip), null, '/auth/me must not touch the counter');

    const res = await login(proxiedUrl, ip, freshEmail('me'), 'wrong');
    assert.equal(res.status, 401, 'reading /auth/me must not spend the credential budget');
  });
});

describe('the in-process burst gate', () => {
  it('sheds a burst without touching the database', async () => {
    process.env.RATE_LIMIT_BURST_MAX = '2';
    process.env.RATE_LIMIT_IP_MAX = '1000000';   // isolate the gate
    try {
      const ip = freshIp();
      assert.equal((await login(proxiedUrl, ip, freshEmail('burst1'), 'wrong')).status, 401);
      assert.equal((await login(proxiedUrl, ip, freshEmail('burst2'), 'wrong')).status, 401);

      const blocked = await login(proxiedUrl, ip, freshEmail('burst3'), 'wrong');
      assert.equal(blocked.status, 429, 'the third request in the window is shed');

      // The gate runs before the query, so the shed request left no trace.
      const row = await attemptRow('ip', ip);
      assert.equal(row.attempts, 2, 'the shed request never reached Postgres');
    } finally {
      process.env.RATE_LIMIT_BURST_MAX = '1000000';
      process.env.RATE_LIMIT_IP_MAX = '3';
    }
  });
});

describe('the per-email backoff', () => {
  it('blocks a third consecutive failure and reports the wait', async () => {
    const email = freshEmail('backoff');
    assert.equal((await login(proxiedUrl, freshIp(), email, 'wrong-1')).status, 401);
    assert.equal((await login(proxiedUrl, freshIp(), email, 'wrong-2')).status, 401);

    const blocked = await login(proxiedUrl, freshIp(), email, 'wrong-3');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'too_many_attempts');
    // First step of the backoff is RATE_LIMIT_EMAIL_BASE_MS, 60s.
    assert.ok(Number(blocked.retryAfter) > 30, `expected a real wait, got ${blocked.retryAfter}`);
  });

  it('follows the submitted address regardless of case', async () => {
    const email = freshEmail('case');
    await login(proxiedUrl, freshIp(), email.toUpperCase(), 'wrong-1');
    await login(proxiedUrl, freshIp(), email.toLowerCase(), 'wrong-2');

    const blocked = await login(proxiedUrl, freshIp(), email.toUpperCase(), 'wrong-3');
    assert.equal(blocked.status, 429, 'changing case must not reset the counter');
  });

  it('does not reveal whether the address is registered', async () => {
    const registered = await seedUser('enum');
    const unregistered = freshEmail('enum-missing');

    const walk = async (email) => {
      const seen = [];
      for (let i = 1; i <= 3; i++) {
        seen.push((await login(proxiedUrl, freshIp(), email, `wrong-${i}`)).status);
      }
      return seen;
    };

    assert.deepEqual(
      await walk(registered),
      await walk(unregistered),
      'a real account and a made-up one must back off identically',
    );
  });

  it('is cleared by a successful login', async () => {
    const email = await seedUser('clear');
    assert.equal((await login(proxiedUrl, freshIp(), email, 'wrong-1')).status, 401);

    const ok = await login(proxiedUrl, freshIp(), email);
    assert.equal(ok.status, 200, 'one failure must not block the real password');
    assert.equal(
      await attemptRow('email', email.toLowerCase()), null,
      'the failure streak is forgotten on success',
    );
  });

  it('does not spend a bcrypt hash on a blocked attempt', async () => {
    const email = await seedUser('fast');
    await login(proxiedUrl, freshIp(), email, 'wrong-1');
    await login(proxiedUrl, freshIp(), email, 'wrong-2');

    const started = Date.now();
    const blocked = await login(proxiedUrl, freshIp(), email, 'wrong-3');
    const elapsed = Date.now() - started;

    assert.equal(blocked.status, 429);
    // bcryptjs at cost 12 is several hundred ms. A refusal must not pay it.
    assert.ok(elapsed < 150, `blocked attempt took ${elapsed}ms, expected no hashing`);
  });
});

describe('trust proxy', () => {
  it('keys on the forwarded address when TRUST_PROXY is set', async () => {
    const ip = freshIp();
    await login(proxiedUrl, ip, freshEmail('trusted'), 'wrong');
    const row = await attemptRow('ip', ip);
    assert.ok(row, 'with one proxy trusted, X-Forwarded-For is the client address');
    assert.equal(row.attempts, 1);
  });

  it('ignores X-Forwarded-For when TRUST_PROXY is unset', async () => {
    // Deliberately not asserting on a 429 here: the loopback counter is shared
    // with whatever else is talking to this database, so the durable property
    // to check is that the claimed addresses were never believed.
    process.env.RATE_LIMIT_IP_MAX = '1000000';
    try {
      const claimed = ['198.51.100.1', '198.51.100.2', '198.51.100.3'];
      for (const ip of claimed) {
        subjects.add(ip);
        await login(directUrl, ip, freshEmail('spoof'), 'wrong');
      }
      for (const ip of claimed) {
        assert.equal(
          await attemptRow('ip', ip), null,
          `${ip} was taken from a header on an app that trusts no proxy`,
        );
      }
      // The real socket address is what got counted.
      const rows = await Promise.all(LOOPBACK.map((ip) => attemptRow('ip', ip)));
      assert.ok(rows.some(Boolean), 'the real socket address is the one counted');
    } finally {
      process.env.RATE_LIMIT_IP_MAX = '3';
    }
  });
});
