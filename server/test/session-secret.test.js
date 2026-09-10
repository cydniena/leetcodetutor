// No database and no server: resolveSessionSecret is a pure decision about the
// environment, so it is tested directly.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_SECRET_LENGTH, resolveSessionSecret } from '../src/lib/session-secret.js';

const strong = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const prod = (SESSION_SECRET) => ({ NODE_ENV: 'production', SESSION_SECRET });
const dev = (SESSION_SECRET) => ({ NODE_ENV: 'development', SESSION_SECRET });

describe('a usable secret', () => {
  it('is passed through untouched', () => {
    for (const env of [prod(strong), dev(strong)]) {
      const { secret, generated, warning } = resolveSessionSecret(env);
      assert.equal(secret, strong);
      assert.equal(generated, false);
      assert.equal(warning, null);
    }
  });

  it('is trimmed, because a shell export can pick up whitespace', () => {
    assert.equal(resolveSessionSecret(prod(`  ${strong}\n`)).secret, strong);
  });

  it('is accepted at exactly the minimum length', () => {
    const exact = 'abcdefgh12345678ABCDEFGH!@#$%^&*'.slice(0, MIN_SECRET_LENGTH);
    assert.equal(exact.length, MIN_SECRET_LENGTH);
    assert.equal(resolveSessionSecret(prod(exact)).secret, exact);
  });
});

describe('production refuses to boot', () => {
  const rejected = {
    'a missing variable': undefined,
    'an empty variable': '',
    'whitespace only': '   ',
    'the .env.example placeholder': 'change-me-to-a-long-random-string',
    'the placeholder in another case': 'Change-Me-To-A-Long-Random-String',
    'the old hardcoded fallback': 'dev-only-insecure-secret',
    'a short secret': 'a1b2c3d4e5f6',
    'a long but repetitive secret': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'a non-string': 12345,
  };

  for (const [label, value] of Object.entries(rejected)) {
    it(`on ${label}`, () => {
      assert.throws(() => resolveSessionSecret(prod(value)), /SESSION_SECRET/);
    });
  }

  it('explains how to generate one', () => {
    assert.throws(() => resolveSessionSecret(prod(undefined)), /randomBytes/);
  });
});

describe('development degrades loudly instead', () => {
  it('generates a random secret and warns', () => {
    const { secret, generated, warning } = resolveSessionSecret(dev(undefined));
    assert.equal(generated, true);
    assert.match(secret, /^[0-9a-f]{64}$/, 'crypto-random hex');
    assert.match(warning, /SESSION_SECRET is not set/);
  });

  it('never reuses a secret between processes', () => {
    const a = resolveSessionSecret(dev(undefined)).secret;
    const b = resolveSessionSecret(dev(undefined)).secret;
    assert.notEqual(a, b, 'a forgeable constant is the whole bug');
  });

  it('rejects the placeholder too, rather than signing with a public string', () => {
    const { secret, generated } = resolveSessionSecret(dev('change-me-to-a-long-random-string'));
    assert.equal(generated, true);
    assert.notEqual(secret, 'change-me-to-a-long-random-string');
  });

  it('treats an unset NODE_ENV as development', () => {
    assert.equal(resolveSessionSecret({}).generated, true);
  });
});
