// Data layer for identity.
//
// Note the shape used across every repo in this project: functions take the db
// handle first, then the acting user's id where the data is user-owned. There
// is deliberately no `findById(id)` for user-owned rows -- see repos/plan.js.

const COLUMNS = 'id, email, role, timezone, created_at, updated_at, last_login_at';

export async function createUser(db, { email, passwordHash, role = 'learner', timezone = 'UTC' }) {
  const { rows } = await db.query(
    `insert into app_user (email, password_hash, role, timezone)
     values ($1, $2, $3, $4)
     returning ${COLUMNS}`,
    [email, passwordHash, role, timezone],
  );
  return rows[0];
}

/** Includes password_hash -- only for the login path. */
export async function findByEmailWithHash(db, email) {
  const { rows } = await db.query(
    `select ${COLUMNS}, password_hash from app_user where lower(email) = lower($1)`,
    [email],
  );
  return rows[0] ?? null;
}

/** Safe projection: never returns the hash. Used to rehydrate the session. */
export async function findUserById(db, id) {
  const { rows } = await db.query(`select ${COLUMNS} from app_user where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function emailExists(db, email) {
  const { rows } = await db.query(
    'select 1 from app_user where lower(email) = lower($1)',
    [email],
  );
  return rows.length > 0;
}

export async function touchLastLogin(db, id) {
  await db.query('update app_user set last_login_at = now() where id = $1', [id]);
}

export async function updateTimezone(db, userId, timezone) {
  const { rows } = await db.query(
    `update app_user set timezone = $2 where id = $1 returning ${COLUMNS}`,
    [userId, timezone],
  );
  return rows[0] ?? null;
}

/** Includes password_hash -- only for re-verifying the current password. */
export async function findByIdWithHash(db, id) {
  const { rows } = await db.query(
    `select ${COLUMNS}, password_hash from app_user where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function updatePasswordHash(db, userId, passwordHash) {
  const { rows } = await db.query(
    `update app_user set password_hash = $2 where id = $1 returning ${COLUMNS}`,
    [userId, passwordHash],
  );
  return rows[0] ?? null;
}

/**
 * Signs the user out everywhere except the caller. Sessions are rows in
 * user_session with the user id inside the `sess` json, so this is the only
 * way to reach them -- express-session's store API has no "by user" lookup.
 * `sess->>'userId'` is text; the id is a number, hence the cast.
 */
export async function deleteOtherSessions(db, userId, keepSid) {
  const { rowCount } = await db.query(
    `delete from user_session where sess->>'userId' = $1::text and sid <> $2`,
    [userId, keepSid ?? ''],
  );
  return rowCount;
}
