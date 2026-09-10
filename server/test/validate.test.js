// Unit tests for the hand-rolled validator. No server, no database: this is
// the layer that decides what reaches SQL, so it is worth pinning branch by
// branch rather than only through the routes that happen to use it today.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { f, validate, parseBody } from '../src/lib/validate.js';

/** Run one field check and return { value, errors } for that field alone. */
function one(check, raw, field = 'x') {
  const { value, errors } = validate({ [field]: raw }, { [field]: check });
  return { value: value[field], error: errors?.[field] ?? null, has: field in value };
}

const ok = (check, raw, expected) => {
  const r = one(check, raw);
  assert.equal(r.error, null, `expected no error, got ${r.error}`);
  assert.deepEqual(r.value, expected);
};

const bad = (check, raw, match) => {
  const r = one(check, raw);
  assert.ok(r.error, `expected an error for ${JSON.stringify(raw)}, got value ${JSON.stringify(r.value)}`);
  if (match) assert.match(r.error, match);
};

describe('presence, defaults and absence', () => {
  it('treats undefined, null and empty string as absent', async () => {
    for (const raw of [undefined, null, '']) {
      bad(f.str({ required: true }), raw, /is required/);
    }
  });

  it('substitutes a default when absent', () => {
    ok(f.str({ default: 'UTC' }), undefined, 'UTC');
    ok(f.str({ default: 'UTC' }), null, 'UTC');
    ok(f.str({ default: 'UTC' }), '', 'UTC');
    ok(f.int({ default: 7 }), undefined, 7);
  });

  it('omits an absent optional field rather than setting it undefined', () => {
    const r = one(f.str({}), undefined);
    assert.equal(r.error, null);
    // The distinction matters: a repo doing `'x' in body` must not see it.
    assert.equal(r.has, false, 'absent optional field should not appear in value');
  });

  it('prefers the default over required when both are set', () => {
    // required wins: a field cannot be both mandatory and defaulted.
    bad(f.str({ required: true, default: 'z' }), undefined, /is required/);
  });

  it('keeps only declared fields, so an unexpected key cannot reach sql', () => {
    const { value } = validate(
      { email: 'a@b.co', role: 'admin', '; drop table': 1 },
      { email: f.str({ required: true }) },
    );
    assert.deepEqual(value, { email: 'a@b.co' });
  });

  it('returns null errors when everything passes', () => {
    const { errors } = validate({ a: 'x' }, { a: f.str({}) });
    assert.equal(errors, null);
  });

  it('reports every bad field at once, not just the first', () => {
    const { errors } = validate({}, {
      a: f.str({ required: true }),
      b: f.int({ required: true }),
    });
    assert.deepEqual(Object.keys(errors).sort(), ['a', 'b']);
  });

  it('survives a body that is not an object', () => {
    for (const body of [null, undefined, 'string', 42, []]) {
      const { errors } = validate(body, { a: f.str({ required: true }) });
      assert.deepEqual(errors, { a: 'a is required' });
    }
  });
});

describe('f.str', () => {
  it('trims by default and can be told not to', () => {
    ok(f.str({}), '  hi  ', 'hi');
    ok(f.str({ trim: false }), '  hi  ', '  hi  ');
  });

  it('rejects a non-string', () => {
    for (const raw of [42, true, {}, [], ['a']]) bad(f.str({}), raw, /must be a string/);
  });

  it('treats whitespace-only as required-missing after trimming', () => {
    bad(f.str({ required: true }), '   ', /is required/);
  });

  it('enforces min and max length', () => {
    bad(f.str({ min: 8 }), 'short', /at least 8 characters/);
    ok(f.str({ min: 8 }), 'longenough', 'longenough');
    bad(f.str({ max: 3 }), 'abcd', /at most 3 characters/);
    ok(f.str({ max: 3 }), 'abc', 'abc');
  });

  it('measures length after trimming, not before', () => {
    // Bounds apply to what gets stored.
    ok(f.str({ max: 3 }), '  ab  ', 'ab');
  });

  it('counts a password with trim:false as sent', () => {
    // A trailing space is part of a password; it must count towards the minimum.
    ok(f.str({ min: 8, trim: false }), '1234567 ', '1234567 ');
  });

  it('applies a pattern and uses the custom message', () => {
    const email = f.str({ pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'email is not valid' });
    ok(email, 'a@b.co', 'a@b.co');
    bad(email, 'not-an-email', /^email is not valid$/);
  });

  it('falls back to a generic message when none is given', () => {
    bad(f.str({ pattern: /^\d+$/ }), 'abc', /not in the expected format/);
  });

  it('tests the pattern against the trimmed value', () => {
    ok(f.str({ pattern: /^\d+$/ }), ' 123 ', '123');
  });
});

