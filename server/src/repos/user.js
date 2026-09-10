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
