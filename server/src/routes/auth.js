import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { f, parseBody } from '../lib/validate.js';
import { ah, conflict, unauthorized } from '../lib/http.js';
import { isValidTimezone, todayFor } from '../lib/dates.js';
import {
  createUser, emailExists, findByEmailWithHash, touchLastLogin, updateTimezone,
} from '../repos/user.js';
import { requireAuth } from '../middleware/auth.js';

const BCRYPT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Registration enforces the password policy. Login must NOT: applying a
// minimum length at login would leak the policy through the status code and
// would lock out existing users the day the policy is tightened. Login only
// needs a non-empty string, and a wrong password is always 401.
const REGISTER_FIELDS = {
  email: f.str({ required: true, max: 254, pattern: EMAIL_RE, message: 'email is not valid' }),
  password: f.str({ required: true, min: 8, max: 200, trim: false }),
};

const LOGIN_FIELDS = {
  email: f.str({ required: true, max: 254 }),
  password: f.str({ required: true, min: 1, max: 200, trim: false }),
};

const router = Router();

/** Shape sent to the client. Never includes password_hash. */
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    timezone: user.timezone,
    today: todayFor(user),
  };
}

router.post(
  '/register',
  ah(async (req, res) => {
    const body = parseBody(req, res, {
      ...REGISTER_FIELDS,
      timezone: f.str({ default: 'UTC', max: 64 }),
    });
    if (!body) return;

    const timezone = isValidTimezone(body.timezone) ? body.timezone : 'UTC';

    if (await emailExists(pool, body.email)) throw conflict('email_taken');

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    const user = await createUser(pool, { email: body.email, passwordHash, timezone });

    req.session.userId = user.id;
    res.status(201).json({ user: publicUser(user) });
  }),
);

router.post(
  '/login',
  ah(async (req, res) => {
    const body = parseBody(req, res, LOGIN_FIELDS);
    if (!body) return;

    const user = await findByEmailWithHash(pool, body.email);

    // Compare against a dummy hash when the email is unknown so a wrong email
    // and a wrong password take the same time. Cheap defence against using
    // response timing to enumerate accounts.
    const hash = user?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(body.password, hash);

    if (!user || !ok) throw unauthorized('invalid_credentials');

    await touchLastLogin(pool, user.id);

    // Rotate the session id on login so a pre-login cookie cannot be replayed.
    req.session.regenerate((err) => {
      if (err) throw err;
      req.session.userId = user.id;
      res.json({ user: publicUser(user) });
    });
  }),
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.status(204).end();
  });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'login_required' });
  res.json({ user: publicUser(req.user) });
});

// Lets the client correct the timezone it guessed at registration.
router.patch(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const body = parseBody(req, res, { timezone: f.str({ required: true, max: 64 }) });
    if (!body) return;
    if (!isValidTimezone(body.timezone)) {
      return res.status(400).json({
        error: 'validation_failed',
        fields: { timezone: 'timezone is not a known IANA name' },
      });
    }
    const user = await updateTimezone(pool, req.user.id, body.timezone);
    res.json({ user: publicUser(user) });
  }),
);

export default router;