describe('f.int', () => {
  it('accepts a number and a numeric string', () => {
    ok(f.int({}), 42, 42);
    ok(f.int({}), '42', 42);
    ok(f.int({}), ' 42 ', 42);
    ok(f.int({}), -3, -3);
    ok(f.int({}), 0, 0);
  });

  it('rejects a non-integer', () => {
    for (const raw of ['1.5', 1.5, 'abc', 'Infinity', NaN]) {
      bad(f.int({}), raw, /must be a whole number/);
    }
  });

  // Regression: the coercion was Number(String(raw)), and String() on a
  // container yields something Number() accepts -- String([]) is '' which
  // becomes 0, String(['7']) is '7' which becomes 7. A JSON array therefore
  // passed as a number and reached the database as one, so a CHECK constraint
  // answered 500 where validation should have answered 400.
  it('rejects a container that stringifies to a number', () => {
    bad(f.int({}), [], /must be a whole number/);
    bad(f.int({}), ['7'], /must be a whole number/);
    bad(f.int({}), [7], /must be a whole number/);
    bad(f.int({}), [[5]], /must be a whole number/);
    bad(f.int({}), {}, /must be a whole number/);
    bad(f.int({}), true, /must be a whole number/);
  });

  it('enforces min and max, including zero as a bound', () => {
    bad(f.int({ min: 1 }), 0, /at least 1/);
    ok(f.int({ min: 1 }), 1, 1);
    bad(f.int({ max: 600 }), 601, /at most 600/);
    ok(f.int({ max: 600 }), 600, 600);
    // A zero bound must apply, so `min: 0` cannot be treated as "no minimum".
    bad(f.int({ min: 0 }), -1, /at least 0/);
    bad(f.int({ max: 0 }), 1, /at most 0/);
  });
});

describe('f.num', () => {
  it('accepts fractions from numbers and strings', () => {
    ok(f.num({}), 1.5, 1.5);
    ok(f.num({}), '2.25', 2.25);
    ok(f.num({}), 3, 3);
  });

  it('rejects non-finite and non-numeric input', () => {
    for (const raw of ['abc', 'Infinity', Infinity, NaN]) bad(f.num({}), raw, /must be a number/);
  });

  it('rejects a container that stringifies to a number', () => {
    bad(f.num({}), [], /must be a number/);
    bad(f.num({}), ['1.5'], /must be a number/);
    bad(f.num({}), {}, /must be a number/);
  });

  it('enforces min and max', () => {
    // hours_per_week is the real use: must be > 0.
    bad(f.num({ min: 0.5 }), 0.25, /at least 0.5/);
    ok(f.num({ min: 0.5 }), 0.5, 0.5);
    bad(f.num({ max: 40 }), 40.5, /at most 40/);
  });
});

describe('f.bool', () => {
  it('accepts real booleans', () => {
    ok(f.bool({}), true, true);
    ok(f.bool({}), false, false);
  });

  it('accepts the string and number spellings a query string produces', () => {
    ok(f.bool({}), 'true', true);
    ok(f.bool({}), '1', true);
    ok(f.bool({}), 1, true);
    ok(f.bool({}), 'false', false);
    ok(f.bool({}), '0', false);
    ok(f.bool({}), 0, false);
  });

  it('rejects anything else rather than guessing truthiness', () => {
    for (const raw of ['yes', 'no', 2, 'TRUE', [], {}]) {
      bad(f.bool({}), raw, /must be true or false/);
    }
  });

  it('distinguishes false from absent', () => {
    // false is a value; '' is absence. Both are falsy, so this is easy to break.
    ok(f.bool({ default: true }), false, false);
    ok(f.bool({ default: true }), '', true);
  });
});

