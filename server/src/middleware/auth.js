import { pool } from '../db.js';
import { findUserById } from '../repos/user.js';
import { forbidden, unauthorized } from '../lib/http.js';
import { destroySession } from '../lib/session.js';

/**
 * Loads the session's user onto req.user for every request. Cheap enough at
 * this scale (one indexed lookup) and means a role change or deletion takes
 * effect immediately rather than living on in the session cookie.
 */
export async function attachUser(req, _res, next) {
  try {
    if (req.session?.userId) {
      req.user = await findUserById(pool, req.session.userId);
      // Session points at a user who no longer exists -- drop it. This is
      // cleanup incidental to the request, which is unauthenticated either
      // way, so a store failure is logged rather than turned into a 500 for a
      // caller who did nothing wrong. The old code passed `() => {}` and so
      // could not report the failure at all.
      if (!req.user) {
        await destroySession(req.session).catch((err) => {
          console.error('could not drop session for a deleted user:', err);
        });
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized('login_required'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized('login_required'));
  if (req.user.role !== 'admin') return next(forbidden('admin_only'));
  next();
}
