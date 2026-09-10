import pg from 'pg';

// DATE columns (oid 1082) come back as plain 'YYYY-MM-DD' strings rather than
// JS Date objects. Without this, node-postgres builds a Date at local midnight
// and every date in the app is one day off for half the world. Set once, here,
// before any pool is used.
pg.types.setTypeParser(1082, (value) => value);
// NUMERIC (1700) would otherwise arrive as a string; we only use it for
// hours_per_week, where a number is what the client wants.
pg.types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));
// BIGINT (20) -> Number. Safe here: these are identity keys and counts, nowhere
// near 2^53. If a count could ever exceed that, this is the line to revisit.
pg.types.setTypeParser(20, (value) => (value === null ? null : Number(value)));

// One pool for the process. Repos take it (or a transaction client) as their
// first argument, so the same function works inside and outside a transaction.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => console.error('idle pg client error:', err.message));

/** Run fn inside a transaction, passing it a dedicated client. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
