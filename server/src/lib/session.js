// express-session's regenerate/save/destroy are callback-based, and they call
// back asynchronously -- after the store round-trip, by which time the promise
// chain `ah` built has already settled. A `throw` from inside one of those
// callbacks is therefore not caught by `ah`'s .catch(next): it escapes the
// handler entirely and arrives as an uncaughtException, which by default takes
// the whole process down. One dropped Postgres connection would turn a single
// failed login into an outage for every connected user.
//
// These wrappers keep the store inside the async chain, so a failure is an
// ordinary rejection that reaches the error handler in app.js as a 500.

const asPromise = (session, method) => new Promise((resolve, reject) => {
  session[method]((err) => (err ? reject(err) : resolve()));
});

/** New session id, old record dropped. Call before writing the new identity. */
export const regenerateSession = (session) => asPromise(session, 'regenerate');

/**
 * Forces the store write now rather than at end-of-response. Without it the
 * client can receive its 200 and issue the next request before the new session
 * row is committed, which reads back as a spurious 401 right after a
 * successful login.
 */
export const saveSession = (session) => asPromise(session, 'save');

/** Drops the session record and clears req.session. */
export const destroySession = (session) => asPromise(session, 'destroy');