describe('f.date', () => {
  it('accepts a calendar day in YYYY-MM-DD', () => {
    ok(f.date({}), '2026-09-10', '2026-09-10');
    ok(f.date({}), '2024-02-29', '2024-02-29');
  });

  it('rejects a timestamp where a calendar day is meant', () => {
    bad(f.date({}), '2026-09-10T00:00:00Z', /YYYY-MM-DD form/);
    bad(f.date({}), 1757462400000, /YYYY-MM-DD form/);
  });

  it('rejects a well-shaped string that is not a real date', () => {
    bad(f.date({}), '2026-02-30', /not a real date/);
    bad(f.date({}), '2025-02-29', /not a real date/);
    bad(f.date({}), '2026-13-01', /not a real date/);
    bad(f.date({}), '2026-00-10', /not a real date/);
  });

  it('rejects loose spellings', () => {
    for (const raw of ['2026-9-10', '10-09-2026', '20260910', ' 2026-09-10']) {
      bad(f.date({}), raw, /YYYY-MM-DD form/);
    }
  });
});

describe('f.oneOf', () => {
  const outcome = f.oneOf(['solved_clean', 'solved_with_hint', 'gave_up'], {});

  it('accepts a listed value', () => {
    ok(outcome, 'gave_up', 'gave_up');
  });

  it('rejects an unlisted value and names the options', () => {
    bad(outcome, 'solved', /must be one of: solved_clean, solved_with_hint, gave_up/);
  });

  it('does not coerce, so a lookalike is rejected', () => {
    bad(f.oneOf([1, 2], {}), '1', /must be one of/);
    bad(outcome, 'GAVE_UP', /must be one of/);
  });
});

describe('f.intArray', () => {
  it('accepts an array of ids', () => {
    ok(f.intArray({}), [1, 2, 3], [1, 2, 3]);
    ok(f.intArray({}), ['1', '2'], [1, 2]);
  });

  it('accepts a comma-separated string and a bare id', () => {
    ok(f.intArray({}), '1,2,3', [1, 2, 3]);
    ok(f.intArray({}), ' 1 , 2 ', [1, 2]);
    ok(f.intArray({}), 5, [5]);
  });

  it('de-duplicates while keeping first-seen order', () => {
    ok(f.intArray({}), [3, 1, 3, 1, 2], [3, 1, 2]);
  });

  it('rejects ids that are not positive integers', () => {
    for (const raw of [[0], [-1], [1.5], ['abc'], [null]]) {
      bad(f.intArray({}), raw, /must be a list of ids/);
    }
  });

  it('rejects a nested container instead of stringifying it', () => {
    bad(f.intArray({}), [[1, 2]], /must be a list of ids/);
    bad(f.intArray({}), [{}], /must be a list of ids/);
    bad(f.intArray({}), {}, /must be a list of ids/);
    bad(f.intArray({}), true, /must be a list of ids/);
  });

  it('enforces min and max entries, counted after de-duplication', () => {
    bad(f.intArray({ min: 2 }), [1], /needs at least 2 entries/);
    // The message singularises for one.
    bad(f.intArray({ min: 1 }), [], /needs at least 1 entry/);
    bad(f.intArray({ max: 2 }), [1, 2, 3], /at most 2 entries/);
    // Duplicates collapse first, so this fails the minimum despite two entries.
    bad(f.intArray({ min: 2 }), [4, 4], /needs at least 2 entries/);
  });

  it('treats an empty array as present but empty', () => {
    // [] is not "absent": a caller clearing a list means it.
    ok(f.intArray({}), [], []);
  });
});

describe('parseBody', () => {
  /** Minimal res double: records what the route would have sent. */
  function fakeRes() {
    const sent = {};
    return {
      sent,
      status(code) { sent.status = code; return this; },
      json(payload) { sent.body = payload; return this; },
    };
  }

  it('returns the parsed value and sends nothing when valid', () => {
    const res = fakeRes();
    const body = parseBody({ body: { a: ' x ' } }, res, { a: f.str({ required: true }) });
    assert.deepEqual(body, { a: 'x' });
    assert.deepEqual(res.sent, {}, 'must not touch res on success');
  });

  it('sends 400 validation_failed and returns null when invalid', () => {
    const res = fakeRes();
    const body = parseBody({ body: {} }, res, { a: f.str({ required: true }) });
    assert.equal(body, null, 'null is the signal for the route to stop');
    assert.equal(res.sent.status, 400);
    assert.equal(res.sent.body.error, 'validation_failed');
    assert.deepEqual(res.sent.body.fields, { a: 'a is required' });
  });
});
