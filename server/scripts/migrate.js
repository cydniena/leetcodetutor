// Plain-SQL migration runner. Reads migrations/NNN_*.sql in filename order,
// applies each in its own transaction, and records it in schema_migration.
// No rollback support on purpose: for a solo project `npm run db:reset` is the
// honest answer, and a down-migration you never test is worse than none.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`
    create table if not exists schema_migration (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )`);

  const { rows } = await client.query('select filename from schema_migration');
  const applied = new Set(rows.map((r) => r.filename));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const filename of files) {
    if (applied.has(filename)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migration (filename) values ($1)', [filename]);
      await client.query('commit');
      console.log(`  applied ${filename}`);
      count++;
    } catch (err) {
      await client.query('rollback');
      console.error(`  FAILED  ${filename}\n${err.message}`);
      await client.end();
      process.exit(1);
    }
  }

  console.log(count ? `${count} migration(s) applied.` : 'Already up to date.');
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
