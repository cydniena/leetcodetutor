// Hand-rolled request validation. Stands in for zod, which we chose not to add.
//
// A route declares a field map; `validate` returns { value, errors }. `value`
// holds only declared fields, so an unexpected key in the body can never reach
// a SQL statement.
//
//   const { value, errors } = validate(req.body, {
//     email:    f.str({ required: true, max: 254, trim: true }),
//     minutes:  f.int({ required: true, min: 1, max: 600 }),
//     outcome:  f.oneOf(['solved_clean', 'solved_with_hint', 'gave_up'], { required: true }),
//   });

const MISSING = Symbol('missing');

function base(opts, coerce) {
  return (raw, field) => {
    const absent = raw === undefined || raw === null || raw === '';
    if (absent) {
      if (opts.required) return { error: `${field} is required` };
      if ('default' in opts) return { value: opts.default };
      return { value: MISSING };
    }
    return coerce(raw, field);
  };
}

export const f = {
  str: (opts = {}) =>
    base(opts, (raw, field) => {
      if (typeof raw !== 'string') return { error: `${field} must be a string` };
      const value = opts.trim === false ? raw : raw.trim();
      if (value === '' && opts.required) return { error: `${field} is required` };
      if (opts.min && value.length < opts.min)
        return { error: `${field} must be at least ${opts.min} characters` };
      if (opts.max && value.length > opts.max)
        return { error: `${field} must be at most ${opts.max} characters` };
      if (opts.pattern && !opts.pattern.test(value))
        return { error: opts.message || `${field} is not in the expected format` };
      return { value };
    }),

  int: (opts = {}) =>
    base(opts, (raw, field) => {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isInteger(value)) return { error: `${field} must be a whole number` };
      if (opts.min !== undefined && value < opts.min)
        return { error: `${field} must be at least ${opts.min}` };
      if (opts.max !== undefined && value > opts.max)
        return { error: `${field} must be at most ${opts.max}` };
      return { value };
    }),

  num: (opts = {}) =>
    base(opts, (raw, field) => {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(value)) return { error: `${field} must be a number` };
      if (opts.min !== undefined && value < opts.min)
        return { error: `${field} must be at least ${opts.min}` };
      if (opts.max !== undefined && value > opts.max)
        return { error: `${field} must be at most ${opts.max}` };
      return { value };
    }),

  bool: (opts = {}) =>
    base(opts, (raw, field) => {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true' || raw === 1 || raw === '1') return { value: true };
      if (raw === 'false' || raw === 0 || raw === '0') return { value: false };
      return { error: `${field} must be true or false` };
    }),

  // 'YYYY-MM-DD' only. We never accept a timestamp where a calendar day is meant.
  date: (opts = {}) =>
    base(opts, (raw, field) => {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
        return { error: `${field} must be a date in YYYY-MM-DD form` };
      const [y, m, d] = raw.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d)
        return { error: `${field} is not a real date` };
      return { value: raw };
    }),

  oneOf: (allowed, opts = {}) =>
    base(opts, (raw, field) => {
      if (!allowed.includes(raw))
        return { error: `${field} must be one of: ${allowed.join(', ')}` };
      return { value: raw };
    }),

  // Array of positive integers, e.g. pattern_ids on an attempt.
  intArray: (opts = {}) =>
    base(opts, (raw, field) => {
      const arr = Array.isArray(raw) ? raw : String(raw).split(',');
      const out = [];
      for (const item of arr) {
        const n = typeof item === 'number' ? item : Number(String(item).trim());
        if (!Number.isInteger(n) || n < 1) return { error: `${field} must be a list of ids` };
        out.push(n);
      }
      const value = [...new Set(out)];
      if (opts.min && value.length < opts.min)
        return { error: `${field} needs at least ${opts.min} entr${opts.min === 1 ? 'y' : 'ies'}` };
      if (opts.max && value.length > opts.max)
        return { error: `${field} may have at most ${opts.max} entries` };
      return { value };
    }),
};

export function validate(body, fields) {
  const value = {};
  const errors = {};
  const source = body && typeof body === 'object' ? body : {};

  for (const [field, check] of Object.entries(fields)) {
    const result = check(source[field], field);
    if (result.error) errors[field] = result.error;
    else if (result.value !== MISSING) value[field] = result.value;
  }

  return { value, errors: Object.keys(errors).length ? errors : null };
}

/** Shorthand for routes: returns parsed body, or sends 400 and returns null. */
export function parseBody(req, res, fields) {
  const { value, errors } = validate(req.body, fields);
  if (errors) {
    res.status(400).json({ error: 'validation_failed', fields: errors });
    return null;
  }
  return value;
}
