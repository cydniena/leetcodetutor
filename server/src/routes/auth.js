import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { f, parseBody } from '../lib/validate.js';
import { ah, conflict, unauthorized } from '../lib/http.js';
import { destroySession, regenerateSession, saveSession } from '../lib/session.js';
import { isValidTimezone, todayFor } from '../lib/dates.js';
import {
  createUser, deleteOtherSessions, emailExists, findByEmailWithHash, findByIdWithHash,
  touchLastLogin, updatePasswordHash, updateTimezone,
} from '../repos/user.js';
import { requireAuth } from '../middleware/auth.js';

const BCRYPT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The password policy, in one place, so registration and a password change
// cannot drift apart. Login must NOT apply it: a minimum length at login would
// leak the policy through the status code and would lock out existing users the
// day the policy is tightened. Login only needs a non-empty string, and a wrong
// password is always 401.
const PASSWORD_POLICY = { required: true, min: 8, max: 200, trim: false };

const REGISTER_FIELDS = {
  email: f.str({ required: true, max: 254, pattern: EMAIL_RE, message: 'email is not valid' }),
  password: f.str(PASSWORD_POLICY),
};

const LOGIN_FIELDS = {
  email: f.str({ required: true, max: 254 }),
  password: f.str({ required: true, min: 1, max: 200, trim: false }),
};

// The current password is checked against the stored hash, never against the
// policy -- same reasoning as login, and an account created before a policy
// change must still be able to move off its old password.
const PASSWORD_CHANGE_FIELDS = {
  currentPassword: f.str({ required: true, min: 1, max: 200, trim: false }),
  newPassword: f.str(PASSWORD_POLICY),
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
    await saveSession(req.session);
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
    // Awaited rather than callback-based: see lib/session.js for why a throw
    // from inside regenerate's callback used to kill the process.
    await regenerateSession(req.session);
    req.session.userId = user.id;
    await saveSession(req.session);
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  '/logout',
  ah(async (req, res) => {
    // If the store cannot drop the record the session is still live, so the
    // cookie stays put and the caller gets a 500 it can retry. Clearing the
    // cookie here would report success while leaving the session usable.
    await destroySession(req.session);
    res.clearCookie('sid');
    res.status(204).end();
  }),
);

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

/**
 * Change the password. Requires the current one: an unlocked laptop must not
 * be enough to lock the owner out of their own account.
 *
 * Every other session for this user is dropped, and the caller's session id is
 * rotated. Changing a password is what you do when you think someone else has
 * it, so leaving their session alive would defeat the point.
 */
router.patch(
  '/me/password',
  requireAuth,
  ah(async (req, res) => {
    const body = parseBody(req, res, PASSWORD_CHANGE_FIELDS);
    if (!body) return;

    if (body.newPassword === body.currentPassword) {
      return res.status(400).json({
        error: 'validation_failed',
        fields: { newPassword: 'newPassword must differ from the current password' },
      });
    }

    // req.user is the safe projection, so re-read to get the hash.
    const withHash = await findByIdWithHash(pool, req.user.id);
    if (!withHash) throw unauthorized('login_required');

    const ok = await bcrypt.compare(body.currentPassword, withHash.password_hash);
    if (!ok) throw unauthorized('current_password_incorrect');

    const passwordHash = await bcrypt.hash(body.newPassword, BCRYPT_ROUNDS);
    const user = await updatePasswordHash(pool, req.user.id, passwordHash);

    // Delete the others first, then regenerate: regenerate destroys the row the
    // caller arrived on and writes a new one, so this ordering never races with
    // its own new session.
    await deleteOtherSessions(pool, req.user.id, req.sessionID);

    req.session.regenerate((err) => {
      if (err) throw err;
      req.session.userId = user.id;
      res.json({ user: publicUser(user) });
    });
  }),
);

export default router;
